"""Identity housekeeping (Celery beat)."""

from celery import shared_task
from django.core.management import call_command


@shared_task
def flush_expired_tokens() -> None:
    """Purge expired refresh tokens from the simplejwt outstanding/blacklist
    tables. With rotation + blacklisting every login leaves rows behind;
    without this job the tables grow without bound."""
    call_command("flushexpiredtokens")
