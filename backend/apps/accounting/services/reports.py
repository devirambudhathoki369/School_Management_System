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
    LedgerGroup,
    OpeningBalance,
    Voucher,
    VoucherLine,
)

ZERO = Decimal("0")
Category = LedgerGroup.Category


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


def _signed_balances(school, fiscal_year, end_date_bs, categories, *, with_openings):
    """Closing balance per ledger, signed TOWARD ITS GROUP'S NATURAL SIDE
    (income/liability/equity read Cr-positive; expense/asset Dr-positive).

    Correction over legacy: legacy report views summed line amounts
    side-blind, so e.g. a refund posted against an income ledger *raised*
    income. Signing against the natural side makes contra entries subtract,
    which is the whole point of double entry.
    """
    lines = _period_lines(
        school, fiscal_year, fiscal_year.start_date_bs, end_date_bs
    ).filter(ledger__group__category__in=categories)
    movements: dict = defaultdict(lambda: ZERO)
    for ledger_id, side, amount in lines.values_list("ledger_id", "side", "amount"):
        movements[ledger_id] += amount if side == BalanceSide.DEBIT else -amount

    balances: dict = defaultdict(lambda: ZERO, movements)
    if with_openings:
        openings = OpeningBalance.objects.filter(
            school=school,
            fiscal_year=fiscal_year,
            ledger__group__category__in=categories,
        ).exclude(amount=0)
        for opening in openings:
            signed = opening.amount if opening.side == BalanceSide.DEBIT else -opening.amount
            balances[opening.ledger_id] += signed

    ledgers = LedgerAccount.objects.filter(
        school=school, id__in=balances
    ).select_related("group")
    rows: dict = {}
    for ledger in ledgers:
        dr_value = balances[ledger.id]
        natural_dr = ledger.group.natural_side == BalanceSide.DEBIT
        rows[ledger.id] = {
            "ledger": ledger,
            # natural-side positive: what the section headings promise
            "amount": dr_value if natural_dr else -dr_value,
        }
    return rows


def _sectioned(rows, category) -> dict:
    """Ledger rows -> group buckets -> one report section with totals."""
    groups: dict = {}
    for row in rows.values():
        ledger = row["ledger"]
        if ledger.group.category != category:
            continue
        bucket = groups.setdefault(
            ledger.group.code,
            {"code": ledger.group.code, "group": ledger.group.name, "total": ZERO, "ledgers": []},
        )
        bucket["ledgers"].append(
            {"id": str(ledger.id), "ledger": ledger.name, "amount": row["amount"]}
        )
        bucket["total"] += row["amount"]
    for bucket in groups.values():
        bucket["ledgers"].sort(key=lambda r: r["ledger"].lower())
    sections = [groups[code] for code in sorted(groups)]
    return {"groups": sections, "total": sum((g["total"] for g in sections), ZERO)}


def income_statement(school, fiscal_year, end_date_bs) -> dict:
    """Profit & loss from the fiscal year's start through `end_date_bs`
    (legacy ProfitLossReportView with two documented corrections):

    - amounts are signed toward the natural side, not summed side-blind;
    - Sales (group 21) counts as INCOME — legacy fetched it as an income
      group but bucketed it into expense when totalling.

    Income/expense ledgers carry no opening balances, so this is purely
    period movement — same as legacy.
    """
    rows = _signed_balances(
        school, fiscal_year, end_date_bs,
        [Category.INCOME, Category.EXPENSE],
        with_openings=False,
    )
    income = _sectioned(rows, Category.INCOME)
    expense = _sectioned(rows, Category.EXPENSE)
    return {
        "income": income["groups"],
        "expense": expense["groups"],
        "total_income": income["total"],
        "total_expense": expense["total"],
        "net": income["total"] - expense["total"],
    }


def balance_sheet(school, fiscal_year, end_date_bs) -> dict:
    """Balance sheet as of `end_date_bs` (legacy BalanceSheetReportView,
    finished): closing balance per asset/liability/equity ledger — opening
    plus movement from the fiscal year's start — plus the period's net
    profit shown inside equity.

    Corrections over legacy:
    - legacy left `net_profit_loss` as a literal TODO (always 0), so its
      sheet could never balance; here equity carries the income statement's
      net for the same window;
    - group membership comes from each group's category, so Bank Occ (4),
      Suspense (28) and opening stock (30) — which legacy skipped as
      "not confirmed" — can't silently fall out of the report.
    """
    rows = _signed_balances(
        school, fiscal_year, end_date_bs,
        [Category.ASSET, Category.LIABILITY, Category.EQUITY],
        with_openings=True,
    )
    assets = _sectioned(rows, Category.ASSET)
    liabilities = _sectioned(rows, Category.LIABILITY)
    equity = _sectioned(rows, Category.EQUITY)
    net = income_statement(school, fiscal_year, end_date_bs)["net"]
    total_equity = equity["total"] + net
    return {
        "assets": assets["groups"],
        "liabilities": liabilities["groups"],
        "equity": equity["groups"],
        "net_profit": net,
        "total_assets": assets["total"],
        "total_liabilities": liabilities["total"],
        "total_equity": total_equity,
        "balanced": assets["total"] == liabilities["total"] + total_equity,
    }


CASH_EQUIVALENT_GROUPS = (3, 7)  # Bank Account, Cash in Hand


def cash_flow_statement(school, fiscal_year, end_date_bs) -> dict:
    """Cash flow (indirect), legacy CashFlowReportView port.

    Every voucher stores all of its legs — income/expense vouchers include
    the cash/bank balancing line — so each ledger's period movement (Dr−Cr)
    is available straight from the lines. The movement of the cash
    equivalents (groups 3, 7) IS the net cash change; every other ledger's
    movement converts to its cash effect (−movement) and classifies as
    operating / investing / financing via the group's cash-flow class.
    Because vouchers balance, activities reconcile to the cash change by
    construction.

    Difference from legacy: the window always starts at the fiscal year's
    start. Legacy accepted any start date but still used the FY opening as
    "opening cash", so a mid-year window silently broke the
    opening + net change = closing identity this report exists to show.
    """
    lines = _period_lines(school, fiscal_year, fiscal_year.start_date_bs, end_date_bs)
    movements: dict = defaultdict(lambda: ZERO)
    for ledger_id, side, amount in lines.values_list("ledger_id", "side", "amount"):
        movements[ledger_id] += amount if side == BalanceSide.DEBIT else -amount

    ledgers = {
        ledger.id: ledger
        for ledger in LedgerAccount.objects.filter(
            school=school, id__in=movements
        ).select_related("group")
    }

    sections: dict[str, list] = {"operating": [], "investing": [], "financing": [], "other": []}
    net_change = ZERO
    net_profit = ZERO
    for ledger_id, movement in movements.items():
        ledger = ledgers.get(ledger_id)
        if ledger is None or movement == ZERO:
            continue
        if ledger.group.code in CASH_EQUIVALENT_GROUPS:
            net_change += movement  # debit-natured: Dr−Cr == net increase
            continue
        cash_impact = -movement
        flow = ledger.group.cash_flow or "other"
        sections.setdefault(flow, sections["other"]).append(
            {"id": str(ledger_id), "ledger": ledger.name, "amount": cash_impact}
        )
        if flow == "operating" and ledger.group.category in (
            Category.INCOME, Category.EXPENSE,
        ):
            net_profit += cash_impact
    for items in sections.values():
        items.sort(key=lambda i: i["ledger"].lower())

    opening_cash = ZERO
    for opening in OpeningBalance.objects.filter(
        school=school, fiscal_year=fiscal_year,
        ledger__group__code__in=CASH_EQUIVALENT_GROUPS,
    ):
        signed = opening.amount if opening.side == BalanceSide.DEBIT else -opening.amount
        opening_cash += signed

    def total(items):
        return sum((i["amount"] for i in items), ZERO)

    return {
        "operating": {
            "items": sections["operating"],
            "total": total(sections["operating"]),
            "net_profit": net_profit,
        },
        "investing": {"items": sections["investing"], "total": total(sections["investing"])},
        "financing": {"items": sections["financing"], "total": total(sections["financing"])},
        "other": {"items": sections["other"], "total": total(sections["other"])},
        "net_change": net_change,
        "opening_cash": opening_cash,
        "closing_cash": opening_cash + net_change,
    }


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
