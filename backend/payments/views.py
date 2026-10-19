import logging

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from scheduling.serializers import AppointmentSerializer

from . import gateway, services
from .models import DemoCheckoutSession, Payment
from .providers import demo

logger = logging.getLogger(__name__)

FULFILL_EVENTS = {"checkout.session.completed", "checkout.session.async_payment_succeeded"}


@csrf_exempt
@require_POST
def stripe_webhook(request):
    """Stripe → us. Signature-verified; always 200 for events we don't care about so Stripe stops retrying."""
    if not settings.STRIPE_SECRET_KEY or not settings.STRIPE_WEBHOOK_SECRET:
        return HttpResponse(status=404)
    try:
        event = gateway.construct_stripe_webhook_event(request.body, request.headers.get("Stripe-Signature"))
    except (ValueError, gateway.SignatureVerificationError):
        logger.warning("Rejected Stripe webhook with an invalid payload or signature")
        return HttpResponse(status=400)

    session_id = event.data.object.id
    if event.type in FULFILL_EVENTS:
        try:
            services.fulfill_checkout(session_id)
        except services.PaymentError:
            return HttpResponse(status=500)  # Stripe retries with backoff
    elif event.type == "checkout.session.expired":
        services.handle_checkout_expired(session_id)
    return HttpResponse(status=200)


class CheckoutStatusView(APIView):
    """The customer lands here after checkout. Confirms the payment directly with the provider,
    so the booking is confirmed even if the webhook hasn't arrived yet."""

    def get(self, request, session_id: str):
        payment = Payment.objects.filter(checkout_session_id=session_id, appointment__customer=request.user).first()
        if not payment:
            raise NotFound("Payment not found.")
        try:
            payment = services.fulfill_checkout(session_id) or payment
        except services.PaymentError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        appointment = payment.appointment
        appointment.refresh_from_db()
        return Response(
            {
                "payment_status": payment.status,
                "appointment": AppointmentSerializer(appointment, context={"request": request}).data,
            }
        )


def _demo_session_for(request, session_id: str) -> DemoCheckoutSession:
    """Only the customer who started a checkout can see or pay it."""
    get_object_or_404(
        Payment, checkout_session_id=session_id, provider=demo.name, appointment__customer=request.user
    )
    return get_object_or_404(DemoCheckoutSession, pk=session_id)


class DemoCheckoutView(APIView):
    """The demo provider's hosted checkout page reads its session from here."""

    def get(self, request, session_id: str):
        session = _demo_session_for(request, session_id)
        if session.status == DemoCheckoutSession.Status.OPEN and session.expires_at <= timezone.now():
            demo.expire_checkout_session(session.id)
            session.refresh_from_db()
        return Response(
            {
                "id": session.id,
                "status": session.status,
                "amount": session.amount,
                "currency": session.currency,
                "product_name": session.product_name,
                "description": session.description,
                "customer_email": session.customer_email,
                "expires_at": session.expires_at,
                "cancel_url": session.cancel_url,
            }
        )


class DemoCheckoutPayView(APIView):
    """The 'Pay' button on the demo checkout. outcome=decline simulates a declined card."""

    def post(self, request, session_id: str):
        session = _demo_session_for(request, session_id)
        if session.status != DemoCheckoutSession.Status.OPEN or session.expires_at <= timezone.now():
            return Response({"detail": "This checkout has expired. Please book again."}, status=status.HTTP_410_GONE)
        if request.data.get("outcome") == "decline":
            return Response(
                {"detail": "Your card was declined. (This is the simulated decline. Nothing was charged.)"},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )
        demo.complete_checkout_session(session)
        # With Stripe, a webhook would deliver this; the demo provider fulfills right away.
        try:
            services.fulfill_checkout(session.id)
        except services.PaymentError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"redirect_url": session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id)})
