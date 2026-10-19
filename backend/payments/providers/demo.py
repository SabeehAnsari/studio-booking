"""A stand-in payment provider for demos and local development.

It mimics Stripe Checkout end to end: a hosted checkout page (served by the frontend at
/demo-checkout/<id>), sessions that expire, payment confirmation and refunds. No money
moves and no account is needed. Used when no STRIPE_SECRET_KEY is configured.
"""

import secrets
from types import SimpleNamespace

from django.conf import settings

from ..models import DemoCheckoutSession
from .base import CheckoutRequest

name = "demo"


class Error(Exception):
    pass


def _id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(18)}"


def checkout_url(session_id: str) -> str:
    return f"{settings.FRONTEND_URL}/demo-checkout/{session_id}"


def _as_session(s: DemoCheckoutSession):
    return SimpleNamespace(
        id=s.id,
        url=checkout_url(s.id),
        payment_status="paid" if s.status == DemoCheckoutSession.Status.COMPLETE else "unpaid",
        payment_intent=s.payment_reference or None,
    )


def create_checkout_session(request: CheckoutRequest):
    existing = DemoCheckoutSession.objects.filter(idempotency_key=request.idempotency_key).first()
    if existing:
        return _as_session(existing)  # same idempotency key, same session: like Stripe
    session = DemoCheckoutSession.objects.create(
        id=_id("demo_cs"),
        idempotency_key=request.idempotency_key,
        amount=request.amount,
        currency=request.currency,
        product_name=request.product_name,
        description=request.description,
        customer_email=request.customer_email,
        success_url=request.success_url,
        cancel_url=request.cancel_url,
        expires_at=request.expires_at,
    )
    return _as_session(session)


def retrieve_checkout_session(session_id: str):
    try:
        return _as_session(DemoCheckoutSession.objects.get(pk=session_id))
    except DemoCheckoutSession.DoesNotExist as exc:
        raise Error(f"No demo checkout session {session_id}") from exc


def expire_checkout_session(session_id: str) -> None:
    DemoCheckoutSession.objects.filter(pk=session_id, status=DemoCheckoutSession.Status.OPEN).update(
        status=DemoCheckoutSession.Status.EXPIRED
    )


def complete_checkout_session(session: DemoCheckoutSession) -> None:
    """What the customer's 'Pay' click does on the demo checkout page."""
    session.status = DemoCheckoutSession.Status.COMPLETE
    session.payment_reference = _id("demo_pi")
    session.save(update_fields=["status", "payment_reference"])


def refund(payment_reference: str, *, idempotency_key: str):
    return SimpleNamespace(id=_id("demo_re"))
