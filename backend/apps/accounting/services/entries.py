"""
Voucher posting: derive each line's Dr/Cr side and keep every voucher
balanced by construction.

Income/expense vouchers reproduce the legacy shape: the client sends the
particulars (the income/expense side), the server derives their sides from
the ledger group's category (groups.py = legacy IE_TYPES) and prepends the
balancing cash/bank line for `cash_ledger` — exactly the row legacy
inserted with amount = sum of the particulars.

Journal lines carry the client's explicit Dr/Cr and must balance. Contra
vouchers (bank<->cash transfers; zero rows in legacy production) take DR
destination lines and credit `cash_ledger` as the source.
"""

from decimal import Decimal

from rest_framework import serializers

from apps.accounting.groups import EXPENSE_VOUCHER_SIDES, INCOME_VOUCHER_SIDES
from apps.accounting.models import BalanceSide, VoucherType

ZERO = Decimal("0")

# On an income voucher the balancing cash/bank line is a debit (money in);
# on expense/contra it is a credit (money out).
CASH_LINE_SIDE = {
    VoucherType.INCOME: BalanceSide.DEBIT,
    VoucherType.EXPENSE: BalanceSide.CREDIT,
    VoucherType.CONTRA: BalanceSide.CREDIT,
}
PARTICULAR_SIDES = {
    VoucherType.INCOME: INCOME_VOUCHER_SIDES,
    VoucherType.EXPENSE: EXPENSE_VOUCHER_SIDES,
}


def build_lines(voucher_type: str, cash_ledger, lines: list[dict]) -> list[dict]:
    """Return the full, balanced line set (sides filled in) for a voucher.

    `lines` items: {ledger, amount, remarks, side?} — side is required for
    journal lines only. Raises DRF ValidationError on anything that would
    produce an unbalanced voucher.
    """
    voucher_type = VoucherType(voucher_type)
    if voucher_type == VoucherType.JOURNAL:
        return _journal_lines(lines)
    return _cash_vouchered_lines(voucher_type, cash_ledger, lines)


def _journal_lines(lines: list[dict]) -> list[dict]:
    total = {BalanceSide.DEBIT: ZERO, BalanceSide.CREDIT: ZERO}
    for line in lines:
        if not line.get("side"):
            raise serializers.ValidationError(
                {"lines": "Journal lines need an explicit dr/cr side."}
            )
        total[line["side"]] += line["amount"]
    if total[BalanceSide.DEBIT] != total[BalanceSide.CREDIT]:
        raise serializers.ValidationError(
            {
                "lines": f"Journal voucher does not balance "
                f"(Dr {total[BalanceSide.DEBIT]} != Cr {total[BalanceSide.CREDIT]})."
            }
        )
    return lines


def _cash_vouchered_lines(voucher_type, cash_ledger, lines: list[dict]) -> list[dict]:
    if cash_ledger is None:
        raise serializers.ValidationError(
            {"cash_ledger": "Required for income/expense/contra vouchers."}
        )
    cash_side = CASH_LINE_SIDE[voucher_type]
    particular_side = BalanceSide.CREDIT if cash_side == BalanceSide.DEBIT else BalanceSide.DEBIT

    built, total = [], ZERO
    for line in lines:
        if voucher_type == VoucherType.CONTRA:
            side = particular_side  # destinations
        else:
            side = PARTICULAR_SIDES[voucher_type][line["ledger"].group.category]
            if side != particular_side:
                # e.g. an asset-group ledger on an income voucher would land
                # on the same side as the cash line and unbalance the books
                # (legacy only caught this at year close as a "bad entry")
                raise serializers.ValidationError(
                    {
                        "lines": f"Ledger '{line['ledger'].name}' "
                        f"({line['ledger'].group.name}) cannot appear on a "
                        f"{voucher_type.label.lower()} voucher."
                    }
                )
        total += line["amount"]
        built.append({**line, "side": side})
    return [
        {"ledger": cash_ledger, "amount": total, "side": cash_side, "remarks": ""},
        *built,
    ]
