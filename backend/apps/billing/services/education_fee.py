"""
Education Equality Fee (शिक्षा समता शुल्क) — Nepal FY 2083/84.

A 3% government levy private institutions collect on student charges and
deposit to the IRO every four months. It is a pass-through collected on
behalf of the state — NOT school income and NOT a settlement of any fee
ledger — so it is snapshotted onto the payment's edu_fee_* columns and
never enters total_paid, dues, or revenue reconciliation (M1 untouched).

Targeting is vendor-managed and opt-IN per (school, education level): an
EducationFeeLevel row means every class in that level is levied; no row
means the fee is off (the default). Ported from the legacy
main/methods/educationServiceFee.py contract:

- regular receipts only (cash receipts aren't student fee collections);
- the level comes from the payment's class snapshot (M3);
- base = Σ(amount − discount) over lines with a positive net, excluding
  the receipt-level DISCOUNT pseudo-line (its amounts are already netted
  per line — counting it would subtract the discount twice). Old dues,
  opening balances, transport and library fines ARE taxable;
- fixed 3%, ROUND_HALF_UP to two places.
"""

from decimal import ROUND_HALF_UP, Decimal

from ..models import EducationFeeLevel, LineType

EDU_FEE_PERCENT = Decimal("3")
TWO_PLACES = Decimal("0.01")
ZERO = Decimal("0")


def enabled_levels(school) -> list[str]:
    """Education levels the vendor has enabled for this school (sorted)."""
    return sorted(
        EducationFeeLevel.objects.filter(school=school).values_list(
            "education_level", flat=True
        )
    )


def is_enabled(school, education_level: str | None) -> bool:
    if not education_level:
        return False
    return EducationFeeLevel.objects.filter(
        school=school, education_level=education_level
    ).exists()


def taxable_base(lines) -> Decimal:
    """Net-after-discount sum across taxable lines.

    ``lines`` are the validated line dicts of a payment being created
    (keys: line_type, amount, discount)."""
    base = ZERO
    for line in lines:
        if line.get("line_type") == LineType.DISCOUNT:
            continue
        net = (line.get("amount") or ZERO) - (line.get("discount") or ZERO)
        if net > 0:
            base += net
    return base


def compute_fee(school, education_level: str | None, lines) -> dict | None:
    """The fee snapshot for one receipt, or None when nothing is due."""
    if not is_enabled(school, education_level):
        return None
    base = taxable_base(lines)
    if base <= 0:
        return None
    amount = (base * EDU_FEE_PERCENT / Decimal("100")).quantize(
        TWO_PLACES, rounding=ROUND_HALF_UP
    )
    if amount <= 0:
        return None
    return {
        "pct": EDU_FEE_PERCENT,
        "base": base.quantize(TWO_PLACES, rounding=ROUND_HALF_UP),
        "amount": amount,
    }
