"""
Character certificate issuing — serials in the legacy shape `{n}/{year}`.

Legacy numbered certificates per ECONOMIC year (`45/EY 2082/083`), computing
the next number by parsing the previous row's serial at read time — racy, and
it silently restarted at 1 whenever the parse failed. Here a counter row per
(school, billing year) is locked FOR UPDATE inside the issue transaction
(same fix as billing receipts), seeded once from the school's existing
serials so imported legacy numbering continues unbroken.
"""

import re

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.billing.models import BillingYear
from apps.core.dates import today_bs

from ..models import CertificateSerialCounter, CharacterCertificate

_LEADING_INT = re.compile(r"^(\d+)/")


def current_billing_year() -> BillingYear:
    """The open billing year covering today's BS date; falls back to the
    latest open year (legacy picked the newest un-closed EconomicYear)."""
    today = today_bs()
    years = list(BillingYear.objects.filter(closed=False).order_by("-start_date_bs"))
    for year in years:
        if year.start_date_bs <= today <= year.end_date_bs:
            return year
    if years:
        return years[0]
    raise ValidationError({"billing_year": "No open billing year exists."})


def _seed_from_existing(school, year: BillingYear) -> int:
    """Continue legacy numbering: highest `{n}/{year.name}` already on file."""
    best = 0
    serials = CharacterCertificate.objects.filter(
        school=school, serial_no__endswith=f"/{year.name}"
    ).values_list("serial_no", flat=True)
    for serial in serials:
        match = _LEADING_INT.match(serial)
        if match:
            best = max(best, int(match.group(1)))
    return best


def issue(*, school, student, data: dict, billing_year: BillingYear | None = None):
    """Create a certificate with the next serial for the school's current
    (or given) billing year. Serials are gapless per counter and safe under
    concurrency."""
    year = billing_year or current_billing_year()
    with transaction.atomic():
        counter, _ = CertificateSerialCounter.objects.get_or_create(
            school=school, billing_year=year
        )
        counter = CertificateSerialCounter.objects.select_for_update().get(pk=counter.pk)
        if counter.last_serial == 0:
            counter.last_serial = _seed_from_existing(school, year)
        counter.last_serial += 1
        counter.save(update_fields=["last_serial"])
        return CharacterCertificate.objects.create(
            school=school,
            student=student,
            serial_no=f"{counter.last_serial}/{year.name}",
            data=data,
        )
