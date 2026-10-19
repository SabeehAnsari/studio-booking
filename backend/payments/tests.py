from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import stripe
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from scheduling.models import Appointment, Service
from scheduling.tests import BookingTestCase, local

from . import services
from .models import DemoCheckoutSession, Payment

STRIPE_SETTINGS = dict(
    PAYMENT_PROVIDER="stripe", PAYMENTS_ENABLED=True, STRIPE_SECRET_KEY="sk_test_123", STRIPE_WEBHOOK_SECRET="whsec_123"
)


def fake_session(session_id="cs_test_1", payment_status="unpaid", payment_intent=None):
    return SimpleNamespace(
        id=session_id,
        url=f"https://checkout.stripe.com/c/pay/{session_id}",
        payment_status=payment_status,
        payment_intent=payment_intent,
    )


@override_settings(**STRIPE_SETTINGS)
class DepositTestCase(BookingTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.service.deposit = Decimal("20.00")
        cls.service.save()

    def setUp(self):
        patcher = patch("payments.gateway.create_checkout_session", return_value=fake_session())
        self.create_session = patcher.start()
        self.addCleanup(patcher.stop)

    def book_via_api(self, start=None, customer=None, service=None):
        return self.client_for(customer or self.customer).post(
            "/api/appointments/",
            {
                "service_id": (service or self.service).id,
                "staff_id": self.staff.id,
                "start": (start or local(self.monday, "09:00")).isoformat(),
            },
        )

    def paid_booking(self):
        response = self.book_via_api()
        with patch(
            "payments.gateway.retrieve_checkout_session",
            return_value=fake_session(payment_status="paid", payment_intent="pi_123"),
        ):
            services.fulfill_checkout("cs_test_1")
        return Appointment.objects.get(pk=response.data["id"])


class BookingWithDepositTests(DepositTestCase):
    def test_booking_holds_slot_and_returns_checkout_url(self):
        response = self.book_via_api()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "awaiting_payment")
        self.assertEqual(response.data["checkout_url"], "https://checkout.stripe.com/c/pay/cs_test_1")
        self.assertIsNotNone(response.data["hold_expires_at"])

        payment = Payment.objects.get()
        self.assertEqual(payment.amount, Decimal("20.00"))
        self.assertEqual(payment.status, Payment.Status.PENDING)
        self.assertEqual(payment.provider, "stripe")
        request = self.create_session.call_args.args[0]
        self.assertEqual(request.amount, Decimal("20.00"))
        self.assertEqual(request.customer_email, self.customer.email)
        self.assertEqual(request.metadata, {"appointment_id": str(response.data["id"])})

    def test_held_slot_cannot_be_booked_by_someone_else(self):
        self.book_via_api()
        response = self.book_via_api(customer=self.other_customer)
        self.assertEqual(response.status_code, 409)

    def test_service_without_deposit_confirms_immediately(self):
        free = Service.objects.create(name="Consult", duration_minutes=15, price=0)
        self.staff.services.add(free)
        response = self.book_via_api(service=free)
        self.assertEqual(response.data["status"], "confirmed")
        self.assertIsNone(response.data["checkout_url"])
        self.create_session.assert_not_called()

    @override_settings(PAYMENTS_ENABLED=False)
    def test_payments_disabled_confirms_immediately(self):
        response = self.book_via_api()
        self.assertEqual(response.data["status"], "confirmed")
        self.create_session.assert_not_called()

    def test_stripe_outage_releases_the_hold(self):
        self.create_session.side_effect = stripe.APIConnectionError("down")
        with self.assertLogs("payments.services", "ERROR"):
            response = self.book_via_api()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(Appointment.objects.get().status, Appointment.Status.EXPIRED)
        # The slot is free again for the next attempt.
        self.create_session.side_effect = None
        self.assertEqual(self.book_via_api(customer=self.other_customer).status_code, 201)


class HoldExpiryTests(DepositTestCase):
    def test_expired_hold_frees_the_slot(self):
        self.book_via_api()
        Appointment.objects.update(hold_expires_at=timezone.now() - timedelta(seconds=1))

        response = APIClient().get("/api/availability/", {"service": self.service.id, "from": self.monday.isoformat()})
        starts = [slot["start"] for slot in response.data["days"][0]["slots"]]
        self.assertIn(local(self.monday, "09:00"), starts)
        self.assertEqual(Appointment.objects.get().status, Appointment.Status.EXPIRED)
        self.assertEqual(Payment.objects.get().status, Payment.Status.EXPIRED)

    def test_expired_holds_do_not_count_as_cancellations(self):
        self.book_via_api()
        Appointment.objects.update(hold_expires_at=timezone.now() - timedelta(seconds=1))
        services.release_expired_holds()
        response = self.client_for(self.admin).get("/api/dashboard/")
        self.assertEqual(response.data["customers_count"], 0)


class FulfillmentTests(DepositTestCase):
    def test_paid_checkout_confirms_booking(self):
        appointment = self.paid_booking()
        self.assertEqual(appointment.status, Appointment.Status.CONFIRMED)
        self.assertIsNone(appointment.hold_expires_at)
        payment = Payment.objects.get()
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertEqual(payment.payment_reference, "pi_123")

    def test_fulfillment_is_idempotent(self):
        self.paid_booking()
        paid_at = Payment.objects.get().paid_at
        with patch(
            "payments.gateway.retrieve_checkout_session",
            return_value=fake_session(payment_status="paid", payment_intent="pi_123"),
        ):
            services.fulfill_checkout("cs_test_1")  # e.g. the webhook arriving after the success page
        self.assertEqual(Payment.objects.get().paid_at, paid_at)

    def test_unpaid_session_changes_nothing(self):
        self.book_via_api()
        with patch("payments.gateway.retrieve_checkout_session", return_value=fake_session(payment_status="unpaid")):
            services.fulfill_checkout("cs_test_1")
        self.assertEqual(Appointment.objects.get().status, Appointment.Status.AWAITING_PAYMENT)

    def test_late_payment_for_a_taken_slot_is_refunded(self):
        self.book_via_api()
        # The hold lapses and another customer books the same time…
        Appointment.objects.update(hold_expires_at=timezone.now() - timedelta(seconds=1))
        services.release_expired_holds()
        self.create_session.return_value = fake_session("cs_test_2")
        self.assertEqual(self.book_via_api(customer=self.other_customer).status_code, 201)

        # …then the first customer's payment lands.
        with (
            patch(
                "payments.gateway.retrieve_checkout_session",
                return_value=fake_session(payment_status="paid", payment_intent="pi_late"),
            ),
            patch("payments.gateway.refund", return_value=SimpleNamespace(id="re_1")) as refund,
        ):
            services.fulfill_checkout("cs_test_1")

        refund.assert_called_once()
        self.assertEqual(Payment.objects.get(checkout_session_id="cs_test_1").status, Payment.Status.REFUNDED)
        self.assertEqual(Appointment.objects.filter(status=Appointment.Status.CONFIRMED).count(), 0)
        self.assertEqual(Appointment.objects.filter(status=Appointment.Status.AWAITING_PAYMENT).count(), 1)

    def test_checkout_status_endpoint_confirms_for_the_customer(self):
        self.book_via_api()
        with patch(
            "payments.gateway.retrieve_checkout_session",
            return_value=fake_session(payment_status="paid", payment_intent="pi_123"),
        ):
            response = self.client_for(self.customer).get("/api/payments/checkout/cs_test_1/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["payment_status"], "paid")
        self.assertEqual(response.data["appointment"]["status"], "confirmed")

    def test_checkout_status_is_private_to_the_customer(self):
        self.book_via_api()
        response = self.client_for(self.other_customer).get("/api/payments/checkout/cs_test_1/")
        self.assertEqual(response.status_code, 404)

    def test_staff_cannot_confirm_unpaid_booking(self):
        appointment_id = self.book_via_api().data["id"]
        response = self.client_for(self.staff_user).post(f"/api/appointments/{appointment_id}/confirm/")
        self.assertEqual(response.status_code, 400)


class CancellationRefundTests(DepositTestCase):
    def test_cancelling_paid_booking_refunds_deposit(self):
        appointment = self.paid_booking()
        with patch("payments.gateway.refund", return_value=SimpleNamespace(id="re_1")) as refund:
            response = self.client_for(self.customer).post(f"/api/appointments/{appointment.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["refunded_amount"], Decimal("20.00"))
        refund.assert_called_once_with("stripe", "pi_123", idempotency_key=f"payment-{Payment.objects.get().id}-refund")
        self.assertEqual(Payment.objects.get().status, Payment.Status.REFUNDED)

    def test_failed_refund_leaves_booking_in_place(self):
        appointment = self.paid_booking()
        with (
            patch("payments.gateway.refund", side_effect=stripe.APIConnectionError("down")),
            self.assertLogs("payments.services", "ERROR"),
        ):
            response = self.client_for(self.customer).post(f"/api/appointments/{appointment.id}/cancel/")
        self.assertEqual(response.status_code, 502)
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, Appointment.Status.CONFIRMED)

    def test_abandoning_unpaid_booking_closes_checkout(self):
        appointment_id = self.book_via_api().data["id"]
        with patch("payments.gateway.expire_checkout_session") as expire:
            response = self.client_for(self.customer).post(f"/api/appointments/{appointment_id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "expired")
        self.assertIsNone(response.data["refunded_amount"])
        expire.assert_called_once_with("stripe", "cs_test_1")

    def test_resume_checkout_returns_open_session(self):
        appointment_id = self.book_via_api().data["id"]
        response = self.client_for(self.customer).post(f"/api/appointments/{appointment_id}/pay/")
        self.assertEqual(response.data["checkout_url"], "https://checkout.stripe.com/c/pay/cs_test_1")


class WebhookTests(DepositTestCase):
    url = "/api/payments/stripe/webhook/"

    def post_event(self, event_type, session_id="cs_test_1"):
        event = SimpleNamespace(type=event_type, data=SimpleNamespace(object=SimpleNamespace(id=session_id)))
        with patch("payments.gateway.construct_stripe_webhook_event", return_value=event):
            return APIClient().post(self.url, data=b"{}", content_type="application/json", HTTP_STRIPE_SIGNATURE="t=1")

    def test_rejects_bad_signature(self):
        response = APIClient().post(
            self.url, data=b"{}", content_type="application/json", HTTP_STRIPE_SIGNATURE="t=1,v1=forged"
        )
        self.assertEqual(response.status_code, 400)

    def test_completed_event_confirms_booking(self):
        self.book_via_api()
        with patch(
            "payments.gateway.retrieve_checkout_session",
            return_value=fake_session(payment_status="paid", payment_intent="pi_123"),
        ):
            response = self.post_event("checkout.session.completed")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Appointment.objects.get().status, Appointment.Status.CONFIRMED)

    def test_expired_event_releases_hold(self):
        self.book_via_api()
        response = self.post_event("checkout.session.expired")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Appointment.objects.get().status, Appointment.Status.EXPIRED)

    def test_unrelated_events_are_acknowledged(self):
        self.assertEqual(self.post_event("customer.created", session_id="cus_1").status_code, 200)


@override_settings(PAYMENT_PROVIDER="demo", PAYMENTS_ENABLED=True, STRIPE_SECRET_KEY="")
class DemoProviderTests(BookingTestCase):
    """The demo provider end to end, with nothing mocked."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.service.deposit = Decimal("20.00")
        cls.service.save()

    def book(self):
        response = self.client_for(self.customer).post(
            "/api/appointments/",
            {"service_id": self.service.id, "staff_id": self.staff.id, "start": local(self.monday, "09:00").isoformat()},
        )
        self.assertEqual(response.status_code, 201, response.data)
        session_id = response.data["checkout_url"].rsplit("/", 1)[1]
        return response.data["id"], session_id

    def test_checkout_url_points_at_demo_checkout_page(self):
        _, session_id = self.book()
        self.assertTrue(session_id.startswith("demo_cs_"))
        self.assertEqual(Payment.objects.get().provider, "demo")

    def test_customer_can_view_their_checkout(self):
        _, session_id = self.book()
        response = self.client_for(self.customer).get(f"/api/payments/demo-checkout/{session_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["amount"], Decimal("20.00"))
        self.assertEqual(response.data["status"], "open")

    def test_other_customers_cannot_see_or_pay_a_checkout(self):
        _, session_id = self.book()
        other = self.client_for(self.other_customer)
        self.assertEqual(other.get(f"/api/payments/demo-checkout/{session_id}/").status_code, 404)
        self.assertEqual(other.post(f"/api/payments/demo-checkout/{session_id}/pay/").status_code, 404)

    def test_declined_card_leaves_booking_awaiting_payment(self):
        appointment_id, session_id = self.book()
        response = self.client_for(self.customer).post(
            f"/api/payments/demo-checkout/{session_id}/pay/", {"outcome": "decline"}
        )
        self.assertEqual(response.status_code, 402)
        self.assertEqual(Appointment.objects.get(pk=appointment_id).status, Appointment.Status.AWAITING_PAYMENT)

    def test_paying_confirms_and_cancelling_refunds(self):
        appointment_id, session_id = self.book()
        client = self.client_for(self.customer)

        response = client.post(f"/api/payments/demo-checkout/{session_id}/pay/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["redirect_url"].endswith(f"/booking/confirmed?session_id={session_id}"))
        self.assertEqual(Appointment.objects.get(pk=appointment_id).status, Appointment.Status.CONFIRMED)
        self.assertTrue(Payment.objects.get().payment_reference.startswith("demo_pi_"))

        # The success page's status check is idempotent with the instant fulfilment above.
        status = client.get(f"/api/payments/checkout/{session_id}/")
        self.assertEqual(status.data["payment_status"], "paid")

        response = client.post(f"/api/appointments/{appointment_id}/cancel/")
        self.assertEqual(response.data["refunded_amount"], Decimal("20.00"))
        payment = Payment.objects.get()
        self.assertEqual(payment.status, Payment.Status.REFUNDED)
        self.assertTrue(payment.refund_reference.startswith("demo_re_"))

    def test_expired_checkout_cannot_be_paid(self):
        _, session_id = self.book()
        DemoCheckoutSession.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        response = self.client_for(self.customer).post(f"/api/payments/demo-checkout/{session_id}/pay/")
        self.assertEqual(response.status_code, 410)

    def test_abandoning_closes_the_demo_checkout(self):
        appointment_id, session_id = self.book()
        self.client_for(self.customer).post(f"/api/appointments/{appointment_id}/cancel/")
        self.assertEqual(DemoCheckoutSession.objects.get().status, DemoCheckoutSession.Status.EXPIRED)
