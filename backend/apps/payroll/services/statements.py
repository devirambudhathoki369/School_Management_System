"""
Payroll reporting: per-head balances, the staff statement (legacy "trial
balance") and the school salary sheet.

Exact ports of LedgerViewsStaff.calculateStaffLedger, StaffInvoiceView.
getTrialBalance and SalarySheet from the legacy backend — but trivial now,
because accrual/payment lines already carry gross amounts per head instead
of JSON with a post-deduction total (the M1 asymmetry).

Note: line querysets always filter the parent's is_active explicitly —
related-object traversal bypasses the ActiveManager.
"""

from decimal import Decimal

from django.db.models import Q, Sum

from apps.payroll.models import (
    EarningType,
    SalaryAccrual,
    SalaryAccrualLine,
    SalaryPayment,
    SalaryPaymentLine,
)
from apps.people.models import Staff

ZERO = Decimal("0")


def _sum_by_head(line_qs) -> dict:
    heads = dict.fromkeys(EarningType.values, ZERO)
    for row in line_qs.values("earning_type").annotate(total=Sum("amount")):
        heads[row["earning_type"]] += row["total"]
    return heads


def head_balances(staff, billing_year=None) -> dict:
    """Outstanding gross balance per earning head: accrued minus settled.

    Legacy calculateStaffLedger subtracted per-title `amt` (gross) from the
    accrued totals, and for breakdown-less invoices subtracted total_paid
    plus every deduction — i.e. always the gross. Payment lines store gross,
    so both cases collapse to one subtraction.
    """
    accrual_lines = SalaryAccrualLine.objects.filter(
        accrual__staff=staff, accrual__is_active=True
    )
    payment_lines = SalaryPaymentLine.objects.filter(
        payment__staff=staff, payment__is_active=True
    )
    if billing_year is not None:
        accrual_lines = accrual_lines.filter(accrual__billing_year=billing_year)
        payment_lines = payment_lines.filter(payment__billing_year=billing_year)

    accrued = _sum_by_head(accrual_lines)
    settled = _sum_by_head(payment_lines)
    balances = {head: accrued[head] - settled[head] for head in EarningType.values}
    return {**balances, "total": sum(balances.values(), ZERO)}


def statement(staff) -> list[dict]:
    """Chronological account statement: accruals as debits, payments as
    credits, plus one row per withholding (TDS/PF/insurance settle the
    salary liability too, so each appears as its own entry)."""
    entries = []
    for accrual in SalaryAccrual.objects.filter(staff=staff).prefetch_related("lines"):
        entries.append({
            "id": str(accrual.id),
            "kind": "accrual",
            "date_bs": accrual.date_bs,
            "months": accrual.months,
            "debit": accrual.total,
            "particulars": [
                [line.earning_type, line.amount] for line in accrual.lines.all()
            ],
        })
    for payment in SalaryPayment.objects.filter(staff=staff).prefetch_related("lines"):
        serial = payment.serial or payment.legacy_serial
        entries.append({
            "id": str(payment.id),
            "kind": "payment",
            "date_bs": payment.date_bs,
            "months": [payment.payment_month],
            "serial": serial,
            "credit": payment.net_paid,
            # net per head, like the legacy statement (amt - tdsa)
            "particulars": [
                [line.earning_type, line.amount - (line.tds_amount or ZERO)]
                for line in payment.lines.all()
            ],
        })
        for label, amount in (
            ("TDS", payment.tds_amount),
            ("PF", payment.pf_amount),
            ("Insurance", payment.insurance_amount),
        ):
            if amount:
                entries.append({
                    "id": str(payment.id),
                    "kind": "deduction",
                    "date_bs": payment.date_bs,
                    "months": [payment.payment_month],
                    "serial": serial,
                    "deduction": amount,
                    "particulars": [[f"{label} on payment {serial}", amount]],
                })
    entries.sort(key=lambda entry: entry["date_bs"])
    return entries


def salary_sheet(school, start_date_bs: str, end_date_bs: str) -> list[dict]:
    """Per-staff payroll summary for a BS date range (employed staff only):
    gross accrued per head, withholdings, net payable, cash paid, balance."""
    in_range = Q(date_bs__gte=start_date_bs, date_bs__lte=end_date_bs)
    rows = []
    staff_qs = (
        Staff.objects.filter(school=school, status=Staff.Status.EMPLOYED)
        .select_related("role")
        .order_by("first_name", "middle_name", "last_name")
    )
    for staff in staff_qs:
        heads = _sum_by_head(
            SalaryAccrualLine.objects.filter(
                accrual__in=SalaryAccrual.objects.filter(in_range, staff=staff)
            )
        )
        gross = sum(heads.values(), ZERO)

        paid = SalaryPayment.objects.filter(in_range, staff=staff).aggregate(
            net_paid=Sum("net_paid"), tds=Sum("tds_amount"),
            pf=Sum("pf_amount"), insurance=Sum("insurance_amount"),
        )
        tds = paid["tds"] or ZERO
        pf = paid["pf"] or ZERO
        insurance = paid["insurance"] or ZERO
        net_paid = paid["net_paid"] or ZERO
        deduction = tds + pf + insurance
        net_salary = gross - deduction
        rows.append({
            "staff": str(staff.id),
            "name": staff.full_name,
            "designation": staff.role.name,
            **heads,
            "total": gross,
            "tax": tds,
            "pf": pf,
            "insurance": insurance,
            "deduction": deduction,
            "net": net_salary,
            "paid": net_paid,
            "balance": net_salary - net_paid,
        })
    return rows


def posted_months(school, staff=None, academic_year=None, billing_year=None) -> list[int]:
    """Months already accrued in a scope — the frontend uses this to stop
    double posting (legacy StaffLedgerView months mode)."""
    qs = SalaryAccrual.objects.filter(school=school)
    if staff is not None:
        qs = qs.filter(staff=staff)
    if academic_year is not None:
        qs = qs.filter(academic_year=academic_year)
    if billing_year is not None:
        qs = qs.filter(billing_year=billing_year)
    months: set[int] = set()
    for row in qs.values_list("months", flat=True):
        months.update(row)
    return sorted(months)
