from django.urls import path

from .views import CheckoutStatusView, DemoCheckoutPayView, DemoCheckoutView, stripe_webhook

urlpatterns = [
    path("stripe/webhook/", stripe_webhook, name="stripe-webhook"),
    path("checkout/<str:session_id>/", CheckoutStatusView.as_view(), name="checkout-status"),
    path("demo-checkout/<str:session_id>/", DemoCheckoutView.as_view(), name="demo-checkout"),
    path("demo-checkout/<str:session_id>/pay/", DemoCheckoutPayView.as_view(), name="demo-checkout-pay"),
]
