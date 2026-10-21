from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone

from payments.models import Payment

from .models import Appointment
from .reminders import send_due_reminders
from .tests import BookingTestCase


@override_settings(
    REMINDER_HOURS_BEFORE=24,
    REMINDER_MIN_BOOKING_LEAD_HOURS=3,
    FRONTEND_URL="https://studio.example",
    BUSINESS_NAME="Studio Booking",
)
class ReminderTests(BookingTestCase):
    def appointment(self, starts_in: timedelta, *, booked_ago=timedelta(days=3), customer=None, **kwargs):
        appointment = self.book(self.staff, timezone.now() + starts_in, customer=customer, **kwargs)
        Appointment.objects.filter(pk=appointment.pk).update(created_at=timezone.now() - booked_ago)
        return appointment

    def test_sends_reminder_for_appointment_within_24_hours(self):
        appointment = self.appointment(timedelta(hours=20))
        run = send_due_reminders()
        self.assertEqual(run.sent, 1)
        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        self.assertEqual(email.to, [self.customer.email])
        self.assertIn("Reminder: Massage", email.subject)
        self.assertIn("https://studio.example/appointments", email.body)
        self.assertIn("text/html", email.alternatives[0].mimetype)
        appointment.refresh_from_db()
        self.assertIsNotNone(appointment.reminder_sent_at)

    def test_each_appointment_is_reminded_once(self):
        self.appointment(timedelta(hours=20))
        send_due_reminders()
        run = send_due_reminders()
        self.assertEqual(run.sent, 0)
        self.assertEqual(len(mail.outbox), 1)

    def test_too_early_and_past_appointments_are_skipped(self):
        self.appointment(timedelta(hours=30))
        self.appointment(-timedelta(hours=1) - timedelta(days=1))
        self.assertEqual(send_due_reminders().sent, 0)

    def test_last_minute_bookings_are_skipped(self):
        # Booked 1 hour ago for 2 hours from now: the customer doesn't need a reminder.
        self.appointment(timedelta(hours=2), booked_ago=timedelta(hours=1))
        self.assertEqual(send_due_reminders().sent, 0)

    def test_cancelled_and_unpaid_appointments_are_skipped(self):
        self.appointment(timedelta(hours=20), status=Appointment.Status.CANCELLED)
        self.book(self.other_staff, timezone.now() + timedelta(hours=21), status=Appointment.Status.AWAITING_PAYMENT)
        self.assertEqual(send_due_reminders().sent, 0)

    def test_demo_accounts_are_marked_but_not_emailed(self):
        from accounts.models import User

        demo = User.objects.create_user("demo-x", "demo-x@demo.example.com", None)
        appointment = self.appointment(timedelta(hours=20), customer=demo)
        run = send_due_reminders()
        self.assertEqual((run.sent, run.suppressed), (0, 1))
        self.assertEqual(mail.outbox, [])
        appointment.refresh_from_db()
        self.assertIsNotNone(appointment.reminder_sent_at)

    def test_email_shows_deposit_and_balance(self):
        appointment = self.appointment(timedelta(hours=20))
        Payment.objects.create(
            appointment=appointment, provider="demo", amount=Decimal("20.00"), currency="usd",
            status=Payment.Status.PAID, checkout_session_id="cs_1", expires_at=timezone.now(),
        )
        send_due_reminders()
        body = mail.outbox[0].body
        self.assertIn("Deposit paid: $20", body)
        self.assertIn("Due at the studio: $70", body)

    def test_failed_send_is_retried_next_run(self):
        appointment = self.appointment(timedelta(hours=20))
        with (
            patch("django.core.mail.EmailMultiAlternatives.send", side_effect=ConnectionError("SMTP down")),
            self.assertLogs("scheduling.reminders", "ERROR"),
        ):
            run = send_due_reminders()
        self.assertEqual(run.failed, [appointment.id])
        appointment.refresh_from_db()
        self.assertIsNone(appointment.reminder_sent_at)

        self.assertEqual(send_due_reminders().sent, 1)

    def test_command_reports_and_fails_loudly(self):
        self.appointment(timedelta(hours=20))
        out = StringIO()
        call_command("send_reminders", stdout=out)
        self.assertIn("1 sent", out.getvalue())

        self.appointment(timedelta(hours=22), customer=self.other_customer)
        with (
            patch("django.core.mail.EmailMultiAlternatives.send", side_effect=ConnectionError("SMTP down")),
            self.assertLogs("scheduling.reminders", "ERROR"),
            self.assertRaises(CommandError),
        ):
            call_command("send_reminders", stdout=StringIO())
