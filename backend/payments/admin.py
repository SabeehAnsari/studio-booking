from django.contrib import admin

from .models import Payment


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["created_at", "appointment", "provider", "amount", "currency", "status", "paid_at", "refunded_at"]
    list_filter = ["status", "provider"]
    search_fields = ["checkout_session_id", "payment_reference", "appointment__customer__email"]
    raw_id_fields = ["appointment"]
    readonly_fields = [
        "provider", "checkout_session_id", "payment_reference", "refund_reference", "checkout_url",
        "created_at", "paid_at", "refunded_at",
    ]
