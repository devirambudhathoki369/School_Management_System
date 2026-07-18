from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from . import services
from .models import (
    AcademicYear,
    Batch,
    ClassInfo,
    Course,
    CurrentYearPointer,
    OptionalSubjectAssignment,
    Section,
    Subject,
)
from .serializers import (
    AcademicYearSerializer,
    BatchSerializer,
    ClassInfoSerializer,
    CourseSerializer,
    CurrentYearPointerSerializer,
    SectionSerializer,
    SubjectSerializer,
)

MANAGERS = (Role.ADMIN, Role.STAFF)


class AcademicYearCloseSerializer(serializers.Serializer):
    classes = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    billing_year = serializers.UUIDField()
    new_academic_year = serializers.DictField()

    def validate_new_academic_year(self, value):
        inner = AcademicYearSerializer(data=value)
        inner.is_valid(raise_exception=True)
        return inner.validated_data


class AcademicYearViewSet(TenantScopedViewSet):
    queryset = AcademicYear.objects.all()
    serializer_class = AcademicYearSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"


class CurrentYearPointerViewSet(TenantScopedViewSet):
    queryset = CurrentYearPointer.objects.select_related(
        "academic_year", "previous_academic_year"
    )
    serializer_class = CurrentYearPointerSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"

    def _require_admin(self):
        if self.request.user.role != Role.ADMIN:
            raise PermissionDenied("Only the school admin can run year-end operations.")

    @extend_schema(
        summary="Close this pointer's academic year (Y1/Y2)",
        request=AcademicYearCloseSerializer,
    )
    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        from apps.billing.models import BillingYear
        from apps.billing.services import year_end

        self._require_admin()
        pointer = self.get_object()
        s = AcademicYearCloseSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        classes = list(
            ClassInfo.objects.filter(id__in=data["classes"], school=request.school)
        )
        if len(classes) != len(set(data["classes"])):
            raise ValidationError({"classes": "Unknown class in selection."})
        billing_year = BillingYear.objects.filter(id=data["billing_year"]).first()
        if billing_year is None:
            raise ValidationError({"billing_year": "Unknown billing year."})
        new_year = year_end.close_academic_year(
            request.school, pointer, classes,
            data["new_academic_year"], billing_year, request.user,
        )
        return Response(
            {"message": f"Academic year {pointer.previous_academic_year.name} closed.",
             "new_academic_year": AcademicYearSerializer(new_year).data},
            status=201,
        )

    @extend_schema(summary="Undo this pointer's last academic-year close (Y3)")
    @action(detail=True, methods=["post"], url_path="undo-close")
    def undo_close(self, request, pk=None):
        from apps.billing.services import year_end

        self._require_admin()
        old_year = year_end.undo_academic_year_close(request.school, self.get_object())
        return Response({"message": f"Academic year {old_year.name} reopened."})


class CourseViewSet(TenantScopedViewSet):
    queryset = Course.objects.all()
    serializer_class = CourseSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"

    def perform_destroy(self, instance):
        if instance.classinfo_set.exists():
            raise ValidationError("Course is used by classes and cannot be deleted.")
        instance.soft_delete()

    @extend_schema(summary="Promote every cohort of this program up one level")
    @action(detail=True, methods=["post"], url_path="promote-program")
    def promote_program(self, request, pk=None):
        """Batch-aware year-end step: dry-run unless {"apply": true}. Admin
        only — it rewrites student placements (see services.promote_program)."""
        if request.user.role != Role.ADMIN:
            raise PermissionDenied("Only the school admin can promote a program.")
        result = services.promote_program(
            request.school, self.get_object(), apply=bool(request.data.get("apply"))
        )
        return Response(result)


class BatchViewSet(TenantScopedViewSet):
    """Cohort/intake registry for higher-ed programs. Additive: managing
    batches here touches no class, student, fee or exam row."""

    queryset = Batch.objects.select_related("course", "start_academic_year").order_by(
        "-year", "course__name"
    )
    serializer_class = BatchSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"
    filterset_fields = ["course", "graduated"]

    def perform_destroy(self, instance):
        if instance.classes.exists():
            raise ValidationError("Batch is stamped on classes and cannot be deleted.")
        if instance.students.exists():
            raise ValidationError("Batch has students and cannot be deleted.")
        instance.soft_delete()


class SectionViewSet(TenantScopedViewSet):
    queryset = Section.objects.all()
    serializer_class = SectionSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"

    def perform_destroy(self, instance):
        if instance.classinfo_set.exists():
            raise ValidationError("Section is used by classes and cannot be deleted.")
        instance.soft_delete()


class ClassInfoViewSet(TenantScopedViewSet):
    queryset = ClassInfo.objects.select_related("course", "section", "academic_year")
    serializer_class = ClassInfoSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"
    filterset_fields = ["academic_year", "education_level", "grade"]

    def get_queryset(self):
        from django.db.models import Count, Q

        return super().get_queryset().annotate(
            students_count=Count(
                "students", filter=Q(students__status="running", students__is_active=True)
            )
        )

    def perform_destroy(self, instance):
        if instance.students.exists():
            raise ValidationError("Class has students and cannot be deleted.")
        if instance.subjects.exists():
            raise ValidationError("Class has subjects and cannot be deleted.")
        instance.soft_delete()


class SubjectViewSet(TenantScopedViewSet):
    queryset = Subject.objects.select_related("class_info")
    serializer_class = SubjectSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"
    filterset_fields = ["class_info"]

    def perform_destroy(self, instance):
        # S2 hard lock, then S1 usage guard.
        if instance.is_protected:
            raise ValidationError("Subject is protected and cannot be deleted.")
        if instance.is_referenced():
            raise ValidationError("Subject is in use and cannot be deleted.")
        instance.soft_delete()

    @extend_schema(summary="Which students take this optional subject")
    @action(detail=True, methods=["get", "put"], url_path="assignments")
    def assignments(self, request, pk=None):
        """Replace-set semantics like the EEF targeting: PUT {students: [...]}
        swaps the assigned set. No rows = the whole class takes it."""
        from django.db import transaction

        from apps.people.models import Student

        subject = self.get_object()
        if request.method == "GET":
            return Response({
                "students": sorted(
                    str(s) for s in subject.assignments.values_list("student_id", flat=True)
                )
            })
        ids = request.data.get("students")
        if ids is None or not isinstance(ids, list):
            raise ValidationError({"students": "Provide the list of student ids."})
        students = list(
            Student.objects.filter(school=request.school, id__in=set(ids))
        )
        if len(students) != len(set(ids)):
            raise ValidationError({"students": "Unknown student in the list."})
        with transaction.atomic():
            subject.assignments.all().delete()
            OptionalSubjectAssignment.objects.bulk_create(
                OptionalSubjectAssignment(
                    school=request.school, subject=subject, student=s
                )
                for s in students
            )
        return Response({"students": sorted(str(s.id) for s in students)})
