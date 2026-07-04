"""
Fiscal-year closing (legacy AEYCloseView) and its undo.

Closing computes each ledger's closing balance and writes it as the NEXT
year's opening balance; income/expense-category closings net into a chosen
retained-earnings ledger instead (P&L reset), and the old year is marked
closed. The `previous` chain records lineage for undo.

Two corrections over legacy, both documented because only ONE production
close ever ran (the vendor's own demo school), so bug-for-bug parity has no
data to protect:

1. Movement is the SIGNED sum of a ledger's voucher lines (Dr - Cr). Legacy
   summed particular amounts ignoring their side, which e.g. ADDS money
   paid OUT of a cash ledger to its balance.
2. The retained-earnings ledger keeps its own opening + movement and the
   P&L transfer is added on top. Legacy skipped the ledger entirely,
   silently discarding previously retained earnings.

Vouchers are aggregated for the WHOLE fiscal year (legacy filtered by a
client-supplied date range, dropping any movement dated outside it).
"""

from collections import defaultdict
from decimal import Decimal

from django.db import models, transaction
from django.db.models import Sum
from rest_framework import serializers

from apps.accounting.models import (
    BalanceSide,
    FiscalYear,
    LedgerAccount,
    LedgerGroup,
    OpeningBalance,
    Voucher,
    VoucherLine,
)

ZERO = Decimal("0")
PL_CATEGORIES = (LedgerGroup.Category.INCOME, LedgerGroup.Category.EXPENSE)


def _signed(side: str, amount: Decimal) -> Decimal:
    return amount if side == BalanceSide.DEBIT else -amount


def close_fiscal_year(school, fiscal_year, new_year_data, retained_ledger) -> FiscalYear:
    """Close `fiscal_year`, creating its successor with opening balances.
    Returns the new FiscalYear. Debit-positive sign convention throughout."""
    if fiscal_year.closed:
        raise serializers.ValidationError("This fiscal year is already closed.")
    if retained_ledger.school_id != school.id:
        raise serializers.ValidationError("Retained-earnings ledger is not yours.")
    if FiscalYear.objects.filter(school=school, name=new_year_data.get("name")).exists():
        raise serializers.ValidationError("A fiscal year with that name already exists.")

    closings: dict = defaultdict(lambda: ZERO)
    for ob in OpeningBalance.objects.filter(school=school, fiscal_year=fiscal_year):
        closings[ob.ledger_id] += _signed(ob.side, ob.amount)
    movement_rows = (
        VoucherLine.objects.filter(
            voucher__school=school,
            voucher__fiscal_year=fiscal_year,
            voucher__is_active=True,
        )
        .values("ledger_id", "side")
        .annotate(total=Sum("amount"))
    )
    for row in movement_rows:
        closings[row["ledger_id"]] += _signed(row["side"], row["total"])

    categories = dict(
        LedgerAccount.objects.filter(school=school).values_list("id", "group__category")
    )

    with transaction.atomic():
        new_year = FiscalYear.objects.create(
            school=school, previous=fiscal_year, **new_year_data
        )
        retained = closings.pop(retained_ledger.id, ZERO)
        balances = []
        for ledger_id, closing in closings.items():
            if categories.get(ledger_id) in PL_CATEGORIES:
                # income/expense reset to zero; their net (still in the
                # debit-positive convention) rolls into retained earnings
                retained += closing
                continue
            if closing == ZERO:
                continue
            balances.append(
                OpeningBalance(
                    school=school, ledger_id=ledger_id, fiscal_year=new_year,
                    side=BalanceSide.DEBIT if closing > ZERO else BalanceSide.CREDIT,
                    amount=abs(closing),
                )
            )
        if retained != ZERO:
            balances.append(
                OpeningBalance(
                    school=school, ledger=retained_ledger, fiscal_year=new_year,
                    side=BalanceSide.DEBIT if retained > ZERO else BalanceSide.CREDIT,
                    amount=abs(retained),
                )
            )
        OpeningBalance.objects.bulk_create(balances)
        fiscal_year.closed = True
        fiscal_year.save(update_fields=["closed", "updated_at"])
    return new_year


def undo_fiscal_year_close(school, fiscal_year) -> FiscalYear:
    """Reverse a close: delete the successor's opening balances and the
    successor itself, reopen the year. Refuses once the successor has
    vouchers — undo would orphan them (safety the legacy undo lacked)."""
    if not fiscal_year.closed:
        raise serializers.ValidationError("This fiscal year is not closed.")
    next_year = FiscalYear.objects.filter(school=school, previous=fiscal_year).first()
    if next_year is None:
        raise serializers.ValidationError("No successor year found to undo.")
    if Voucher.all_objects.filter(school=school, fiscal_year=next_year).exists():
        raise serializers.ValidationError(
            "Undo blocked: the new fiscal year already has vouchers."
        )
    try:
        with transaction.atomic():
            OpeningBalance.all_objects.filter(
                school=school, fiscal_year=next_year
            ).delete()
            fiscal_year.closed = False
            fiscal_year.save(update_fields=["closed", "updated_at"])
            next_year.delete()
    except models.ProtectedError as exc:
        raise serializers.ValidationError(
            "Undo blocked: other records still reference the new fiscal year."
        ) from exc
    return fiscal_year
