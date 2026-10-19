"""Deposit payment workflow, independent of which provider (Stripe or demo) takes the money.

    book ─▶ appointment AWAITING_PAYMENT (slot held) ─▶ hosted checkout
                                                          ├─ paid ─────▶ CONFIRMED  (fulfill_checkout)
                                                          └─ abandoned ▶ EXPIRED    (release_expired_holds)
    cancel a paid booking ─▶ deposit refunded            (cancel_payments)

fulfill_checkout is idempotent: the provider's webhook and the customer's return to the success
page both call it, and whichever arrives first wins.
"""

import logging
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from scheduling.availability import business_tz
from scheduling.models import Appointment, Service

from . import gateway
from .models import Payment
from .providers.base import CheckoutRequest

logger = logging.getLogger(__name__)


class PaymentError(Exception):
    """The provider could not complete an operation; safe to show the message to the user."""


def deposit_required(service: Service) -> bool:
    return settings.PAYMENTS_ENABLED and service.deposit > 0


def hold_duration() -> timedelta:
    return timedelta(minutes=settings.CHECKOUT_SESSION_MINUTES + settings.PAYMENT_HOLD_GRACE_MINUTES)


def release_expired_holds() -> int:
    """Free slots whose payment window ran out. Cheap enough to run before every availability read."""
    now = timezone.now()
    ids = list(
        Appointment.objects.filter(status=Appointment.Status.AWAITING_PAYMENT, hold_expires_at__lt=now).values_list(
            "id", flat=True
        )
    )
    if ids:
        Appointment.objects.filter(id__in=ids, status=Appointment.Status.AWAITING_PAYMENT).update(
            status=Appointment.Status.EXPIRED, hold_expires_at=None, updated_at=now
        )
        Payment.objects.filter(appointment_id__in=ids, status=Payment.Status.PENDING).update(
            status=Payment.Status.EXPIRED
        )
    return len(ids)


def start_checkout(appointment: Appointment) -> Payment:
    """Open a hosted checkout for the appointment's deposit with the configured provider."""
    service = appointment.service
    expires_at = timezone.now() + timedelta(minutes=settings.CHECKOUT_SESSION_MINUTES)
    request = CheckoutRequest(
        amount=service.deposit,
        currency=settings.PAYMENT_CURRENCY,
        product_name=f"Deposit: {service.name}",
        description=f"{_format_local(appointment.start)} with {appointment.staff}. "
        f"Balance of {_money(appointment.price - service.deposit)} due at the studio.",
        customer_email=appointment.customer.email,
        success_url=f"{settings.FRONTEND_URL}/booking/confirmed?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{settings.FRONTEND_URL}/booking/payment-cancelled?appointment={appointment.id}",
        expires_at=expires_at,
        metadata={"appointment_id": str(appointment.id)},
        idempotency_key=f"appointment-{appointment.id}-checkout",
    )
    provider = gateway.current_provider()
    try:
        session = gateway.create_checkout_session(request)
    except gateway.ProviderError as exc:
        logger.exception("%s checkout failed for appointment %s", provider, appointment.id)
        raise PaymentError("We couldn't start the payment. Please try again in a moment.") from exc

    return Payment.objects.create(
        appointment=appointment,
        provider=provider,
        amount=service.deposit,
        currency=settings.PAYMENT_CURRENCY,
        checkout_session_id=session.id,
        checkout_url=session.url or "",
        expires_at=expires_at,
    )


def resume_checkout(appointment: Appointment) -> Payment:
    """The still-open checkout for an appointment awaiting payment (e.g. the customer closed the tab)."""
    payment = appointment.payments.filter(status=Payment.Status.PENDING, expires_at__gt=timezone.now()).first()
    if appointment.status != Appointment.Status.AWAITING_PAYMENT or not payment:
        raise PaymentError("The payment window for this booking has closed. Please book again.")
    return payment


def fulfill_checkout(session_id: str) -> Payment | None:
    """Record a completed checkout. Safe to call any number of times for the same session."""
    payment = Payment.objects.filter(checkout_session_id=session_id).first()
    if payment is None:
        return None
    try:
        # Always ask the provider rather than trusting the caller: the session ID may come from a URL.
        session = gateway.retrieve_checkout_session(payment.provider, session_id)
    except gateway.ProviderError as exc:
        raise PaymentError("We couldn't confirm the payment. Please refresh in a moment.") from exc
    if session.payment_status != "paid":
        return payment

    refund_needed = False
    with transaction.atomic():
        payment = Payment.objects.select_for_update().get(pk=payment.pk)
        if payment.status in (Payment.Status.PAID, Payment.Status.REFUNDED):
            return payment  # already handled by the other path
        payment.status = Payment.Status.PAID
        payment.paid_at = timezone.now()
        payment.payment_reference = _id(session.payment_intent)
        payment.save()

        appointment = Appointment.objects.select_for_update().get(pk=payment.appointment_id)
        if appointment.status in (Appointment.Status.AWAITING_PAYMENT, Appointment.Status.EXPIRED):
            appointment.status = Appointment.Status.CONFIRMED
            appointment.hold_expires_at = None
            try:
                # If the hold had lapsed and someone else took the slot meanwhile, the
                # exclusion constraint refuses this, and we refund instead of double-booking.
                with transaction.atomic():
                    appointment.save(update_fields=["status", "hold_expires_at", "updated_at"])
            except IntegrityError:
                refund_needed = True
        elif appointment.status == Appointment.Status.CANCELLED:
            refund_needed = True  # cancelled while the customer was paying

    if refund_needed:
        logger.warning("Refunding late payment for appointment %s: slot no longer available", payment.appointment_id)
        refund(payment)
    return payment


def handle_checkout_expired(session_id: str) -> None:
    payment = Payment.objects.filter(checkout_session_id=session_id, status=Payment.Status.PENDING).first()
    if not payment:
        return
    payment.status = Payment.Status.EXPIRED
    payment.save(update_fields=["status"])
    Appointment.objects.filter(pk=payment.appointment_id, status=Appointment.Status.AWAITING_PAYMENT).update(
        status=Appointment.Status.EXPIRED, hold_expires_at=None, updated_at=timezone.now()
    )


def refund(payment: Payment) -> Payment:
    if payment.status == Payment.Status.REFUNDED:
        return payment
    try:
        result = gateway.refund(
            payment.provider, payment.payment_reference, idempotency_key=f"payment-{payment.id}-refund"
        )
    except gateway.ProviderError as exc:
        logger.exception("%s refund failed for payment %s", payment.provider, payment.id)
        raise PaymentError("We couldn't refund the deposit, so the booking wasn't cancelled. Please try again.") from exc
    payment.status = Payment.Status.REFUNDED
    payment.refund_reference = result.id
    payment.refunded_at = timezone.now()
    payment.save(update_fields=["status", "refund_reference", "refunded_at"])
    return payment


def cancel_payments(appointment: Appointment) -> Decimal | None:
    """Settle payments for an appointment that's being cancelled. Returns the amount refunded, if any.

    Raises PaymentError if a refund fails, so the caller can leave the booking in place.
    """
    refunded = None
    for payment in appointment.payments.all():
        if payment.status == Payment.Status.PAID:
            refund(payment)
            refunded = (refunded or Decimal(0)) + payment.amount
        elif payment.status == Payment.Status.PENDING:
            # Close the checkout so it can't be paid after the booking is gone.
            try:
                gateway.expire_checkout_session(payment.provider, payment.checkout_session_id)
            except gateway.ProviderError:
                logger.warning("Could not expire checkout session %s", payment.checkout_session_id)
            payment.status = Payment.Status.EXPIRED
            payment.save(update_fields=["status"])
    return refunded


def _id(value) -> str:
    """Provider fields can be an ID string or an expanded object."""
    if value is None:
        return ""
    return value if isinstance(value, str) else value.id


def _money(amount: Decimal) -> str:
    return f"${amount:,.2f}".replace(".00", "")


def _format_local(instant) -> str:
    local = instant.astimezone(business_tz())
    return f"{local:%a %b} {local.day}, {local:%I:%M %p}".replace(" 0", " ")
