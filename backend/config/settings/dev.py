"""Development settings — permissive networking, verbose errors."""

from .base import *  # noqa: F403

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Email to console in dev
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
