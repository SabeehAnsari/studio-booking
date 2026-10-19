from django.db import models


class Payment(models.Model):
    """A deposit taken through a hosted checkout (Stripe, or the demo provider) for one appointment."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        EXPIRED = "expired", "Expired"
        REFUNDED = "refunded", "Refunded"

    appointment = models.ForeignKey("scheduling.Appointment", on_delete=models.CASCADE, related_name="payments")
    provider = models.CharField(max_length=20)
    amount = models.DecimalField(max_digits=8, decimal_places=2)
    currency = models.CharField(max_length=3)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)

    # The provider's identifiers: checkout session, the charge (Stripe PaymentIntent) and the refund.
    checkout_session_id = models.CharField(max_length=255, unique=True)
    payment_reference = models.CharField(max_length=255, blank=True)
    refund_reference = models.CharField(max_length=255, blank=True)
    checkout_url = models.TextField(blank=True)

    expires_at = models.DateTimeField()
    paid_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.amount} {self.currency.upper()} for appointment #{self.appointment_id} ({self.status})"


class DemoCheckoutSession(models.Model):
    """Backs the demo payment provider: the equivalent of a Stripe Checkout Session."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        COMPLETE = "complete", "Complete"
        EXPIRED = "expired", "Expired"

    id = models.CharField(max_length=64, primary_key=True)
    idempotency_key = models.CharField(max_length=255, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    amount = models.DecimalField(max_digits=8, decimal_places=2)
    currency = models.CharField(max_length=3)
    product_name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    customer_email = models.EmailField()
    success_url = models.TextField()
    cancel_url = models.TextField()
    payment_reference = models.CharField(max_length=64, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
