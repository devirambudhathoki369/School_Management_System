"""
Year-end: academic-year closing and dues carry-forward (Y1-Y3).

Two distinct legacy flows, both preserved exactly:

1. CLOSING an academic year (legacy AcademicYearCloseView) rolls each
   selected class into a NEW academic year and writes every student's net
   balance (charges - payments - discounts) as an OPENING_BALANCE charge in
   the new year. The closed year is NOT zeroed — single-year reports show
   the same balance in both years, which is why promotion (below) carries
   only the source year.

2. PROMOTING students across academic years (legacy
   carryForwardDuesOnPromotion) MOVES their outstanding source-year balance:
   +amount OPENING_BALANCE charge in the destination year and a balancing
   -amount CARRY_FORWARD_OUT charge in the source year so it nets to zero
   (Y1: moved, not duplicated). Idempotent: a student already carried out of
   a year (has a CARRY_FORWARD_OUT line there) is skipped.

UNDO (Y3) mirrors the legacy hardened undo: it refuses once the new year
has any real activity (payments, or charges beyond the opening balances the
close created), then hard-deletes the close's artifacts and reopens the
old year.
"""

from decimal import ROUND_HALF_UP, Decimal

from django.db import models, transaction
from django.db.models import Sum
from rest_framework import serializers

from apps.academics.models import AcademicYear
from apps.billing.models import (
    BillingYear,
    Charge,
    ChargeBatch,
    ChargeLine,
    FeeTitle,
    LineType,
    Payment,
)
from apps.core.dates import today_bs
from apps.people.models import Student

TWO_PLACES = Decimal("0.01")
ZERO = Decimal("0")


def _student_balances(school, academic_year, *, class_ids=None, student_ids=None) -> dict:
    """Per-student net balance in one academic year — charges minus payments
    minus discounts (regular receipts only; cash receipts are standalone
    income, not dues settlements). Scope by classes (year close) or by
    explicit student ids (promotion carry, whose students have already moved
    to the target class when this runs)."""
    scope = {"school": school, "academic_year": academic_year, "student__is_active": True}
    if class_ids is not None:
        scope["student__class_info__in"] = class_ids
    if student_ids is not None:
        scope["student_id__in"] = student_ids
    balances: dict = {}
    charge_rows = (
        Charge.objects.filter(**scope).values("student_id").annotate(total=Sum("total"))
    )
    for row in charge_rows:
        balances[row["student_id"]] = row["total"] or ZERO
    payment_rows = (
        Payment.objects.filter(**scope, kind=FeeTitle.Kind.REGULAR)
        .values("student_id")
        .annotate(paid=Sum("total_paid"), discount=Sum("total_discount"))
    )
    for row in payment_rows:
        balances[row["student_id"]] = (
            balances.get(row["student_id"], ZERO)
            - (row["paid"] or ZERO)
            - (row["discount"] or ZERO)
        )
    return balances


def _mismatch_exists(school, class_ids, academic_year) -> bool:
    """Y2 drift guard: financial rows for these classes' students sitting in
    a DIFFERENT open academic year block the close (legacy mismatch search)."""
    scope = {
        "school": school,
        "student__is_active": True,
        "student__class_info__in": class_ids,
    }
    stray_charges = (
        Charge.objects.filter(**scope, academic_year__closed=False)
        .exclude(academic_year=academic_year)
        .exists()
    )
    stray_payments = (
        Payment.objects.filter(**scope, academic_year__closed=False, kind=FeeTitle.Kind.REGULAR)
        .exclude(academic_year=academic_year)
        .exists()
    )
    return stray_charges or stray_payments


def _opening_balance_charge(batch, student_id, amount, date_bs):
    charge = Charge(
        school_id=batch.school_id,
        batch=batch,
        student_id=student_id,
        date_bs=date_bs,
        academic_year_id=batch.academic_year_id,
        billing_year_id=batch.billing_year_id,
        total=amount,
    )
    line = ChargeLine(
        charge=charge,
        line_type=LineType.OPENING_BALANCE,
        label="Opening balance",
        amount=amount,
    )
    return charge, line


def close_academic_year(school, pointer, classes, new_year_data, billing_year, actor):
    """Close `pointer.academic_year` for the given classes (Y1/Y2).

    Creates the new AcademicYear, writes one OPENING_BALANCE charge per
    student with a nonzero balance (credit balances carry too — prepaid
    money must not vanish), marks the year closed, rolls the pointer
    (keeping `previous_academic_year` for undo) and the classes.
    """
    academic_year = pointer.academic_year
    if academic_year.closed:
        raise serializers.ValidationError("This academic year is already closed.")
    if not classes:
        raise serializers.ValidationError("Select at least one class to close.")
    class_ids = [cls.id for cls in classes]
    for cls in classes:
        if cls.academic_year_id != academic_year.id:
            raise serializers.ValidationError(
                f"Class '{cls}' does not run in {academic_year.name} (Y2 guard)."
            )
    if _mismatch_exists(school, class_ids, academic_year):
        raise serializers.ValidationError(
            "Charges or payments exist under a different open academic year "
            "for these classes; fix the drift first (Y2 guard)."
        )

    balances = _student_balances(school, academic_year, class_ids=class_ids)
    date_bs = today_bs()
    by_class = {
        row["id"]: row["class_info_id"]
        for row in Student.objects.filter(id__in=balances).values("id", "class_info_id")
    }

    with transaction.atomic():
        new_year = AcademicYear.objects.create(school=school, **new_year_data)
        charges, lines, batches = [], [], {}
        for student_id, balance in balances.items():
            balance = balance.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
            if balance == ZERO:
                continue
            class_id = by_class[student_id]
            batch = batches.get(class_id)
            if batch is None:
                batch = ChargeBatch.objects.create(
                    school=school, date_bs=date_bs, months=[],
                    academic_year=new_year, billing_year=billing_year,
                    class_info_id=class_id, created_by=actor,
                    remarks=f"Year close {academic_year.name}",
                )
                batches[class_id] = batch
            charge, line = _opening_balance_charge(batch, student_id, balance, date_bs)
            charges.append(charge)
            lines.append(line)
        Charge.objects.bulk_create(charges)
        ChargeLine.objects.bulk_create(lines)

        academic_year.closed = True
        academic_year.save(update_fields=["closed", "updated_at"])
        pointer.previous_academic_year = academic_year
        pointer.academic_year = new_year
        pointer.save(update_fields=["academic_year", "previous_academic_year", "updated_at"])
        for cls in classes:
            cls.academic_year = new_year
        type(classes[0]).objects.bulk_update(classes, ["academic_year"])
    return new_year


def undo_academic_year_close(school, pointer):
    """Y3: reverse the last close on this pointer. Refuses once the new
    year has real activity — undo hard-deletes every charge in the new
    year, so anything beyond the close's own opening balances must block."""
    new_year = pointer.academic_year
    old_year = pointer.previous_academic_year
    if old_year is None or not old_year.closed:
        raise serializers.ValidationError("Nothing to undo on this pointer.")

    has_payments = Payment.objects.filter(school=school, academic_year=new_year).exists()
    has_real_charges = (
        Charge.objects.filter(school=school, academic_year=new_year)
        .exclude(
            lines__line_type=LineType.OPENING_BALANCE,
        )
        .exists()
    )
    if has_payments or has_real_charges:
        raise serializers.ValidationError(
            "Undo blocked: the new academic year already has activity "
            "(payments or charges beyond opening balances)."
        )

    try:
        with transaction.atomic():
            Charge.all_objects.filter(school=school, academic_year=new_year).delete()
            ChargeBatch.all_objects.filter(school=school, academic_year=new_year).delete()
            new_year.classes.update(academic_year=old_year)
            pointer.academic_year = old_year
            pointer.previous_academic_year = None
            pointer.save(
                update_fields=["academic_year", "previous_academic_year", "updated_at"]
            )
            old_year.closed = False
            old_year.save(update_fields=["closed", "updated_at"])
            new_year.delete()  # hard delete: the year never really happened
    except models.ProtectedError as exc:
        raise serializers.ValidationError(
            "Undo blocked: other records (exams, attendance, ...) already "
            "reference the new academic year."
        ) from exc
    return old_year


def carry_forward_on_promotion(students, source_class, target_class, actor=None):
    """Move promoted students' outstanding SOURCE-year balances into the
    target class's academic year (ob in the new year, negative cfo in the
    old — M7: cfo is never collectable). No-op when both classes run the
    same year. Runs inside the caller's transaction."""
    src_year_id = source_class.academic_year_id
    dst_year_id = target_class.academic_year_id
    if not src_year_id or not dst_year_id or src_year_id == dst_year_id:
        return 0
    billing_year = BillingYear.objects.filter(closed=False).order_by("-name").first()
    if billing_year is None:
        raise serializers.ValidationError("No open billing year to post the carry-forward.")

    school = target_class.school
    student_ids = [student.id for student in students]
    balances = _student_balances(
        school, AcademicYear.objects.get(id=src_year_id), student_ids=student_ids
    )
    already_carried = set(
        ChargeLine.objects.filter(
            charge__student_id__in=student_ids,
            charge__academic_year_id=src_year_id,
            line_type=LineType.CARRY_FORWARD_OUT,
        ).values_list("charge__student_id", flat=True)
    )

    date_bs = today_bs()
    dst_batch, src_batch = None, None
    charges, lines = [], []
    carried = 0
    for student_id in student_ids:
        amount = balances.get(student_id, ZERO).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
        if amount <= ZERO or student_id in already_carried:
            continue
        if dst_batch is None:
            common = {
                "school": school, "date_bs": date_bs, "months": [],
                "billing_year": billing_year, "class_info": target_class,
                "created_by": actor, "remarks": "Promotion dues carry-forward",
            }
            dst_batch = ChargeBatch.objects.create(academic_year_id=dst_year_id, **common)
            src_batch = ChargeBatch.objects.create(academic_year_id=src_year_id, **common)
        charge, line = _opening_balance_charge(dst_batch, student_id, amount, date_bs)
        charges.append(charge)
        lines.append(line)
        out_charge = Charge(
            school=school, batch=src_batch, student_id=student_id, date_bs=date_bs,
            academic_year_id=src_year_id, billing_year=billing_year, total=-amount,
        )
        charges.append(out_charge)
        lines.append(
            ChargeLine(
                charge=out_charge, line_type=LineType.CARRY_FORWARD_OUT,
                label="Carried forward", amount=-amount,
            )
        )
        carried += 1
    Charge.objects.bulk_create(charges)
    ChargeLine.objects.bulk_create(lines)
    return carried
