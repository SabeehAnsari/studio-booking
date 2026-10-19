"""Entry point for talking to payment providers. The payment workflow (services.py) only calls these
functions, which route to Stripe or the demo provider. Tests mock this one module."""

from . import providers
from .providers import stripe_provider
from .providers.base import CheckoutRequest

ProviderError = providers.ProviderError
SignatureVerificationError = stripe_provider.SignatureVerificationError


def current_provider() -> str:
    return providers.get().name


def create_checkout_session(request: CheckoutRequest):
    return providers.get().create_checkout_session(request)


def retrieve_checkout_session(provider: str, session_id: str):
    return providers.get(provider).retrieve_checkout_session(session_id)


def expire_checkout_session(provider: str, session_id: str) -> None:
    providers.get(provider).expire_checkout_session(session_id)


def refund(provider: str, payment_reference: str, *, idempotency_key: str):
    return providers.get(provider).refund(payment_reference, idempotency_key=idempotency_key)


def construct_stripe_webhook_event(payload: bytes, signature: str | None):
    return stripe_provider.construct_webhook_event(payload, signature)
