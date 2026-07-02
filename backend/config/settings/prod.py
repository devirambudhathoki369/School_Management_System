"""Production settings — strict transport security, no debug."""

from .base import *  # noqa: F403
from .base import env

DEBUG = False

# Behind a TLS-terminating proxy set DJANGO_SSL_REDIRECT=false and let the
# proxy enforce HTTPS; direct deployments keep the redirect on.
SECURE_SSL_REDIRECT = env.bool("DJANGO_SSL_REDIRECT", default=True)
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
