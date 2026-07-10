"""School-facing device administration (permission-gated like every module)."""

from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import Device, DeviceUser, PunchLog
from .services import commands

MANAGERS = (Role.ADMIN, Role.STAFF)


class DeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = [
            "id", "serial_number", "alias", "ip_address", "firmware",
            "push_version", "device_type", "timezone_min", "real_time",
            "state", "last_seen", "user_count", "fp_count", "face_count",
            "trans_count",
        ]
        read_only_fields = [
            "id", "ip_address", "firmware", "push_version", "device_type",
            "state", "last_seen", "user_count", "fp_count", "face_count",
            "trans_count",
        ]


class DeviceUserSerializer(serializers.ModelSerializer):
    person_name = serializers.SerializerMethodField()
    device_alias = serializers.CharField(source="device.alias", read_only=True)

    class Meta:
        model = DeviceUser
        fields = [
            "id", "device", "device_alias", "pin", "card",
            "student", "staff", "person_name", "verify",
        ]
        read_only_fields = ["id", "device_alias", "person_name"]

    def get_person_name(self, user) -> str:
        person = user.student or user.staff
        return person.full_name if person else ""

    def validate(self, attrs):
        request = self.context["request"]
        for field in ("device", "student", "staff"):
            value = attrs.get(field)
            if value is not None and value.school_id != request.school.id:
                raise serializers.ValidationError({field: "Does not belong to your school."})
        if attrs.get("student") and attrs.get("staff"):
            raise serializers.ValidationError("Link a student or a staff, not both.")
        return attrs


class PunchLogSerializer(serializers.ModelSerializer):
    pin = serializers.CharField(source="user.pin", read_only=True)

    class Meta:
        model = PunchLog
        fields = ["id", "user", "pin", "punch_time", "status", "verify", "received_at"]


class DeviceViewSet(TenantScopedViewSet):
    queryset = Device.objects.all()
    serializer_class = DeviceSerializer
    allowed_roles = MANAGERS
    permission_code = "devices"

    @extend_schema(summary="Ask the device to re-upload buffered punches")
    @action(detail=True, methods=["post"], url_path="pull-logs")
    def pull_logs(self, request, pk=None):
        device = self.get_object()
        command = commands.enqueue_pull_attlog(
            device, start=request.data.get("start"), end=request.data.get("end")
        )
        return Response({"queued_command": command.cmd_id})


class DeviceUserViewSet(TenantScopedViewSet):
    queryset = DeviceUser.objects.select_related("device", "student", "staff")
    serializer_class = DeviceUserSerializer
    allowed_roles = MANAGERS
    permission_code = "devices"

    def get_queryset(self):
        qs = super().get_queryset()
        device = self.request.query_params.get("device")
        if device:
            qs = qs.filter(device=device)
        return qs


class PunchLogViewSet(TenantScopedViewSet):
    queryset = PunchLog.objects.select_related("user")
    serializer_class = PunchLogSerializer
    allowed_roles = MANAGERS
    permission_code = "devices"
    http_method_names = ["get", "head", "options"]  # raw punches are read-only

    def get_queryset(self):
        # PunchLog has no school column; scope through the device user.
        qs = PunchLog.objects.select_related("user").filter(
            user__school=self.request.school
        )
        device = self.request.query_params.get("device")
        if device:
            qs = qs.filter(user__device=device)
        return qs.order_by("-punch_time")
