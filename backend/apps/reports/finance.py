"""
Finance reports — the billing half of the legacy "Reports" menu.

Ports (legacy leaf → endpoint):
- Recent transactions / Transactions history → TransactionsReportView
- Recent postings / Ledger posting history    → PostingsReportView
- Opening balance report                      → OpeningBalanceReportView
- Overall remaining dues                      → DuesReportView
- Overall student ledgers / balance range     → StudentLedgersReportView
- Income plan / Overall income plan           → IncomePlanReportView
- Discount history                            → StandingDiscountsReportView
- Payment discount report                     → PaymentDiscountsReportView
- Invoices/Ledgers AY-mismatch finders        → IntegrityReportView (admin)

Invariants respected throughout: M1 (total_paid is pre-discount, so credit =
paid + discount), M3 (a payment's class is its snapshot, falling back to the
student's current class only when no snapshot exists), M4 (line labels are
write-time snapshots and are always preferred over live titles), M5/D1 via
apps.billing.services.fees.
"""

from collections import defaultdict
from decimal import Decimal

from django.db.models import (
    Count, DecimalField, F, Max, Min, OuterRef, Prefetch, Q, Subquery, Sum,
)
from django.db.models.functions import Coalesce
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.academics.models import AcademicYear, ClassInfo
from apps.billing.models import (
    Charge,
    ChargeBatch,
    ChargeLine,
    FeeSchedule,
    FeeTitle,
    LineType,
    Payment,
    PaymentLine,
    StandingDiscount,
)
from apps.core.dates import today_bs
from apps.identity.models import Role
from apps.people.models import Student
from apps.transport.models import RiderSubscription

from .base import ROW_CAP, ReportView, actor_label

ZERO = Decimal("0")


def _academic_year(request, school, required: bool = False) -> AcademicYear | None:
    ay_id = request.query_params.get("academic_year")
    if not ay_id:
        if required:
            raise ValidationError({"academic_year": "This field is required."})
        return None
    year = AcademicYear.objects.filter(school=school, id=ay_id).first()
    if year is None:
        raise ValidationError({"academic_year": "Unknown academic year."})
    return year


def _class_info(request, school) -> ClassInfo | None:
    class_id = request.query_params.get("class_info")
    if not class_id:
        return None
    class_info = ClassInfo.objects.filter(school=school, id=class_id).first()
    if class_info is None:
        raise ValidationError({"class_info": "Unknown class."})
    return class_info


class TransactionsReportView(ReportView):
    """Payment register with per-title line breakdown.

    Legacy rule kept: an explicit date range REPLACES the academic-year
    filter (otherwise a custom range falling outside the AY window would
    AND-out to zero rows)."""

    permission_code = "billing"

    def get(self, request):
        school = self.school(request)
        from_bs, to_bs = self.bs_range(request)
        year = _academic_year(request, school)
        class_info = _class_info(request, school)
        kind = request.query_params.get("kind")
        fee_title_id = request.query_params.get("fee_title")
        cashier = request.query_params.get("cashier")

        include_inactive = (
            request.query_params.get("include_inactive") == "true"
            and request.user.role == Role.ADMIN
        )
        manager = Payment.all_objects if include_inactive else Payment.objects

        qs = manager.filter(school=school)
        if from_bs and to_bs:
            qs = qs.filter(date_bs__gte=from_bs, date_bs__lte=to_bs)
        elif year is not None:
            qs = qs.filter(academic_year=year)
        if class_info is not None:
            # M3: the payment-time snapshot wins; students promoted out still
            # report under the class they paid in.
            qs = qs.filter(
                Q(class_info=class_info)
                | Q(class_info__isnull=True, student__class_info=class_info)
            )
        if kind in (FeeTitle.Kind.REGULAR, FeeTitle.Kind.CASH_RECEIPT):
            qs = qs.filter(kind=kind)
        if cashier:
            qs = qs.filter(created_by_id=cashier)
        if fee_title_id:
            qs = qs.filter(lines__fee_title_id=fee_title_id).distinct()

        summary = qs.aggregate(
            count=Count("id"),
            total_paid=Sum("total_paid"),
            total_discount=Sum("total_discount"),
            edu_fee=Sum("edu_fee_amount"),
            date_from=Min("date_bs"),
            date_to=Max("date_bs"),
            serial_from=Min(Coalesce("serial", "legacy_serial")),
            serial_to=Max(Coalesce("serial", "legacy_serial")),
        )

        rows = []
        payments = (
            qs.select_related(
                "student", "class_info", "student__class_info", "academic_year",
                "created_by", "created_by__staff_profile",
            )
            .prefetch_related(
                Prefetch("lines", queryset=PaymentLine.objects.select_related("fee_title"))
            )
            .order_by("date_bs", "created_at")[:ROW_CAP]
        )
        for p in payments:
            effective_class = p.class_info or (p.student.class_info if p.student_id else None)
            lines = p.lines.all()
            if fee_title_id:
                # Legacy narrows the breakdown to the picked title only.
                lines = [ln for ln in lines if str(ln.fee_title_id) == fee_title_id]
            rows.append({
                "id": str(p.id),
                "serial": p.serial or p.legacy_serial,
                "date_bs": p.date_bs,
                "kind": p.kind,
                "mode": p.mode,
                "name": p.student.full_name if p.student_id else (p.payer_name or "Cash receipt"),
                "class_label": str(effective_class) if effective_class else "",
                "academic_year": p.academic_year.name,
                "total_paid": p.total_paid,
                "total_discount": p.total_discount or ZERO,
                "edu_fee": p.edu_fee_amount,
                "cashier": actor_label(p.created_by),
                "is_active": p.is_active,
                "lines": [
                    {"label": ln.display_label, "line_type": ln.line_type,
                     "amount": ln.amount, "discount": ln.discount}
                    for ln in lines
                ],
            })
        return Response({
            "rows": rows,
            "summary": {
                "count": summary["count"],
                "total_paid": summary["total_paid"] or ZERO,
                "total_discount": summary["total_discount"] or ZERO,
                "edu_fee": summary["edu_fee"] or ZERO,
                "date_from": summary["date_from"],
                "date_to": summary["date_to"],
                "serial_from": summary["serial_from"],
                "serial_to": summary["serial_to"],
            },
            "truncated": summary["count"] > len(rows),
        })


class PostingsReportView(ReportView):
    """Charge-batch (billing run) history with a per-title breakdown."""

    permission_code = "billing"

    def get(self, request):
        school = self.school(request)
        from_bs, to_bs = self.bs_range(request)
        year = _academic_year(request, school)
        class_info = _class_info(request, school)

        qs = ChargeBatch.objects.filter(school=school)
        if year is not None:
            qs = qs.filter(academic_year=year)
        if class_info is not None:
            qs = qs.filter(class_info=class_info)
        if from_bs and to_bs:
            qs = qs.filter(date_bs__gte=from_bs, date_bs__lte=to_bs)

        # Related-manager joins bypass the soft-delete manager, so the
        # active-rows filter must be explicit on every charge aggregate.
        live = Q(charges__is_active=True)
        total_batches = qs.count()
        batches = list(
            qs.select_related("class_info", "academic_year", "created_by",
                              "created_by__staff_profile")
            .annotate(
                charge_count=Count("charges", filter=live),
                total=Sum("charges__total", filter=live),
            )
            .order_by("-date_bs", "-created_at")[:ROW_CAP]
        )
        breakdown: dict = defaultdict(dict)
        for line in (
            ChargeLine.objects.filter(
                charge__batch__in=[b.id for b in batches], charge__is_active=True
            )
            .values("charge__batch", "label", "fee_title__name")
            .annotate(amount=Sum("amount"))
            .order_by("label")
        ):
            # Numeric-id snapshot labels resolve to the live title name; merge
            # groups that land on the same display label.
            label = line["label"]
            if label.isdigit() and line["fee_title__name"]:
                label = line["fee_title__name"]
            per_batch = breakdown[line["charge__batch"]]
            per_batch[label] = per_batch.get(label, ZERO) + line["amount"]
        breakdown = {
            batch_id: [{"label": lbl, "amount": amt} for lbl, amt in sorted(per.items())]
            for batch_id, per in breakdown.items()
        }
        rows = [
            {
                "id": str(b.id),
                "date_bs": b.date_bs,
                "class_label": str(b.class_info),
                "academic_year": b.academic_year.name,
                "months": b.months,
                "remarks": b.remarks,
                "charge_count": b.charge_count,
                "total": b.total or ZERO,
                "posted_by": actor_label(b.created_by),
                "lines": breakdown.get(b.id, []),
            }
            for b in batches
        ]
        return Response({
            "rows": rows,
            "summary": {
                "count": total_batches,
                "total": qs.aggregate(total=Sum("charges__total", filter=live))["total"] or ZERO,
            },
            "truncated": total_batches > len(rows),
        })


class OpeningBalanceReportView(ReportView):
    """Per-student opening balances carried into an academic year (Y1)."""

    permission_code = "billing"

    def get(self, request):
        school = self.school(request)
        year = _academic_year(request, school, required=True)

        lines = (
            ChargeLine.objects.filter(
                charge__school=school,
                charge__academic_year=year,
                charge__is_active=True,
                line_type=LineType.OPENING_BALANCE,
            )
            .values(
                "charge__student",
                "charge__student__first_name",
                "charge__student__middle_name",
                "charge__student__last_name",
                "charge__student__class_info__display_name",
            )
            .annotate(amount=Sum("amount"))
            .order_by("charge__student__first_name", "charge__student__last_name")
        )
        rows = [
            {
                "student_id": str(e["charge__student"]),
                "student_name": " ".join(
                    part
                    for part in (
                        e["charge__student__first_name"],
                        e["charge__student__middle_name"],
                        e["charge__student__last_name"],
                    )
                    if part
                ),
                "class_label": e["charge__student__class_info__display_name"] or "",
                "amount": e["amount"],
            }
            for e in lines
        ]
        return Response({
            "rows": rows,
            "summary": {
                "count": len(rows),
                "total": sum((r["amount"] for r in rows), ZERO),
                "academic_year": year.name,
            },
        })


class DuesReportView(ReportView):
    """Overall remaining dues, classwise: debit (charged) vs credit
    (paid + discount, M1) vs balance. Grouped by each student's CURRENT
    class — the legacy contract for this sheet."""

    permission_code = "billing"

    def get(self, request):
        school = self.school(request)
        year = _academic_year(request, school, required=True)
        from_bs, to_bs = self.bs_range(request)
        status = request.query_params.get("status") or Student.Status.RUNNING

        charge_q = Q(school=school, academic_year=year, student__status=status)
        payment_q = Q(
            school=school, academic_year=year, student__status=status,
            kind=FeeTitle.Kind.REGULAR,
        )
        if from_bs and to_bs:
            charge_q &= Q(date_bs__gte=from_bs, date_bs__lte=to_bs)
            payment_q &= Q(date_bs__gte=from_bs, date_bs__lte=to_bs)

        debits = dict(
            Charge.objects.filter(charge_q)
            .values_list("student__class_info")
            .annotate(total=Sum("total"))
        )
        credits: dict = {}
        for class_id, paid, discount in (
            Payment.objects.filter(payment_q)
            .values_list("student__class_info")
            .annotate(paid=Sum("total_paid"), discount=Sum("total_discount"))
        ):
            credits[class_id] = (paid or ZERO) + (discount or ZERO)

        class_ids = set(debits) | set(credits)
        labels = {
            c.id: str(c)
            for c in ClassInfo.objects.filter(school=school, id__in=class_ids)
        }
        rows = []
        for class_id in class_ids:
            debit = debits.get(class_id) or ZERO
            credit = credits.get(class_id) or ZERO
            rows.append({
                "class_info": str(class_id),
                "class_label": labels.get(class_id, ""),
                "debit": debit,
                "credit": credit,
                "balance": debit - credit,
            })
        rows.sort(key=lambda r: r["class_label"])
        return Response({
            "rows": rows,
            "summary": {
                "debit": sum((r["debit"] for r in rows), ZERO),
                "credit": sum((r["credit"] for r in rows), ZERO),
                "balance": sum((r["balance"] for r in rows), ZERO),
                "academic_year": year.name,
            },
        })


class StudentLedgersReportView(ReportView):
    """Per-student debit/credit/balance with guardian contact. Doubles as
    the balance-range finder via balance_gt / balance_lt."""

    permission_code = "billing"

    def get(self, request):
        school = self.school(request)
        year = _academic_year(request, school, required=True)
        from_bs, to_bs = self.bs_range(request)
        class_info = _class_info(request, school)
        status = request.query_params.get("status") or Student.Status.RUNNING

        def bound(name):
            raw = request.query_params.get(name)
            if raw in (None, ""):
                return None
            try:
                return Decimal(raw)
            except ArithmeticError:
                raise ValidationError({name: "Enter a number."})

        balance_gt, balance_lt = bound("balance_gt"), bound("balance_lt")

        scoped = Q(school=school, academic_year=year, student=OuterRef("pk"))
        if from_bs and to_bs:
            scoped &= Q(date_bs__gte=from_bs, date_bs__lte=to_bs)

        charge_sq = (
            Charge.objects.filter(scoped)
            .values("student")
            .annotate(total=Sum("total"))
            .values("total")[:1]
        )
        payment_base = Payment.objects.filter(scoped, kind=FeeTitle.Kind.REGULAR).values(
            "student"
        )
        paid_sq = payment_base.annotate(v=Sum("total_paid")).values("v")[:1]
        discount_sq = payment_base.annotate(v=Sum("total_discount")).values("v")[:1]

        students = Student.objects.filter(school=school, status=status)
        if class_info is not None:
            students = students.filter(class_info=class_info)
        students = students.select_related("class_info").annotate(
            debit=Coalesce(Subquery(charge_sq), ZERO, output_field=DecimalField()),
            paid=Coalesce(Subquery(paid_sq), ZERO, output_field=DecimalField()),
            discount=Coalesce(Subquery(discount_sq), ZERO, output_field=DecimalField()),
            balance=F("debit") - F("paid") - F("discount"),  # M1
        )
        if balance_gt is not None:
            students = students.filter(balance__gte=balance_gt)
        if balance_lt is not None:
            students = students.filter(balance__lte=balance_lt)
        if balance_gt is None and balance_lt is None and class_info is None:
            # Overall mode: skip students with no financial activity at all,
            # matching the legacy sheet (it derived rows from ledger rows).
            students = students.exclude(debit=ZERO, paid=ZERO, discount=ZERO)

        students = students.prefetch_related("guardian_links__guardian").order_by(
            "first_name", "last_name"
        )
        total = students.count()
        rows = []
        for s in students[:ROW_CAP]:
            links = list(s.guardian_links.all())
            primary = next((l for l in links if l.is_primary_contact), links[0] if links else None)
            guardian = primary.guardian if primary else None
            rows.append({
                "student_id": str(s.id),
                "name": s.full_name,
                "class_label": str(s.class_info),
                "contact": s.contact or (guardian.contact if guardian else ""),
                "guardian_name": guardian.name if guardian else "",
                "address": s.address or (guardian.address if guardian else ""),
                "debit": s.debit,
                "credit": s.paid + s.discount,
                "discount": s.discount,
                "balance": s.balance,
            })
        totals = students.aggregate(
            sum_debit=Sum("debit"), sum_paid=Sum("paid"),
            sum_discount=Sum("discount"), sum_balance=Sum("balance"),
        )
        return Response({
            "rows": rows,
            "summary": {
                "count": total,
                "debit": totals["sum_debit"] or ZERO,
                "credit": (totals["sum_paid"] or ZERO) + (totals["sum_discount"] or ZERO),
                "balance": totals["sum_balance"] or ZERO,
                "academic_year": year.name,
            },
            "truncated": total > len(rows),
        })


class IncomePlanReportView(ReportView):
    """Projected income per class x fee title for the selected months.

    Exact port of the legacy OverallIncomePlanView algorithm: title months ∩
    selected months, section-priority fee resolution (M5), standing
    discounts with percentage-wins (D1), transport projected from the
    station rate with start-date proration. One documented correction:
    discounts are matched to the student's class academic year (D2 —
    legacy ignored the year and let stale discounts distort projections).
    """

    permission_code = "billing"

    def get(self, request):
        school = self.school(request)
        months_raw = [
            part
            for item in request.query_params.getlist("months")
            for part in str(item).split(",")
            if part
        ]
        try:
            sel_months = {int(m) for m in months_raw}
        except ValueError:
            raise ValidationError({"months": "Months must be integers 1-12."})
        if not sel_months or not sel_months.issubset(set(range(1, 13))):
            raise ValidationError({"months": "Pick at least one month (1-12)."})
        education_level = request.query_params.get("education_level")

        classes = ClassInfo.objects.filter(school=school)
        if education_level:
            classes = classes.filter(education_level=education_level)
        classes = list(classes)
        class_meta = {
            c.id: (c.education_level, c.grade, c.faculty, c.course_id, c.year,
                   c.semester, c.section_id)
            for c in classes
        }

        titles: dict = {}
        title_months: dict = {}
        for t in FeeTitle.objects.filter(school=school, kind=FeeTitle.Kind.REGULAR).exclude(
            months=[]
        ):
            overlap = len(sel_months & set(t.months))
            if overlap > 0:
                titles[str(t.id)] = t.name
                title_months[t.id] = overlap

        # M5 fee indexes: exact class first, then the section-less sibling.
        section_fees: dict = {}
        base_fees: dict = {}
        for fee in (
            FeeSchedule.objects.filter(school=school, fee_title_id__in=title_months.keys())
            .select_related("class_info")
        ):
            c = fee.class_info
            key = (c.education_level, c.grade, c.faculty, c.course_id, c.year, c.semester)
            if c.section_id is None:
                base_fees[(*key, fee.fee_title_id)] = fee.amount
            else:
                section_fees[(*key, c.section_id, fee.fee_title_id)] = fee.amount

        def resolve_fee(class_id, title_id):
            edu, grade, faculty, course, yr, sem, section = class_meta[class_id]
            if section is not None:
                amount = section_fees.get((edu, grade, faculty, course, yr, sem, section, title_id))
                if amount is not None:
                    return amount
            return base_fees.get((edu, grade, faculty, course, yr, sem, title_id))

        students = list(
            Student.objects.filter(
                school=school, status=Student.Status.RUNNING,
                class_info_id__in=class_meta.keys(),
            ).values("id", "class_info_id")
        )
        student_class = {s["id"]: s["class_info_id"] for s in students}

        transport = {
            r["student_id"]: (r["bus_station__fee"] or ZERO, r["start_date_bs"])
            for r in RiderSubscription.objects.filter(
                school=school, student_id__in=student_class.keys()
            ).values("student_id", "bus_station__fee", "start_date_bs")
        }

        # D2 correction: only discounts scoped to the class's running year.
        discounts: dict = defaultdict(dict)
        for d in StandingDiscount.objects.filter(
            school=school,
            student_id__in=student_class.keys(),
            academic_year_id=F("student__class_info__academic_year_id"),
        ).filter(Q(fee_title_id__in=title_months.keys()) | Q(fee_title__isnull=True)):
            discounts[d.student_id][d.fee_title_id] = (d.percentage, d.flat_amount)

        current_bs_year = int(today_bs()[:4])

        student_counts: dict = defaultdict(int)
        transport_totals: dict = defaultdict(Decimal)
        discount_totals: dict = defaultdict(lambda: defaultdict(Decimal))

        for sid, class_id in student_class.items():
            student_counts[class_id] += 1
            tsp_rate, tsp_start = transport.get(sid, (ZERO, None))
            std_discounts = discounts.get(sid, {})
            # Transport discount (fee_title=None) reduces the station rate (D1).
            if None in std_discounts:
                pct, flat = std_discounts[None]
                cut = (pct / Decimal("100") * tsp_rate) if pct is not None else (flat or ZERO)
                tsp_rate -= cut
            for title_id, (pct, flat) in std_discounts.items():
                if title_id is None:
                    continue
                fee = resolve_fee(class_id, title_id)
                if fee is None:
                    continue
                per_month = (pct / Decimal("100") * fee) if pct is not None else (flat or ZERO)
                discount_totals[class_id][title_id] += per_month * title_months[title_id]
            if tsp_start:
                start_year, start_month = int(tsp_start[:4]), int(tsp_start[5:7])
                first = 1 if current_bs_year > start_year else start_month
                riding_months = set(range(first, 13))
                transport_totals[class_id] += len(sel_months & riding_months) * tsp_rate

        data: dict = {}
        for c in classes:
            count = student_counts.get(c.id, 0)
            if not count:
                continue
            per_title = {}
            for title_id, overlap in title_months.items():
                fee = resolve_fee(c.id, title_id)
                if fee is None:
                    continue
                gross = fee * overlap * count
                per_title[str(title_id)] = gross - discount_totals[c.id].get(title_id, ZERO)
            per_title["transport"] = transport_totals.get(c.id, ZERO)
            data[str(c.id)] = per_title

        titles["transport"] = "Transportation"
        return Response({
            "classes": [
                {"id": str(c.id), "label": str(c), "students": student_counts.get(c.id, 0)}
                for c in classes
                if student_counts.get(c.id, 0)
            ],
            "titles": titles,
            "data": data,
        })


class StandingDiscountsReportView(ReportView):
    """Discount history: every standing discount, its basis and its year (D2)."""

    permission_code = "billing"

    def get(self, request):
        school = self.school(request)
        year = _academic_year(request, school)
        class_info = _class_info(request, school)
        include_inactive = (
            request.query_params.get("include_inactive") == "true"
            and request.user.role == Role.ADMIN
        )
        manager = StandingDiscount.all_objects if include_inactive else StandingDiscount.objects

        qs = manager.filter(school=school).select_related(
            "student", "student__class_info", "fee_title", "academic_year"
        )
        if year is not None:
            qs = qs.filter(academic_year=year)
        if class_info is not None:
            qs = qs.filter(student__class_info=class_info)

        total = qs.count()
        rows = [
            {
                "id": str(d.id),
                "student_id": str(d.student_id),
                "name": d.student.full_name,
                "class_label": str(d.student.class_info),
                "fee_title": d.fee_title.name if d.fee_title_id else "Transportation",
                "percentage": d.percentage,
                "flat_amount": d.flat_amount,
                "academic_year": d.academic_year.name if d.academic_year_id else "",
                "remarks": d.remarks,
                "is_active": d.is_active,
            }
            for d in qs.order_by("student__first_name", "student__last_name")[:ROW_CAP]
        ]
        return Response({
            "rows": rows,
            "summary": {"count": total},
            "truncated": total > len(rows),
        })


class PaymentDiscountsReportView(ReportView):
    """Receipts that carried a discount, with the per-title discount split."""

    permission_code = "billing"

    def get(self, request):
        school = self.school(request)
        year = _academic_year(request, school, required=True)
        from_bs, to_bs = self.bs_range(request)

        qs = Payment.objects.filter(
            school=school, academic_year=year,
            kind=FeeTitle.Kind.REGULAR, total_discount__gt=0,
        )
        if from_bs and to_bs:
            qs = qs.filter(date_bs__gte=from_bs, date_bs__lte=to_bs)

        summary = qs.aggregate(count=Count("id"), total_discount=Sum("total_discount"))
        rows = []
        for p in (
            qs.select_related(
                "student", "class_info", "student__class_info",
                "created_by", "created_by__staff_profile",
            )
            .prefetch_related(
                Prefetch("lines", queryset=PaymentLine.objects.select_related("fee_title"))
            )
            .order_by("date_bs", "created_at")[:ROW_CAP]
        ):
            effective_class = p.class_info or (p.student.class_info if p.student_id else None)
            rows.append({
                "id": str(p.id),
                "serial": p.serial or p.legacy_serial,
                "date_bs": p.date_bs,
                "name": p.student.full_name if p.student_id else (p.payer_name or ""),
                "class_label": str(effective_class) if effective_class else "",
                "total_discount": p.total_discount,
                "cashier": actor_label(p.created_by),
                "lines": [
                    {"label": ln.display_label, "discount": ln.discount}
                    for ln in p.lines.all()
                    if ln.discount
                ],
            })
        return Response({
            "rows": rows,
            "summary": {
                "count": summary["count"],
                "total_discount": summary["total_discount"] or ZERO,
                "academic_year": year.name,
            },
            "truncated": summary["count"] > len(rows),
        })


class IntegrityReportView(ReportView):
    """Financial-record drift finder — the constraints-era descendant of the
    legacy invoice/ledger academic-year mismatch tools. Both lists should
    stay empty; anything here needs an admin's eye. Admin-only."""

    permission_code = "billing"
    allowed_roles = (Role.ADMIN,)

    def get(self, request):
        school = self.school(request)

        payment_rows = [
            {
                "id": str(p.id),
                "serial": p.serial or p.legacy_serial,
                "date_bs": p.date_bs,
                "name": p.student.full_name if p.student_id else (p.payer_name or ""),
                "class_label": str(p.class_info),
                "payment_year": p.academic_year.name,
                "class_year": p.class_info.academic_year.name
                if p.class_info.academic_year_id
                else "",
                "total_paid": p.total_paid,
            }
            for p in Payment.objects.filter(school=school, class_info__isnull=False)
            .exclude(class_info__academic_year=F("academic_year"))
            .select_related("student", "class_info", "class_info__academic_year", "academic_year")
            .order_by("date_bs")[:ROW_CAP]
        ]
        charge_rows = [
            {
                "id": str(c.id),
                "date_bs": c.date_bs,
                "name": c.student.full_name,
                "charge_year": c.academic_year.name,
                "batch_year": c.batch.academic_year.name,
                "total": c.total,
            }
            for c in Charge.objects.filter(school=school, batch__isnull=False)
            .exclude(batch__academic_year=F("academic_year"))
            .select_related("student", "academic_year", "batch__academic_year")
            .order_by("date_bs")[:ROW_CAP]
        ]
        return Response({
            "payments": payment_rows,
            "charges": charge_rows,
            "summary": {
                "payment_mismatches": len(payment_rows),
                "charge_mismatches": len(charge_rows),
            },
        })
