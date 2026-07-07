"""
Base settings shared by every environment.

Environment-specific modules (dev.py / prod.py) import * from here and
override only what differs. All secrets and machine-specific values come
from environment variables (backend/.env in development).
"""

from datetime import timedelta
from pathlib import Path

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "corsheaders",
]

LOCAL_APPS = [
    "apps.core",
    "apps.identity",
    "apps.tenants",
    "apps.audit",
    "apps.academics",
    "apps.people",
    "apps.examinations",
    "apps.attendance",
    "apps.devices",
    "apps.billing",
    "apps.payroll",
    "apps.accounting",
    "apps.homework",
    "apps.library",
    "apps.transport",
    "apps.communication",
    "apps.inventory",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

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

# ---------------------------------------------------------------------------
# Database (PostgreSQL >= 18 required: uuidv7() defaults, RLS roadmap)
# ---------------------------------------------------------------------------

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_NAME"),
        "USER": env("DB_USER"),
        "PASSWORD": env("DB_PASSWORD", default=""),
        "HOST": env("DB_HOST"),
        "PORT": env("DB_PORT", default="5432"),
        "ATOMIC_REQUESTS": True,
        "CONN_MAX_AGE": env.int("DB_CONN_MAX_AGE", default=60),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Authentication & passwords
# ---------------------------------------------------------------------------

AUTH_USER_MODEL = "identity.Account"

AUTHENTICATION_BACKENDS = ["apps.identity.backends.RoleAwareBackend"]

# Usernames are unique per (role, username), not globally: the legacy data has
# 165 cross-role collisions and per-role login is the product's UX. The
# RoleAwareBackend handles lookup, so Django's global-uniqueness warning for
# USERNAME_FIELD does not apply.
SILENCED_SYSTEM_CHECKS = ["auth.W004"]

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    # Legacy hashes imported by the ETL verify with these and upgrade to
    # Argon2 automatically on first successful login.
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# REST framework / API contract
# ---------------------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "30/min",
        "user": "600/min",
    },
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "School ERP API",
    "DESCRIPTION": "Multi-tenant School ERP platform — versioned, typed API contract.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": "/api/v[0-9]+",
}

# ---------------------------------------------------------------------------
# Cache & Celery (Redis; falls back gracefully in dev when unset)
# ---------------------------------------------------------------------------

REDIS_URL = env("REDIS_URL", default="")

if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

CELERY_BROKER_URL = REDIS_URL or None
CELERY_TASK_ALWAYS_EAGER = not REDIS_URL  # run inline in dev without a broker
CELERY_TASK_ACKS_LATE = True
CELERY_TIMEZONE = "Asia/Kathmandu"

# Recurring jobs (the compose `beat` service runs the scheduler). Times are
# Asia/Kathmandu; housekeeping lands in the dead hours before school opens.
CELERY_BEAT_SCHEDULE = {
    "dispatch-queued-deliveries": {
        # Held (returns 0) until PUSH_PROVIDER names a gateway class.
        "task": "apps.communication.tasks.dispatch_queued_deliveries",
        "schedule": crontab(minute="*/5"),
    },
    "expire-stale-deliveries": {
        "task": "apps.communication.tasks.expire_stale_deliveries",
        "schedule": crontab(hour=2, minute=30),
    },
    "flush-expired-tokens": {
        "task": "apps.identity.tasks.flush_expired_tokens",
        "schedule": crontab(hour=3, minute=0),
    },
    "trim-proximity-alerts": {
        "task": "apps.transport.tasks.trim_proximity_alerts",
        "schedule": crontab(hour=3, minute=30),
    },
}

# Dotted path of the push/SMS gateway class used by the delivery dispatcher.
# Empty (the default) holds the queue: rows stay QUEUED, nothing is faked.
PUSH_PROVIDER = env("PUSH_PROVIDER", default="")

# ---------------------------------------------------------------------------
# I18n / files / security headers
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kathmandu"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])

# Optional shared secret ZKTeco devices append as ?pushcommkey= on /iclock/*.
DEVICE_PUSH_COMM_KEY = env("DEVICE_PUSH_COMM_KEY", default="")

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
}
