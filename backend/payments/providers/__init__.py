from django.conf import settings

from . import demo, stripe_provider

PROVIDERS = {stripe_provider.name: stripe_provider, demo.name: demo}

# Catch-all for provider failures, whichever provider raised them.
ProviderError = tuple(p.Error for p in PROVIDERS.values())


def get(name: str | None = None):
    """The provider a payment was made with, or the configured one for new payments."""
    return PROVIDERS[name or settings.PAYMENT_PROVIDER]
