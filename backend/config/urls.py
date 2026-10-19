from django.conf import settings
from django.contrib import admin
from django.http import JsonResponse
from django.shortcuts import redirect
from django.urls import include, path


def root(request):
    """Nothing lives at the API's root; send people who open it in a browser to the website.
    Temporary (302) rather than permanent, so changing FRONTEND_URL later isn't cached by browsers."""
    return redirect(settings.FRONTEND_URL)


urlpatterns = [
    path("", root, name="root"),
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/payments/", include("payments.urls")),
    path("api/", include("scheduling.urls")),
    path("health/", lambda request: JsonResponse({"status": "ok"})),
]
