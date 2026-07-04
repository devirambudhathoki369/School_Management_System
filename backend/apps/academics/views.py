from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import AcademicYear, ClassInfo, Course, CurrentYearPointer, Section, Subject
from .serializers import (
    AcademicYearSerializer,
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


class SubjectViewSet(TenantScopedViewSet):
    queryset = Subject.objects.select_related("class_info")
    serializer_class = SubjectSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"

    def perform_destroy(self, instance):
        # S2 hard lock, then S1 usage guard.
        if instance.is_protected:
            raise ValidationError("Subject is protected and cannot be deleted.")
        if instance.is_referenced():
            raise ValidationError("Subject is in use and cannot be deleted.")
        instance.soft_delete()
