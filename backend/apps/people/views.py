from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated

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
