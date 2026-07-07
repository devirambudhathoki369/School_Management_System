"""
Push/SMS provider abstraction for the delivery queue.

The dispatcher (`apps.communication.tasks.dispatch_queued_deliveries`) hands
each queued DeliveryLog to the provider named by settings.PUSH_PROVIDER (a
dotted path). No provider configured means the queue is intentionally held —
rows stay QUEUED until the school's gateway (FCM for the parent app, an SMS
aggregator, …) is wired in, and nothing is falsely marked sent.

A provider is any callable object with:

    send(log: DeliveryLog) -> None   # raise to mark the row FAILED
"""

from django.conf import settings
from django.utils.module_loading import import_string


class StaleTokenError(Exception):
    """Raise from a provider when the recipient's device token is dead;
    the dispatcher records STALE_TOKEN instead of a generic failure."""


def get_provider():
    path = getattr(settings, "PUSH_PROVIDER", "")
    if not path:
        return None
    return import_string(path)()
