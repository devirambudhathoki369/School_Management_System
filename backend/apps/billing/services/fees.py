"""
Fee resolution with section priority (M5) and standing-discount math.

Legacy `feeq` resolves each title's amount by preferring a fee defined on
the student's exact class (with section) over one defined on the generic
sibling class (same tuple, no section). Discounts follow the verified
production rule: PERCENTAGE WINS when set; the flat amount is only used
when percentage is null. fee_title=None means a transport discount applied
to the student's bus-station fee.
"""

from decimal import Decimal

from apps.academics.models import ClassInfo
from apps.billing.models import FeeSchedule, StandingDiscount


def generic_sibling(class_info: ClassInfo) -> ClassInfo | None:
    """The section-less ClassInfo sharing every other grade field (A3)."""
    if class_info.section_id is None:
        return None
    return ClassInfo.objects.filter(
        school_id=class_info.school_id,
        education_level=class_info.education_level,
        grade=class_info.grade,
        faculty=class_info.faculty,
        course_id=class_info.course_id,
        year=class_info.year,
        semester=class_info.semester,
        academic_year_id=class_info.academic_year_id,
        section__isnull=True,
    ).first()


def resolve_fees(class_info: ClassInfo) -> dict:
    """{fee_title_id: (FeeTitle, amount)} — section-specific overrides generic."""
    resolved: dict = {}
    sibling = generic_sibling(class_info)
    if sibling is not None:
        for fee in FeeSchedule.objects.filter(class_info=sibling).select_related("fee_title"):
            resolved[fee.fee_title_id] = (fee.fee_title, fee.amount)
    for fee in FeeSchedule.objects.filter(class_info=class_info).select_related("fee_title"):
        resolved[fee.fee_title_id] = (fee.fee_title, fee.amount)  # section wins (M5)
    return resolved


def discount_amount(discount: StandingDiscount, rate: Decimal) -> Decimal:
    """Verified legacy rule: percentage of the applicable rate wins; the
    flat amount applies only when percentage is null."""
    if discount.percentage is None:
        return discount.flat_amount or Decimal("0")
    return (discount.percentage / Decimal("100")) * (rate or Decimal("0"))
