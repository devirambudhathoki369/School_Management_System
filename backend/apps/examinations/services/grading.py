"""
Result/grading engine — an exact port of the legacy calculation
(Cent-New ResultCalculation + letter_grade constants), made server-
authoritative: marks entry stores what this engine computes, never what a
client asserts.

Default national bands (per-school GradingScheme bands override *remarks*
only, exactly as legacy did):
    %>=90 -> 4.0/A+, 80 -> 3.6/A, 70 -> 3.2/B+, 60 -> 2.8/B, 50 -> 2.4/C+,
    40 -> 2.0/C, 35 -> 1.6/D, <35 -> 0.0/NG
"""

from decimal import ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")

# (min_percent, max_percent, grade_point, letter)
DEFAULT_BANDS: list[tuple[Decimal, Decimal, Decimal, str]] = [
    (Decimal("90"), Decimal("100"), Decimal("4.0"), "A+"),
    (Decimal("80"), Decimal("89.99"), Decimal("3.6"), "A"),
    (Decimal("70"), Decimal("79.99"), Decimal("3.2"), "B+"),
    (Decimal("60"), Decimal("69.99"), Decimal("2.8"), "B"),
    (Decimal("50"), Decimal("59.99"), Decimal("2.4"), "C+"),
    (Decimal("40"), Decimal("49.99"), Decimal("2.0"), "C"),
    (Decimal("35"), Decimal("39.99"), Decimal("1.6"), "D"),
    (Decimal("0"), Decimal("34.99"), Decimal("0.0"), "NG"),
]

# (min_gp_exclusive, max_gp_inclusive, letter) — legacy GP_LETTER_GRADING
GP_LETTERS: list[tuple[Decimal, Decimal, str]] = [
    (Decimal("3.6"), Decimal("4.0"), "A+"),
    (Decimal("3.2"), Decimal("3.6"), "A"),
    (Decimal("2.8"), Decimal("3.2"), "B+"),
    (Decimal("2.4"), Decimal("2.8"), "B"),
    (Decimal("2.0"), Decimal("2.4"), "C+"),
    (Decimal("1.6"), Decimal("2.0"), "C"),
    (Decimal("1.2"), Decimal("1.6"), "D"),
    (Decimal("0.0"), Decimal("1.2"), "NG"),
]


def _round2(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def percentage(score: Decimal | None, full_marks: Decimal | None) -> Decimal:
    if not score or not full_marks:
        return Decimal("0")
    return _round2(Decimal(score) / Decimal(full_marks) * 100)


def grade_point(score: Decimal | None, full_marks: Decimal | None = None) -> Decimal:
    pct = percentage(score, full_marks) if full_marks else Decimal(score or 0)
    for band_min, band_max, point, _letter in DEFAULT_BANDS:
        if band_min <= pct <= band_max:
            return point
    return Decimal("0")


def letter_grade(score: Decimal | None, full_marks: Decimal | None = None) -> str:
    pct = percentage(score, full_marks) if full_marks else Decimal(score or 0)
    for band_min, band_max, _point, letter in DEFAULT_BANDS:
        if band_min <= pct <= band_max:
            return letter
    return ""


def gp_letter(gp: Decimal) -> str:
    """Letter for an aggregated grade point (legacy: min exclusive)."""
    if gp < 1:
        return "NG"
    for band_min, band_max, letter in GP_LETTERS:
        if band_min < gp <= band_max:
            return letter
    return ""


def weighted_grade_point(
    gp_theory: Decimal,
    gp_practical: Decimal,
    credit_hours: Decimal,
    credit_hours_practical: Decimal,
) -> Decimal:
    """Final subject GP: credit-hour-weighted mean of theory and practical."""
    total_hours = credit_hours + credit_hours_practical
    weighted = gp_theory * credit_hours + gp_practical * credit_hours_practical
    return _round2(weighted / total_hours)


def gpa(sum_weighted_gp: Decimal, sum_credit_hours: Decimal) -> Decimal:
    return _round2(sum_weighted_gp / sum_credit_hours)


def remarks_for(score: Decimal, bands) -> str:
    """School-configured remarks band for a score (min/max inclusive)."""
    for band in bands:
        if Decimal(band.min_score) <= score <= Decimal(band.max_score):
            return band.remarks
    return ""


def compute_marks(
    *,
    theory: Decimal | None,
    practical: Decimal | None,
    absent: bool,
    sheet,
) -> tuple[Decimal, bool]:
    """
    Server-authoritative (total, passed) for one student on one sheet.

    - Absent students score 0 and fail.
    - A component passes when it meets its own pass marks (theory/practical
      split when configured, else the overall pass marks).
    """
    if absent:
        return Decimal("0"), False
    theory = Decimal(theory) if theory is not None else None
    practical = Decimal(practical) if practical is not None else None
    total = (theory or Decimal("0")) + (practical or Decimal("0"))

    if sheet.pass_marks_theory is not None:
        theory_ok = (theory or Decimal("0")) >= sheet.pass_marks_theory
    else:
        theory_ok = True
    if sheet.pass_marks_practical is not None and sheet.full_marks_practical:
        practical_ok = (practical or Decimal("0")) >= sheet.pass_marks_practical
    else:
        practical_ok = True
    passed = theory_ok and practical_ok and total >= sheet.pass_marks
    return total, passed
