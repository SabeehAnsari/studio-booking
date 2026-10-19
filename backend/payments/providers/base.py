"""The contract every payment provider module implements.

A provider is a module exposing:
    name: str
    Error: exception type(s) raised when the provider fails
    create_checkout_session(request: CheckoutRequest) -> session with .id and .url
    retrieve_checkout_session(session_id) -> session with .id, .payment_status ("paid"/"unpaid"), .payment_intent
    expire_checkout_session(session_id) -> None
    refund(payment_reference, *, idempotency_key) -> refund with .id

Session objects mirror the shape of Stripe's, so the payment workflow doesn't care which provider it's talking to.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass(frozen=True)
class CheckoutRequest:
    amount: Decimal
    currency: str
    product_name: str
    description: str
    customer_email: str
    success_url: str
    cancel_url: str
    expires_at: datetime
    metadata: dict
    idempotency_key: str


def to_minor_units(amount: Decimal) -> int:
    """$12.50 -> 1250. Payment APIs take amounts in the currency's smallest unit."""
    return int((amount * 100).quantize(Decimal("1")))
