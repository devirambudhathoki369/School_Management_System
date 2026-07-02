"""
Charge generation: one billing run -> one Charge per running student (M8),
with a discount-aware per-title line breakdown.

A fee title applies once per month in (title.months ∩ batch.months); titles
with no month list apply once per batch. Transport is charged per month
from the student's bus-station fee (module pending — hook in place).
Standing discounts scoped to the batch's academic year (D2) become negative
DISCOUNT lines. Charge.total always equals the sum of its lines.
"""

from decimal import Decimal

from django.db import transaction

from apps.billing.models import Charge, ChargeBatch, ChargeLine, LineType, StandingDiscount
from apps.billing.services.fees import discount_amount, resolve_fees
from apps.people.models import Student


@transaction.atomic
def generate(batch: ChargeBatch) -> int:
    fees = resolve_fees(batch.class_info)
    months = set(batch.months or [])

    discounts_by_student: dict = {}
    for discount in StandingDiscount.objects.filter(
        school_id=batch.school_id,
        student__class_info=batch.class_info,
        academic_year=batch.academic_year,
    ).select_related("fee_title"):
        discounts_by_student.setdefault(discount.student_id, []).append(discount)

    students = Student.objects.filter(
        class_info=batch.class_info, status=Student.Status.RUNNING
    )
    created = 0
    for student in students:
        lines: list[ChargeLine] = []
        for title_id, (title, amount) in fees.items():
            applicable = len(months & set(title.months)) if title.months else 1
            if applicable == 0:
                continue
            lines.append(ChargeLine(
                line_type=LineType.FEE, fee_title_id=title_id,
                label=title.name, amount=amount * applicable,
            ))
        for discount in discounts_by_student.get(student.id, []):
            if discount.fee_title_id is None:
                continue  # transport discount applies with the transport module
            fee = fees.get(discount.fee_title_id)
            if fee is None:
                continue
            value = discount_amount(discount, fee[1])
            if value:
                lines.append(ChargeLine(
                    line_type=LineType.DISCOUNT, fee_title_id=discount.fee_title_id,
                    label=f"Discount: {fee[0].name}", amount=-value,
                ))
        if not lines:
            continue
        charge = Charge.objects.create(
            school_id=batch.school_id, batch=batch, student=student,
            date_bs=batch.date_bs, academic_year=batch.academic_year,
            billing_year=batch.billing_year,
            total=sum((line.amount for line in lines), Decimal("0")),
        )
        for line in lines:
            line.charge = charge
        ChargeLine.objects.bulk_create(lines)
        created += 1
    return created
