"""Transport retention jobs (Celery beat)."""

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import ProximityAlert


@shared_task
def trim_proximity_alerts(days: int = 90) -> int:
    """Hard-delete fired proximity alerts older than `days` days.

    These are ephemeral operational rows ("tell me when the bus is near");
    once fired and stale they are pure noise. Never-fired subscriptions
    (alerted_date NULL) are kept — they are live standing requests.
    """
    cutoff = timezone.localdate() - timedelta(days=days)
    deleted, _ = ProximityAlert.all_objects.filter(alerted_date__lt=cutoff).delete()
    return deleted
