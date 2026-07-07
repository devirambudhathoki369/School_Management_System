"""Delivery-queue workers (Celery beat drives these — see
CELERY_BEAT_SCHEDULE in config/settings/base.py)."""

from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from .models import DeliveryLog
from .providers import StaleTokenError, get_provider


@shared_task
def dispatch_queued_deliveries(batch_size: int = 500) -> int:
    """Send queued notifications through the configured provider.

    Returns the number of rows processed. Without a configured provider the
    queue is left untouched (held, not lost). Rows are claimed with
    SKIP LOCKED so overlapping runs never double-send.
    """
    provider = get_provider()
    if provider is None:
        return 0
    processed = 0
    while True:
        with transaction.atomic():
            rows = list(
                DeliveryLog.objects.select_for_update(skip_locked=True)
                .filter(status=DeliveryLog.Status.QUEUED)
                .order_by("created_at")[:batch_size]
            )
            if not rows:
                return processed
            for log in rows:
                try:
                    provider.send(log)
                except StaleTokenError:
                    log.status = DeliveryLog.Status.STALE_TOKEN
                except Exception:  # provider/network fault: keep going
                    log.status = DeliveryLog.Status.FAILED
                else:
                    log.status = DeliveryLog.Status.SENT
                log.sent_at = timezone.now()
            DeliveryLog.objects.bulk_update(rows, ["status", "sent_at", "updated_at"])
            processed += len(rows)
        if len(rows) < batch_size:
            return processed


@shared_task
def expire_stale_deliveries(days: int = 30) -> int:
    """Fail queued rows nobody could deliver for `days` days. A month-old
    check-in push is noise, not news — expiring keeps the queue honest."""
    cutoff = timezone.now() - timedelta(days=days)
    return DeliveryLog.objects.filter(
        status=DeliveryLog.Status.QUEUED, created_at__lt=cutoff
    ).update(status=DeliveryLog.Status.FAILED, updated_at=timezone.now())
