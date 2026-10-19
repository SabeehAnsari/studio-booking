"""Stripe Checkout. Used when STRIPE_SECRET_KEY is set."""

from functools import cache

import stripe
from django.conf import settings

from .base import CheckoutRequest, to_minor_units

name = "stripe"
Error = stripe.StripeError


@cache
def _client() -> stripe.StripeClient:
    return stripe.StripeClient(settings.STRIPE_SECRET_KEY)


def create_checkout_session(request: CheckoutRequest):
    return _client().v1.checkout.sessions.create(
        params={
            "mode": "payment",
            "line_items": [
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": request.currency,
                        "unit_amount": to_minor_units(request.amount),
                        "product_data": {"name": request.product_name, "description": request.description},
                    },
                }
            ],
            "customer_email": request.customer_email,
            "success_url": request.success_url,
            "cancel_url": request.cancel_url,
            "expires_at": int(request.expires_at.timestamp()),
            "metadata": request.metadata,
            "payment_intent_data": {"metadata": request.metadata},
        },
        options={"idempotency_key": request.idempotency_key},
    )


def retrieve_checkout_session(session_id: str):
    return _client().v1.checkout.sessions.retrieve(session_id)


def expire_checkout_session(session_id: str) -> None:
    _client().v1.checkout.sessions.expire(session_id)


def refund(payment_reference: str, *, idempotency_key: str):
    return _client().v1.refunds.create(
        params={"payment_intent": payment_reference}, options={"idempotency_key": idempotency_key}
    )


def construct_webhook_event(payload: bytes, signature: str | None):
    return _client().construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)


SignatureVerificationError = stripe.SignatureVerificationError
