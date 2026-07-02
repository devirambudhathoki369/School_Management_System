from rest_framework.exceptions import ValidationError

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


class AcademicYearViewSet(TenantScopedViewSet):
    queryset = AcademicYear.objects.all()
    serializer_class = AcademicYearSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"


class CurrentYearPointerViewSet(TenantScopedViewSet):
    queryset = CurrentYearPointer.objects.select_related("academic_year")
    serializer_class = CurrentYearPointerSerializer
    allowed_roles = MANAGERS
    permission_code = "academics"


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
