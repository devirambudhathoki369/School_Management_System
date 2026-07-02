"""
Dues: what a student still owes = charges - (payments + payment discounts).

Respects M1 (total_paid is pre-discount, so the discount column settles debt
too) and M7 (carry-forward-out lines are already negative inside charge
totals, so closed-year dues net to zero by construction). Cash receipts are
standalone income and never settle dues.
"""

from decimal import Decimal

from django.db.models import Sum

from apps.billing.models import Charge, FeeTitle, Payment


def student_dues(student) -> Decimal:
    charged = (
        Charge.objects.filter(student=student).aggregate(total=Sum("total"))["total"]
        or Decimal("0")
    )
    paid_row = Payment.objects.filter(
        student=student, kind=FeeTitle.Kind.REGULAR
    ).aggregate(paid=Sum("total_paid"), discount=Sum("total_discount"))
    paid = (paid_row["paid"] or Decimal("0")) + (paid_row["discount"] or Decimal("0"))
    return charged - paid
