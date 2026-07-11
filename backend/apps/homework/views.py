from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role
from apps.people.models import Staff

from .models import Homework, HomeworkAttachment, Submission
from .serializers import (
    HomeworkAttachmentSerializer,
    HomeworkSerializer,
    SubmissionSerializer,
)

MANAGERS = (Role.ADMIN, Role.STAFF)


class HomeworkStaffLookupSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)

    class Meta:
        model = Staff
        fields = ["id", "full_name", "role_name", "status"]


class HomeworkStaffLookupViewSet(TenantScopedViewSet):
    """Names-only staff directory under the homework grant (same pattern as
    payroll's staff-lookup): an admin assigning homework must pick the
    teacher, but the full staff module is admin-only."""

    queryset = Staff.objects.select_related("role")
    serializer_class = HomeworkStaffLookupSerializer
    allowed_roles = MANAGERS
    permission_code = "homework"
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().order_by("first_name", "last_name")


class HomeworkViewSet(TenantScopedViewSet):
    queryset = Homework.objects.select_related("subject", "staff", "class_info")
    serializer_class = HomeworkSerializer
    allowed_roles = MANAGERS
    permission_code = "homework"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("class_info", "subject", "staff"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        if self.action == "retrieve":
            qs = qs.prefetch_related("attachments")
        return qs.order_by("-due_date_bs")

    def perform_create(self, serializer):
        # A teacher posting homework is its author by default; admins (no
        # staff profile) must name the teacher explicitly.
        staff = serializer.validated_data.get("staff") or getattr(
            self.request.user, "staff_profile", None
        )
        if staff is None:
            raise ValidationError({"staff": "Pick the assigning teacher."})
        serializer.save(school=self.request.school, staff=staff)

    @extend_schema(summary="Attach a file to this homework")
    @action(
        detail=True,
        methods=["post"],
        url_path="attachments",
        parser_classes=[MultiPartParser, FormParser],
    )
    def add_attachment(self, request, pk=None):
        from apps.core import uploads

        homework = self.get_object()
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Attach a file."})
        # Content-sniffed intake: the stored extension is what the bytes
        # earned, not whatever the browser claimed.
        ext = uploads.validate(upload, "document")
        # the upload_to callable builds the real per-school path; the name
        # here only carries the sniffed extension
        upload.name = f"file.{ext}"
        attachment = HomeworkAttachment.objects.create(homework=homework, file=upload)
        return Response(HomeworkAttachmentSerializer(attachment).data, status=201)

    @extend_schema(summary="Remove an attachment")
    @action(
        detail=True,
        methods=["delete"],
        url_path=r"attachments/(?P<attachment_id>[0-9a-f-]+)",
    )
    def remove_attachment(self, request, pk=None, attachment_id=None):
        attachment = self.get_object().attachments.filter(id=attachment_id).first()
        if attachment is None:
            raise ValidationError("Unknown attachment.")
        attachment.soft_delete()
        return Response(status=204)


class SubmissionViewSet(TenantScopedViewSet):
    queryset = Submission.objects.select_related("student", "homework")
    serializer_class = SubmissionSerializer
    allowed_roles = MANAGERS
    permission_code = "homework"

    def get_queryset(self):
        qs = super().get_queryset()
        homework = self.request.query_params.get("homework")
        if homework:
            qs = qs.filter(homework=homework)
        return qs
