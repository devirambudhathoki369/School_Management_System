"""
Accounting reports: trial balance and ledger statements.

Ports of the legacy TrialBalanceView / AccountingLedgerReportView — direct
aggregates now, because every VoucherLine already stores its Dr/Cr side
(legacy re-derived income/expense sides per report). BS date strings are
zero-padded, so range filters compare lexicographically like legacy's
NepaliDateField.
"""

from collections import defaultdict
from decimal import Decimal

from apps.accounting.models import (
    BalanceSide,
    LedgerAccount,
    OpeningBalance,
    Voucher,
    VoucherLine,
)

ZERO = Decimal("0")


def _period_lines(school, fiscal_year, start_date_bs, end_date_bs):
    return VoucherLine.objects.filter(
        voucher__school=school,
        voucher__fiscal_year=fiscal_year,
        voucher__is_active=True,
        voucher__date_bs__gte=start_date_bs,
        voucher__date_bs__lte=end_date_bs,
    )


def trial_balance(school, fiscal_year, start_date_bs, end_date_bs) -> dict:
    """Group-wise trial balance: opening, period movement and closing per
    ledger, subtotalled per ledger group (legacy prepareTrialBalance).

    Correction over legacy: a ledger with an opening balance but no period
    movement appears here with its opening carried into closing. Legacy
    iterated particulars only, so such ledgers (and their openings) fell
    out of the report and the totals."""
    openings = {
        ob.ledger_id: ob
        for ob in OpeningBalance.objects.filter(school=school, fiscal_year=fiscal_year)
        .exclude(amount=0)
        .select_related()
    }
    movements = _period_lines(school, fiscal_year, start_date_bs, end_date_bs).values_list(
        "ledger_id", "side", "amount"
    )

    per_ledger: dict = defaultdict(lambda: {"debit": ZERO, "credit": ZERO})
    for ledger_id, side, amount in movements:
        key = "debit" if side == BalanceSide.DEBIT else "credit"
        per_ledger[ledger_id][key] += amount

    ledgers = LedgerAccount.objects.filter(
        school=school, id__in=set(per_ledger) | set(openings)
    ).select_related("group")

    groups: dict = {}
    totals = defaultdict(lambda: ZERO)
    for ledger in ledgers:
        opening = openings.get(ledger.id)
        opening_debit = opening.amount if opening and opening.side == BalanceSide.DEBIT else ZERO
        opening_credit = opening.amount if opening and opening.side == BalanceSide.CREDIT else ZERO
        movement = per_ledger.get(ledger.id, {"debit": ZERO, "credit": ZERO})
        row = {
            "id": str(ledger.id),
            "ledger": ledger.name,
            "opening_debit": opening_debit,
            "opening_credit": opening_credit,
            "debit": movement["debit"],
            "credit": movement["credit"],
            "closing_debit": opening_debit + movement["debit"],
            "closing_credit": opening_credit + movement["credit"],
        }
        group = groups.setdefault(
            ledger.group.code,
            {
                "group": ledger.group.name,
                "group_opening_debit": ZERO, "group_opening_credit": ZERO,
                "group_debit": ZERO, "group_credit": ZERO,
                "group_closing_debit": ZERO, "group_closing_credit": ZERO,
                "ledgers": [],
            },
        )
        group["ledgers"].append(row)
        for prefix in ("opening_", "", "closing_"):
            group[f"group_{prefix}debit"] += row[f"{prefix}debit"]
            group[f"group_{prefix}credit"] += row[f"{prefix}credit"]
            totals[f"total_{prefix}debit"] += row[f"{prefix}debit"]
            totals[f"total_{prefix}credit"] += row[f"{prefix}credit"]

    return {
        "data": [groups[code] for code in sorted(groups)],
        "total_opening_debit": totals["total_opening_debit"],
        "total_opening_credit": totals["total_opening_credit"],
        "total_debit": totals["total_debit"],
        "total_credit": totals["total_credit"],
        "total_closing_debit": totals["total_closing_debit"],
        "total_closing_credit": totals["total_closing_credit"],
    }


def ledger_statement(school, fiscal_year, ledger, start_date_bs, end_date_bs) -> list[dict]:
    """Individual ledger report: the ledger's activity shown through its
    COUNTERPARTIES (legacy getSingleSide):

    - the ledger is the lone row on its side -> show every opposite row;
    - the entry has some other lone side -> show that lone row, but with
      this ledger's own amount and remark;
    - no lone side (many-to-many journal) -> the entry is not displayable
      as a counterparty view and is skipped (legacy behaviour).

    The first row is the fiscal year's opening balance (legacy prepends it).
    """
    entries: list[dict] = []
    opening = OpeningBalance.objects.filter(
        school=school, fiscal_year=fiscal_year, ledger=ledger
    ).first()
    entries.append({
        "kind": "opening",
        "side": opening.side if opening else None,
        "amount": opening.amount if opening else ZERO,
        "ledger": f"Opening balance on {fiscal_year.start_date_bs}",
    })

    voucher_ids = (
        _period_lines(school, fiscal_year, start_date_bs, end_date_bs)
        .filter(ledger=ledger)
        .values_list("voucher_id", flat=True)
    )
    vouchers = (
        Voucher.objects.filter(id__in=voucher_ids)
        .prefetch_related("lines__ledger")
        .order_by("date_bs", "created_at")
    )
    for voucher in vouchers:
        lines = list(voucher.lines.all())
        debits = [line for line in lines if line.side == BalanceSide.DEBIT]
        credits = [line for line in lines if line.side == BalanceSide.CREDIT]
        lone = debits[0] if len(debits) == 1 else credits[0] if len(credits) == 1 else None
        if lone is None:
            continue
        base = {"kind": "voucher", "voucher": voucher.number, "date_bs": voucher.date_bs}
        if lone.ledger_id == ledger.id:
            entries.extend(
                {
                    **base,
                    "side": line.side,
                    "amount": line.amount,
                    "ledger": line.ledger.name,
                    "narration": line.remarks,
                }
                for line in lines
                if line.ledger_id != ledger.id and line.amount != ZERO
            )
        else:
            own = [line for line in lines if line.ledger_id == ledger.id]
            amount = sum((line.amount for line in own), ZERO)
            if amount != ZERO:
                entries.append({
                    **base,
                    "side": lone.side,
                    "amount": amount,
                    "ledger": lone.ledger.name,
                    "narration": next((o.remarks for o in own if o.remarks), ""),
                })
    return entries


def group_statement(school, fiscal_year, group_codes, start_date_bs, end_date_bs) -> list[dict]:
    """Group-wise ledger report: every period line whose ledger belongs to
    the requested groups (legacy ReportKind.GROUPWISE)."""
    lines = (
        _period_lines(school, fiscal_year, start_date_bs, end_date_bs)
        .filter(ledger__group__in=group_codes)
        .select_related("ledger", "voucher")
        .order_by("voucher__date_bs", "voucher__created_at", "created_at")
    )
    return [
        {
            "kind": "voucher",
            "voucher": line.voucher.number,
            "date_bs": line.voucher.date_bs,
            "ledger": line.ledger.name,
            "side": line.side,
            "amount": line.amount,
            "narration": line.remarks,
        }
        for line in lines
    ]
