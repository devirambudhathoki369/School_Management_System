from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import ModulePermissionAllowed, RoleAllowed
from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role
from apps.tenants.services import resolve_school_for

from .models import ClassAttendanceSession, StaffAttendanceRecord
from .serializers import (
    ClassAttendanceSessionSerializer,
    MarkAttendanceSerializer,
    StaffAttendanceRecordSerializer,
)

MANAGERS = (Role.ADMIN, Role.STAFF)


class RosterView(APIView):
    """Names-only rosters under the ATTENDANCE permission. Whoever marks a
    register needs the class list (or the staff list) but usually holds no
    grant on the students/staff modules themselves."""

    permission_classes = [IsAuthenticated, RoleAllowed, ModulePermissionAllowed]
    allowed_roles = MANAGERS
    permission_code = "attendance"

    def get(self, request):
        from apps.people.models import Staff, Student

        school = resolve_school_for(request.user)
        if school is None:
            raise PermissionDenied("No school is associated with this account.")

        class_info = request.query_params.get("class_info")
        if class_info:
            students = Student.objects.filter(
                school=school, class_info=class_info, status=Student.Status.RUNNING
            ).order_by("roll_no", "first_name")
            return Response([
                {"id": str(s.id), "full_name": s.full_name, "roll_no": s.roll_no}
                for s in students
            ])
        staff = Staff.objects.filter(
            school=school, status=Staff.Status.EMPLOYED
        ).order_by("first_name", "last_name")
        return Response([
            {"id": str(s.id), "full_name": s.full_name} for s in staff
        ])


class ClassAttendanceSessionViewSet(TenantScopedViewSet):
    queryset = ClassAttendanceSession.objects.select_related("class_info", "teacher")
    serializer_class = ClassAttendanceSessionSerializer
    allowed_roles = MANAGERS
    permission_code = "attendance"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("class_info", "date_bs"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        if self.action == "retrieve":
            qs = qs.prefetch_related("records__student")
        return qs.order_by("-date_bs")

    @extend_schema(summary="Bulk mark present/absent for this session")
    @action(detail=True, methods=["put"], url_path="mark")
    def mark(self, request, pk=None):
        session = self.get_object()
        serializer = MarkAttendanceSerializer(
            data=request.data, context={"request": request, "session": session}
        )
        serializer.is_valid(raise_exception=True)
        return Response(serializer.save())


class StaffAttendanceRecordViewSet(TenantScopedViewSet):
    queryset = StaffAttendanceRecord.objects.select_related("staff")
    serializer_class = StaffAttendanceRecordSerializer
    allowed_roles = MANAGERS
    permission_code = "attendance"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("staff", "date_bs"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        return qs.order_by("-date_bs")
