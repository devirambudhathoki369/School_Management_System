from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.academics.models import AcademicYear, ClassInfo
from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import (
    ActivityDefinition,
    ActivityGrade,
    CharacterCertificate,
    Exam,
    ExamScheduleEntry,
    GradingScheme,
    SeatPlanRoom,
    SubjectResultSheet,
)
from .serializers import (
    ActivityDefinitionSerializer,
    ActivityGradeSerializer,
    CharacterCertificateSerializer,
    ExamScheduleEntrySerializer,
    ExamSerializer,
    GradingSchemeSerializer,
    MarksEntrySerializer,
    SeatPlanRoomSerializer,
    StudentMarkSerializer,
    SubjectResultSheetSerializer,
)
from .services import grading, positions, seating
from .services.final_result import final_class_result

MANAGERS = (Role.ADMIN, Role.STAFF)


class ExamViewSet(TenantScopedViewSet):
    queryset = Exam.objects.select_related("academic_year")
    serializer_class = ExamSerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"

    @extend_schema(summary="Publish all sheets of a class for this exam")
    @action(detail=True, methods=["post"], url_path="publish")
    def publish(self, request, pk=None):
        exam = self.get_object()
        class_info = get_object_or_404(
            ClassInfo, id=request.data.get("class_info"), school=request.school
        )
        published_date_bs = request.data.get("published_date_bs", "").strip()
        if not published_date_bs:
            raise ValidationError({"published_date_bs": "Required."})
        count = positions.publish(exam, class_info, published_date_bs)
        return Response({"published_sheets": count})

    @extend_schema(summary="Full class result for one class (print source)")
    @action(detail=True, methods=["get"], url_path="class-result")
    def class_result(self, request, pk=None):
        """Every student × every subject of (exam, class): marks, letters,
        totals, percentage, GPA and positions — the data behind the printed
        class-result sheet and per-student marksheets/gradesheets."""
        exam = self.get_object()
        class_info = get_object_or_404(
            ClassInfo, id=request.query_params.get("class_info"), school=request.school
        )
        sheets = list(
            SubjectResultSheet.objects.filter(exam=exam, class_info=class_info)
            .select_related("subject")
            .order_by("subject__order", "subject__name")
            .prefetch_related("results__student")
        )
        students: dict = {}
        for sheet in sheets:
            hours = sheet.subject.credit_hours + (
                sheet.subject.credit_hours_practical or 0
            )
            for result in sheet.results.all():
                row = students.setdefault(
                    result.student_id,
                    {
                        "id": str(result.student_id),
                        "name": result.student.full_name,
                        "roll_no": result.student.roll_no,
                        "marks": {},
                        "total": 0,
                        "full_marks": 0,
                        "weighted_gp": 0,
                        "credit_hours": 0,
                        "all_passed": True,
                        "position_in_section": None,
                        "position_in_class": None,
                    },
                )
                gp = grading.grade_point(result.total, sheet.full_marks)
                row["marks"][str(sheet.subject_id)] = {
                    "theory": result.theory,
                    "practical": result.practical,
                    "total": result.total,
                    "passed": result.passed,
                    "absent": result.absent,
                    "letter": grading.letter_grade(result.total, sheet.full_marks),
                    "grade_point": gp,
                }
                row["total"] += result.total
                row["full_marks"] += sheet.full_marks
                row["weighted_gp"] += gp * hours
                row["credit_hours"] += hours
                if not result.passed:
                    row["all_passed"] = False
                if result.position_in_section is not None:
                    row["position_in_section"] = result.position_in_section
                if result.position_in_class is not None:
                    row["position_in_class"] = result.position_in_class
        payload = []
        for row in students.values():
            student_gpa = (
                grading.gpa(row.pop("weighted_gp"), row["credit_hours"])
                if row["credit_hours"]
                else None
            )
            row.pop("credit_hours")
            percent = grading.percentage(row["total"], row["full_marks"])
            payload.append(
                {
                    **row,
                    "percentage": percent,
                    "gpa": student_gpa,
                    "gpa_letter": grading.gp_letter(student_gpa) if student_gpa else "",
                }
            )
        payload.sort(
            key=lambda r: (
                r["position_in_section"] is None,
                r["position_in_section"] or 0,
                -r["total"],
            )
        )
        return Response(
            {
                "exam": {"id": str(exam.id), "name": exam.name,
                         "academic_year_name": exam.academic_year.name},
                "class_label": str(class_info),
                "published": bool(sheets) and all(s.published_date_bs for s in sheets),
                "subjects": [
                    {
                        "id": str(s.subject_id),
                        "name": s.subject.name,
                        "full_marks": s.full_marks,
                        "pass_marks": s.pass_marks,
                        "published": bool(s.published_date_bs),
                    }
                    for s in sheets
                ],
                "students": payload,
            }
        )

    @extend_schema(summary="Final (annual) result aggregated over weighted exams")
    @action(detail=False, methods=["get"], url_path="final-result")
    def final_result(self, request):
        """Same contract as class-result, aggregated across every exam of the
        year that carries an inclusion weight — powers the final class grid,
        final marksheets and the combined (per-exam columns) view."""
        year = get_object_or_404(
            AcademicYear,
            id=request.query_params.get("academic_year"),
            school=request.school,
        )
        class_info = get_object_or_404(
            ClassInfo, id=request.query_params.get("class_info"), school=request.school
        )
        return Response(final_class_result(request.school, year, class_info))

    @extend_schema(summary="Class roster with identities (entry cards / seating)")
    @action(detail=False, methods=["get"], url_path="class-roster")
    def class_roster(self, request):
        """Running students of one class with the identity fields exam prints
        need (symbol/regd), under the EXAMINATIONS grant — exam clerks rarely
        hold the students module. `include_dues=1` adds each student's
        outstanding balance: schools traditionally withhold entry cards from
        defaulters, so the print screen filters on it."""
        from apps.people.models import Student

        class_info = get_object_or_404(
            ClassInfo, id=request.query_params.get("class_info"), school=request.school
        )
        students = list(
            Student.objects.filter(
                school=request.school,
                class_info=class_info,
                status=Student.Status.RUNNING,
            ).order_by("first_name", "last_name")
        )
        rows = [
            {
                "id": str(s.id),
                "full_name": s.full_name,
                "roll_no": s.roll_no,
                "symbol_no": s.symbol_no,
                "regd_no": s.regd_no,
            }
            for s in students
        ]
        if request.query_params.get("include_dues"):
            from decimal import Decimal

            from django.db.models import Sum

            from apps.billing.models import Charge, FeeTitle, Payment

            ids = [s.id for s in students]
            charged = dict(
                Charge.objects.filter(student_id__in=ids)
                .values_list("student_id")
                .annotate(total=Sum("total"))
            )
            settled: dict = {}
            paid_rows = (
                Payment.objects.filter(student_id__in=ids, kind=FeeTitle.Kind.REGULAR)
                .values_list("student_id")
                .annotate(paid=Sum("total_paid"), discount=Sum("total_discount"))
            )
            for student_id, paid, discount in paid_rows:
                # M1: total_paid is pre-discount; the discount settles debt too.
                settled[student_id] = (paid or Decimal("0")) + (discount or Decimal("0"))
            for student, row in zip(students, rows):
                dues = (charged.get(student.id) or Decimal("0")) - settled.get(
                    student.id, Decimal("0")
                )
                row["dues"] = str(dues)
        return Response(rows)


class ExamScheduleEntryViewSet(TenantScopedViewSet):
    queryset = ExamScheduleEntry.objects.select_related("subject", "class_info")
    serializer_class = ExamScheduleEntrySerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("exam", "class_info"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        return qs


class GradingSchemeViewSet(TenantScopedViewSet):
    queryset = GradingScheme.objects.prefetch_related("bands")
    serializer_class = GradingSchemeSerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"


class SubjectResultSheetViewSet(TenantScopedViewSet):
    queryset = SubjectResultSheet.objects.select_related("subject", "class_info", "exam")
    serializer_class = SubjectResultSheetSerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("exam", "class_info"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        return qs

    @extend_schema(summary="List marks on this sheet", responses=StudentMarkSerializer(many=True))
    @action(detail=True, methods=["get"], url_path="marks")
    def marks(self, request, pk=None):
        sheet = self.get_object()
        rows = sheet.results.select_related("student").order_by("student__first_name")
        return Response(StudentMarkSerializer(rows, many=True).data)

    @extend_schema(summary="Class roster for marks entry (names only)")
    @action(detail=True, methods=["get"], url_path="roster")
    def roster(self, request, pk=None):
        """The sheet's class list under the EXAMINATIONS permission — marks
        clerks need names/rolls to fill a sheet but usually hold no grant on
        the students module."""
        from apps.people.models import Student

        sheet = self.get_object()
        students = Student.objects.filter(
            school=request.school,
            class_info=sheet.class_info,
            status=Student.Status.RUNNING,
        ).order_by("first_name", "last_name")
        return Response([
            {"id": str(s.id), "full_name": s.full_name, "roll_no": s.roll_no}
            for s in students
        ])

    @extend_schema(summary="Bulk-upsert marks (totals/pass computed server-side)")
    @action(detail=True, methods=["put"], url_path="marks/entry")
    def marks_entry(self, request, pk=None):
        sheet = self.get_object()
        serializer = MarksEntrySerializer(
            data=request.data, context={"request": request, "sheet": sheet}
        )
        serializer.is_valid(raise_exception=True)
        return Response(serializer.save())


class ActivityDefinitionViewSet(TenantScopedViewSet):
    queryset = ActivityDefinition.objects.all()
    serializer_class = ActivityDefinitionSerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"


class ActivityGradeViewSet(TenantScopedViewSet):
    queryset = ActivityGrade.objects.select_related("activity", "student")
    serializer_class = ActivityGradeSerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("exam", "student"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        return qs


class CharacterCertificateViewSet(TenantScopedViewSet):
    queryset = CharacterCertificate.objects.select_related("student")
    serializer_class = CharacterCertificateSerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"

    def get_queryset(self):
        qs = super().get_queryset().order_by("-created_at")
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(serial_no__icontains=search) | Q(data__name__icontains=search)
            )
        return qs


class SeatPlanRoomViewSet(TenantScopedViewSet):
    """Seat plan rooms (benches × seats, one class per bench column).

    Extra endpoints:
    - GET  eligible-classes/?exam=  classes the plan may use (E3 scope)
    - POST generate/ {exam|room, shuffle}  run the arrangement (idempotent)
    """

    queryset = SeatPlanRoom.objects.select_related("exam").prefetch_related(
        "room_classes", "allocations__student"
    )
    serializer_class = SeatPlanRoomSerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"

    def get_queryset(self):
        qs = super().get_queryset()
        exam = self.request.query_params.get("exam")
        if exam:
            qs = qs.filter(exam=exam)
        return qs.order_by("created_at")

    def perform_destroy(self, instance):
        # A room is a working document: deleting removes its classes and
        # allocations outright (legacy cascade), not a soft delete.
        seating.hard_delete_room(instance)

    @extend_schema(summary="Classes this exam's seat plan may use")
    @action(detail=False, methods=["get"], url_path="eligible-classes")
    def eligible_classes(self, request):
        exam = get_object_or_404(Exam, id=request.query_params.get("exam"),
                                 school=request.school)
        return Response({"eligible_classes": seating.eligible_class_ids(exam)})

    @extend_schema(summary="Generate the seating (replaces prior allocations)")
    @action(detail=False, methods=["post"], url_path="generate")
    def generate(self, request):
        room_id = request.data.get("room")
        exam_id = request.data.get("exam")
        rooms = SeatPlanRoom.objects.filter(school=request.school)
        if room_id:
            rooms = rooms.filter(id=room_id)
        elif exam_id:
            rooms = rooms.filter(exam_id=exam_id)
        else:
            raise ValidationError({"exam": "Pass an exam or a room."})
        rooms = list(rooms.prefetch_related("room_classes").order_by("created_at"))
        if not rooms:
            raise ValidationError({"exam": "No rooms to arrange."})
        per_room, unseated = seating.generate(rooms, shuffle=bool(request.data.get("shuffle")))
        return Response(
            {
                "seated": sum(per_room.values()),
                "unseated": unseated,
                "per_room": {str(room_id): count for room_id, count in per_room.items()},
            }
        )
