"""Django settings for the booking project. Configuration is read from the environment (see .env.example)."""

import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env(name: str, default: str = "") -> str:
    """An environment variable, treating "set but empty" (e.g. `EMAIL_PORT=` copied from
    .env.example, or an unset CI secret) the same as unset."""
    return os.environ.get(name) or default


def env_bool(name: str, default: bool = False) -> bool:
    return env(name, str(default)).lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in env(name, default).split(",") if item.strip()]


DEBUG = env_bool("DEBUG")
SECRET_KEY = env("SECRET_KEY", "insecure-dev-key" if DEBUG else "")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set when DEBUG is off")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

# Render sets this to the service's public hostname (e.g. studio-booking-api.onrender.com).
if render_host := os.environ.get("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(render_host)
    CSRF_TRUSTED_ORIGINS.append(f"https://{render_host}")  # for the Django admin login

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "corsheaders",
    "accounts",
    "scheduling",
    "payments",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": dj_database_url.config(
        default="postgres://booking:booking@localhost:5433/booking",
        conn_max_age=600,
        # Neon scales to zero when idle, which closes open connections. Check before reuse
        # so the first request after a quiet spell reconnects instead of erroring.
        conn_health_checks=True,
    )
}
# Neon's pooled endpoint (hostname ends in -pooler) is PgBouncer in transaction mode, which
# can't hold server-side cursors across transactions. Migrations use the direct URL instead (build.sh).
if "-pooler" in DATABASES["default"].get("HOST", ""):
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# The timezone the business operates in. Working hours are interpreted in this zone;
# everything is stored in UTC.
BUSINESS_TIMEZONE = env("BUSINESS_TIMEZONE", "America/New_York")

BUSINESS_NAME = env("BUSINESS_NAME", "Studio Booking")

# Booking rules
SLOT_INTERVAL_MINUTES = 15
MIN_BOOKING_NOTICE_MINUTES = 60
MAX_BOOKING_DAYS_AHEAD = 60
CANCELLATION_CUTOFF_HOURS = 2

# Appointment reminders (sent by `manage.py send_reminders`).
REMINDER_HOURS_BEFORE = 24
# Bookings made this close to the start don't get a reminder: the customer only just booked.
REMINDER_MIN_BOOKING_LEAD_HOURS = 3

# Email. With no EMAIL_HOST, messages are written to the log instead of sent (console
# backend), which is how the public demo runs. Set the SMTP variables to send for real.
EMAIL_HOST = env("EMAIL_HOST")
EMAIL_BACKEND = env("EMAIL_BACKEND") or (
    "django.core.mail.backends.smtp.EmailBackend" if EMAIL_HOST else "django.core.mail.backends.console.EmailBackend"
)
EMAIL_PORT = int(env("EMAIL_PORT", "587"))
EMAIL_HOST_USER = env("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
EMAIL_TIMEOUT = 20
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", f"{BUSINESS_NAME} <bookings@localhost>")

# Enables one-click demo logins. Turn off for a real client deployment.
DEMO_MODE = env_bool("DEMO_MODE")

# Payments. Provider is "stripe", "demo" (simulated checkout, no money moves) or "none".
# Defaults: Stripe if a key is set, otherwise the demo provider in demo mode, otherwise off.
STRIPE_SECRET_KEY = env("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET")
PAYMENT_PROVIDER = env("PAYMENT_PROVIDER") or (
    "stripe" if STRIPE_SECRET_KEY else "demo" if DEMO_MODE else "none"
)
if PAYMENT_PROVIDER not in {"stripe", "demo", "none"}:
    raise RuntimeError(f"PAYMENT_PROVIDER must be stripe, demo or none (got {PAYMENT_PROVIDER!r})")
if PAYMENT_PROVIDER == "stripe" and not STRIPE_SECRET_KEY:
    raise RuntimeError("PAYMENT_PROVIDER=stripe needs STRIPE_SECRET_KEY")
PAYMENTS_ENABLED = PAYMENT_PROVIDER != "none"
PAYMENT_CURRENCY = env("PAYMENT_CURRENCY", "usd")
# Stripe Checkout sessions must live at least 30 minutes. The slot hold outlives the
# session by a grace period, so a payment completed at the last second still finds its slot.
CHECKOUT_SESSION_MINUTES = 30
PAYMENT_HOLD_GRACE_MINUTES = 5
# Where Stripe sends the customer back to after checkout.
FRONTEND_URL = env("FRONTEND_URL", "http://localhost:5173").rstrip("/")

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {"anon": "60/min"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = True
    # Kept short on purpose: HSTS is sticky in browsers. Raise it once the domain is settled.
    SECURE_HSTS_SECONDS = 3600

# Log to stdout so errors show up in the hosting provider's log viewer.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO" if not DEBUG else "WARNING"},
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
    },
}
