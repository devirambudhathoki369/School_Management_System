"""Voucher serial allocation: per (school, fiscal year, voucher type),
FOR-UPDATE counter inside the voucher transaction. Legacy computed max+1 at
read time (same racy pattern as receipts); production accounting serials
happen to be duplicate-free, so imported serials stay real and the counter
is seeded from their maximum by the ETL."""

from django.db import transaction

from apps.accounting.models import VoucherSerialCounter


def allocate(school, fiscal_year, voucher_type: str) -> int:
    """Next voucher serial. MUST be called inside a transaction."""
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("Serial allocation requires an open transaction.")
    counter, _ = VoucherSerialCounter.objects.get_or_create(
        school=school, fiscal_year=fiscal_year, voucher_type=voucher_type
    )
    counter = VoucherSerialCounter.objects.select_for_update().get(pk=counter.pk)
    counter.last_serial += 1
    counter.save(update_fields=["last_serial"])
    return counter.last_serial
