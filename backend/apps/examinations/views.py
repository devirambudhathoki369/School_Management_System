from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.academics.models import ClassInfo
from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import (
    ActivityDefinition,
    ActivityGrade,
    CharacterCertificate,
    Exam,
    ExamScheduleEntry,
    GradingScheme,
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
    StudentMarkSerializer,
    SubjectResultSheetSerializer,
)
from .services import positions

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


class ExamScheduleEntryViewSet(TenantScopedViewSet):
    queryset = ExamScheduleEntry.objects.select_related("subject", "class_info")
    serializer_class = ExamScheduleEntrySerializer
    allowed_roles = MANAGERS
    permission_code = "examinations"

    def get_queryset(self):
        qs = super().get_queryset()
        exam = self.request.query_params.get("exam")
        if exam:
            qs = qs.filter(exam=exam)
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
