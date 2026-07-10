"""
Guardian portal: the read-only family window into the school (§18.1).

Scoping model — the security contract of this app:

- The guardian comes from the JWT principal; their school from the guardian
  profile (I1: never from client data).
- Every child-scoped endpoint resolves the student THROUGH an active
  StudentGuardian link. A student who isn't linked to the caller is a 404 —
  indistinguishable from not existing.
- Results honour E1: only published sheets are ever visible here.
- Dues honour M1: payments settle debt with total_paid + total_discount.

Everything is a plain read — the portal never mutates school data.
"""

from decimal import Decimal

from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attendance.models import StudentAttendanceRecord
from apps.billing.models import Charge, FeeTitle, Payment
from apps.billing.services.dues import student_dues
from apps.communication.models import CalendarEvent, Notice
from apps.core.dates import today_bs
from apps.examinations.models import StudentSubjectResult
from apps.homework.models import Homework
from apps.people.models import Student, StudentGuardian

from .permissions import IsGuardian

HOMEWORK_PAGE = 50
NOTICES_PAGE = 50


def _month_param(request) -> str:
    """?month_bs=YYYY-MM (defaults to the current BS month)."""
    month = request.query_params.get("month_bs", "").strip() or today_bs()[:7]
    parts = month.split("-")
    if len(parts) != 2 or not all(p.isdigit() for p in parts) or len(parts[0]) != 4:
        raise ValidationError({"month_bs": "Use the form YYYY-MM."})
    return f"{parts[0]}-{int(parts[1]):02d}"


class GuardianPortalView(APIView):
    """Base for every portal endpoint: guardian + school from the principal,
    children only through active guardian links."""

    permission_classes = [IsAuthenticated, IsGuardian]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        guardian = getattr(request.user, "guardian_profile", None)
        if guardian is None:
            raise NotFound("No guardian profile is linked to this account.")
        request.guardian = guardian
        request.school = guardian.school

    def get_child(self, request, student_id) -> Student:
        link = (
            StudentGuardian.objects.filter(
                guardian=request.guardian, student_id=student_id
            )
            .select_related(
                "student__class_info__section",
                "student__class_info__course",
                "student__academic_year",
            )
            .first()
        )
        if link is None:
            raise NotFound("No such student.")
        return link.student


class ChildrenView(GuardianPortalView):
    @extend_schema(summary="My children", operation_id="portal_children")
    def get(self, request):
        links = (
            StudentGuardian.objects.filter(guardian=request.guardian)
            .select_related(
                "student__class_info__section",
                "student__class_info__course",
                "student__academic_year",
            )
            .order_by("student__first_name")
        )
        today = today_bs()
        children = []
        for link in links:
            student = link.student
            record = (
                StudentAttendanceRecord.objects.filter(
                    student=student,
                    session__date_bs=today,
                    session__class_info=student.class_info_id,
                )
                .only("present", "checked_in_at", "checked_out_at")
                .first()
            )
            children.append(
                {
                    "id": str(student.id),
                    "full_name": student.full_name,
                    "first_name": student.first_name,
                    "gender": student.gender,
                    "status": student.status,
                    "roll_no": student.roll_no,
                    "class_label": str(student.class_info),
                    "academic_year": str(student.academic_year_id),
                    "academic_year_name": student.academic_year.name,
                    "relation": link.relation,
                    "is_primary_contact": link.is_primary_contact,
                    "dues": str(student_dues(student)),
                    "attendance_today": (
                        None
                        if record is None
                        else {
                            "present": record.present,
                            "checked_in_at": record.checked_in_at,
                            "checked_out_at": record.checked_out_at,
                        }
                    ),
                }
            )
        guardian = request.guardian
        return Response(
            {
                "guardian": {
                    "name": guardian.name,
                    "contact": guardian.contact,
                    "email": guardian.email,
                    "address": guardian.address,
                },
                "today_bs": today,
                "children": children,
            }
        )


class ChildAttendanceView(GuardianPortalView):
    @extend_schema(summary="A child's attendance for one BS month")
    def get(self, request, student_id):
        child = self.get_child(request, student_id)
        month = _month_param(request)
        records = (
            StudentAttendanceRecord.objects.filter(
                student=child, session__date_bs__startswith=f"{month}-"
            )
            .select_related("session")
            .order_by("session__date_bs")
        )
        days = [
            {
                "date_bs": r.session.date_bs,
                "present": r.present,
                "reason": r.reason,
                "checked_in_at": r.checked_in_at,
                "checked_out_at": r.checked_out_at,
            }
            for r in records
        ]
        present = sum(1 for d in days if d["present"])
        return Response(
            {
                "month_bs": month,
                "days": days,
                "summary": {
                    "marked": len(days),
                    "present": present,
                    "absent": len(days) - present,
                },
            }
        )


class ChildFeesView(GuardianPortalView):
    @extend_schema(summary="A child's dues and fee statement")
    def get(self, request, student_id):
        child = self.get_child(request, student_id)
        year_ids = set(
            Charge.objects.filter(student=child).values_list("academic_year", flat=True)
        ) | set(
            Payment.objects.filter(student=child).values_list("academic_year", flat=True)
        )
        from apps.academics.models import AcademicYear

        years = list(
            AcademicYear.objects.filter(id__in=year_ids | {child.academic_year_id})
            .order_by("-name")
            .values("id", "name")
        )
        selected = request.query_params.get("year") or str(child.academic_year_id)
        if selected not in {str(y["id"]) for y in years}:
            raise ValidationError({"year": "Unknown academic year for this student."})

        charges = (
            Charge.objects.filter(student=child, academic_year=selected)
            .select_related("batch")
            .prefetch_related("lines")
            .order_by("-date_bs", "-id")
        )
        payments = (
            Payment.objects.filter(student=child, academic_year=selected)
            .prefetch_related("lines")
            .order_by("-date_bs", "-id")
        )
        charged = Decimal("0")
        charge_rows = []
        for charge in charges:
            charged += charge.total
            charge_rows.append(
                {
                    "id": str(charge.id),
                    "date_bs": charge.date_bs,
                    "total": str(charge.total),
                    "remarks": charge.remarks,
                    "months": charge.batch.months if charge.batch_id else [],
                    "lines": [
                        {"label": line.label, "amount": str(line.amount)}
                        for line in charge.lines.all()
                    ],
                }
            )
        paid = Decimal("0")
        payment_rows = []
        for payment in payments:
            if payment.kind == FeeTitle.Kind.REGULAR:
                paid += payment.total_paid + (payment.total_discount or Decimal("0"))
            payment_rows.append(
                {
                    "id": str(payment.id),
                    "kind": payment.kind,
                    "serial": payment.serial or payment.legacy_serial,
                    "date_bs": payment.date_bs,
                    "mode": payment.mode,
                    "total_paid": str(payment.total_paid),
                    "total_discount": str(payment.total_discount or Decimal("0")),
                    "remarks": payment.remarks,
                    "lines": [
                        {
                            "label": line.label,
                            "amount": str(line.amount),
                            "discount": str(line.discount),
                        }
                        for line in payment.lines.all()
                    ],
                }
            )
        return Response(
            {
                "years": [{"id": str(y["id"]), "name": y["name"]} for y in years],
                "year": selected,
                "dues_total": str(student_dues(child)),
                "year_charged": str(charged),
                "year_paid": str(paid),
                "charges": charge_rows,
                "payments": payment_rows,
            }
        )


class ChildResultsView(GuardianPortalView):
    @extend_schema(summary="A child's published exam results (E1)")
    def get(self, request, student_id):
        child = self.get_child(request, student_id)
        results = (
            StudentSubjectResult.objects.filter(
                student=child, sheet__published_date_bs__gt=""
            )
            .select_related("sheet__exam__academic_year", "sheet__subject")
            .order_by("sheet__subject__order", "sheet__subject__name")
        )
        exams: dict[str, dict] = {}
        for result in results:
            sheet = result.sheet
            exam = sheet.exam
            bucket = exams.setdefault(
                str(exam.id),
                {
                    "exam_id": str(exam.id),
                    "exam_name": exam.name,
                    "academic_year_name": exam.academic_year.name,
                    "published_date_bs": sheet.published_date_bs,
                    "position_in_section": None,
                    "position_in_class": None,
                    "subjects": [],
                    "total": Decimal("0"),
                    "full_marks": Decimal("0"),
                    "all_passed": True,
                },
            )
            bucket["published_date_bs"] = max(
                bucket["published_date_bs"], sheet.published_date_bs
            )
            if result.position_in_section is not None:
                bucket["position_in_section"] = result.position_in_section
            if result.position_in_class is not None:
                bucket["position_in_class"] = result.position_in_class
            bucket["subjects"].append(
                {
                    "subject": sheet.subject.name,
                    "full_marks": str(sheet.full_marks),
                    "pass_marks": str(sheet.pass_marks),
                    "theory": None if result.theory is None else str(result.theory),
                    "practical": None if result.practical is None else str(result.practical),
                    "total": str(result.total),
                    "passed": result.passed,
                    "absent": result.absent,
                }
            )
            bucket["total"] += result.total
            bucket["full_marks"] += sheet.full_marks
            if not result.passed:
                bucket["all_passed"] = False
        payload = []
        for bucket in exams.values():
            full = bucket["full_marks"]
            payload.append(
                {
                    **bucket,
                    "total": str(bucket["total"]),
                    "full_marks": str(full),
                    "percentage": (
                        str(round(bucket["total"] * 100 / full, 2)) if full else None
                    ),
                }
            )
        payload.sort(
            key=lambda e: (e["academic_year_name"], e["published_date_bs"]), reverse=True
        )
        return Response({"exams": payload})


class ChildHomeworkView(GuardianPortalView):
    @extend_schema(summary="A child's class homework")
    def get(self, request, student_id):
        child = self.get_child(request, student_id)
        homeworks = (
            Homework.objects.filter(school=request.school, class_info=child.class_info_id)
            .select_related("subject", "staff")
            .prefetch_related("attachments")
            .order_by("-due_date_bs", "-id")[:HOMEWORK_PAGE]
        )
        today = today_bs()
        return Response(
            {
                "today_bs": today,
                "homework": [
                    {
                        "id": str(hw.id),
                        "title": hw.title,
                        "description": hw.description,
                        "due_date_bs": hw.due_date_bs,
                        "subject": hw.subject.name,
                        "teacher": hw.staff.full_name,
                        "attachments": [
                            {
                                "name": att.file.name.rsplit("/", 1)[-1],
                                "url": request.build_absolute_uri(att.file.url),
                            }
                            for att in hw.attachments.all()
                        ],
                    }
                    for hw in homeworks
                ],
            }
        )


class NoticesView(GuardianPortalView):
    @extend_schema(summary="School notices")
    def get(self, request):
        notices = Notice.objects.filter(school=request.school).order_by(
            "-date_bs", "-id"
        )[:NOTICES_PAGE]
        return Response(
            {
                "notices": [
                    {
                        "id": str(n.id),
                        "title": n.title,
                        "description": n.description,
                        "date_bs": n.date_bs,
                        "image": (
                            request.build_absolute_uri(n.image.url) if n.image else None
                        ),
                    }
                    for n in notices
                ]
            }
        )


class PortalCalendarView(GuardianPortalView):
    @extend_schema(summary="School calendar for one BS month")
    def get(self, request):
        month = _month_param(request)
        events = (
            CalendarEvent.objects.filter(
                school=request.school,
                start_date_bs__lte=f"{month}-99",
                end_date_bs__gte=f"{month}-00",
            )
            .order_by("start_date_bs")
        )
        return Response(
            {
                "month_bs": month,
                "events": [
                    {
                        "id": str(e.id),
                        "event_type": e.event_type,
                        "start_date_bs": e.start_date_bs,
                        "end_date_bs": e.end_date_bs,
                        "description": e.description,
                        "color": e.color,
                    }
                    for e in events
                ],
            }
        )
