"""Salary-payment serial allocation.

Legacy staff invoice_id was computed max+1 per (school, economic year) at
read time; production holds 112 duplicate (school, invoice_id) groups. Same
fix as billing receipts: a counter row locked FOR UPDATE inside the payment
transaction, keyed on the FISCAL year (billing_year) — serials must not
restart when a school closes an academic year mid-fiscal-year.
"""

from django.db import transaction

from apps.payroll.models import PayrollSerialCounter


def allocate(school, billing_year) -> int:
    """Next salary-payment serial. MUST be called inside a transaction."""
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("Serial allocation requires an open transaction.")
    counter, _ = PayrollSerialCounter.objects.get_or_create(
        school=school, billing_year=billing_year
    )
    counter = PayrollSerialCounter.objects.select_for_update().get(pk=counter.pk)
    counter.last_serial += 1
    counter.save(update_fields=["last_serial"])
    return counter.last_serial
