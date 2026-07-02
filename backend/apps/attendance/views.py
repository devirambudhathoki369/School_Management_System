from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import ClassAttendanceSession, StaffAttendanceRecord
from .serializers import (
    ClassAttendanceSessionSerializer,
    MarkAttendanceSerializer,
    StaffAttendanceRecordSerializer,
)

MANAGERS = (Role.ADMIN, Role.STAFF)


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
