from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import RoleAllowed
from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import Guardian, Staff, StaffRole, Student
from .serializers import (
    GuardianSerializer,
    StaffRoleSerializer,
    StaffSerializer,
    StudentDetailSerializer,
    StudentListSerializer,
)

MANAGERS = (Role.ADMIN, Role.STAFF)


class PromoteSerializer(serializers.Serializer):
    students = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    source_class = serializers.UUIDField()
    target_class = serializers.UUIDField()
    status = serializers.ChoiceField(
        choices=Student.Status.choices, required=False, default=Student.Status.RUNNING
    )


class StudentViewSet(TenantScopedViewSet):
    queryset = Student.objects.select_related("class_info__section", "class_info__course")
    allowed_roles = MANAGERS
    permission_code = "students"

    def get_serializer_class(self):
        return StudentListSerializer if self.action == "list" else StudentDetailSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "retrieve":
            qs = qs.prefetch_related("guardian_links__guardian")
        search = self.request.query_params.get("search", "").strip()
        if search:
            for term in search.split()[:4]:
                qs = qs.filter(
                    first_name__icontains=term
                ) | qs.filter(last_name__icontains=term) | qs.filter(roll_no__iexact=term)
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        class_info = self.request.query_params.get("class_info")
        if class_info:
            qs = qs.filter(class_info=class_info)
        return qs.order_by("first_name", "last_name")

    @extend_schema(summary="Promote students to another class", request=PromoteSerializer)
    @action(detail=False, methods=["post"], url_path="promote")
    def promote(self, request):
        """Bulk class change. A promotion that crosses academic years MOVES
        each student's outstanding source-year balance with it (Y1: an
        opening-balance charge in the new year plus a negative
        carry-forward-out in the old, so the old year nets to zero)."""
        from apps.academics.models import ClassInfo
        from apps.billing.services import year_end

        s = PromoteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        source_class = ClassInfo.objects.filter(
            id=data["source_class"], school=request.school
        ).first()
        target_class = ClassInfo.objects.filter(
            id=data["target_class"], school=request.school
        ).first()
        if source_class is None or target_class is None:
            raise ValidationError("Unknown class.")
        if source_class.id == target_class.id:
            raise ValidationError("Source and target class are the same.")
        students = list(
            Student.objects.filter(
                id__in=data["students"], school=request.school, class_info=source_class
            )
        )
        if len(students) != len(set(data["students"])):
            raise ValidationError(
                "Every student must belong to your school and the source class."
            )
        now = timezone.now()
        with transaction.atomic():
            for student in students:
                student.class_info = target_class
                student.status = data["status"]
                student.updated_at = now
            Student.objects.bulk_update(students, ["class_info", "status", "updated_at"])
            carried = year_end.carry_forward_on_promotion(
                students, source_class, target_class, actor=request.user
            )
        return Response({"promoted": len(students), "dues_carried": carried})


class GuardianViewSet(TenantScopedViewSet):
    queryset = Guardian.objects.all()
    serializer_class = GuardianSerializer
    allowed_roles = MANAGERS
    permission_code = "students"


class StaffViewSet(TenantScopedViewSet):
    queryset = Staff.objects.select_related("role")
    serializer_class = StaffSerializer
    allowed_roles = (Role.ADMIN,)  # staff records are admin-managed
    permission_code = "staff"

    def get_queryset(self):
        qs = super().get_queryset()
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        return qs.order_by("first_name", "last_name")


class StaffRoleListView(ListAPIView):
    """Global vocabulary — read-only for schools."""

    queryset = StaffRole.objects.all()
    serializer_class = StaffRoleSerializer
    permission_classes = [IsAuthenticated, RoleAllowed]
    allowed_roles = MANAGERS
