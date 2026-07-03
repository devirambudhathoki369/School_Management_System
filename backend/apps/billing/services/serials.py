"""Receipt serial allocation — the fix for legacy invariant M2.

The legacy system computed max+1 at read time; concurrent payments raced
and production holds 25,627 duplicate serials. Here a counter row is locked
FOR UPDATE inside the caller's transaction, so serials are gapless-per-
counter and duplicates are impossible (plus a DB unique constraint as the
backstop). Counters run per (school, FISCAL year, kind) — see the model
docstring for why the academic year is the wrong key.
"""

from django.db import transaction

from apps.billing.models import ReceiptSerialCounter


def allocate(school, billing_year, kind: str) -> int:
    """Next receipt serial. MUST be called inside a transaction."""
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("Serial allocation requires an open transaction.")
    counter, _ = ReceiptSerialCounter.objects.get_or_create(
        school=school, billing_year=billing_year, kind=kind
    )
    counter = ReceiptSerialCounter.objects.select_for_update().get(pk=counter.pk)
    counter.last_serial += 1
    counter.save(update_fields=["last_serial"])
    return counter.last_serial
