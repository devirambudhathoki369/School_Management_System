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


# --------------------------------------------------------------- direct SMS

class ConsoleSMSProvider:
    """Default: logs instead of sending. Swapping in a real aggregator is a
    settings change (SMS_PROVIDER dotted path), not a code change."""

    def send_sms(self, numbers, message) -> int:
        import logging

        logging.getLogger("communication.sms").info(
            "SMS -> %s: %s", ", ".join(numbers), message
        )
        return len(numbers)


def get_sms_provider():
    path = getattr(
        settings, "SMS_PROVIDER", "apps.communication.providers.ConsoleSMSProvider"
    )
    return import_string(path)()


def send_sms(numbers, message: str) -> int:
    """Direct outbound SMS (daily collection, absent alerts, bulk sends).
    Returns how many numbers were handed to the provider."""
    numbers = [n.strip() for n in numbers if n and n.strip()]
    if not numbers or not message:
        return 0
    return get_sms_provider().send_sms(numbers, message)
