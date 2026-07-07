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

from .models import Guardian, Staff, StaffRole, Student, StudentGuardian
from .serializers import (
    GuardianSerializer,
    StaffRoleSerializer,
    StaffSerializer,
    StudentDetailSerializer,
    StudentGuardianSerializer,
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


class GuardianLinkSerializer(serializers.Serializer):
    """Attach a guardian to a student: an existing person by id, or a new one
    created inline (the common enrolment path)."""

    guardian = serializers.UUIDField(required=False, allow_null=True)
    name = serializers.CharField(max_length=60, required=False, allow_blank=True)
    contact = serializers.CharField(max_length=15, required=False, allow_blank=True, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    address = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    occupation = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    relation = serializers.ChoiceField(choices=StudentGuardian.Relation.choices)
    is_primary_contact = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if not attrs.get("guardian") and not attrs.get("name", "").strip():
            raise serializers.ValidationError(
                "Provide an existing guardian id or a name for a new guardian."
            )
        return attrs


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

    @extend_schema(summary="Link a guardian to this student", request=GuardianLinkSerializer)
    @action(detail=True, methods=["post"], url_path="guardians")
    def add_guardian(self, request, pk=None):
        student = self.get_object()
        s = GuardianLinkSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        if data.get("guardian"):
            guardian = Guardian.objects.filter(
                id=data["guardian"], school=request.school
            ).first()
            if guardian is None:
                raise ValidationError({"guardian": "Unknown guardian."})
        else:
            guardian = Guardian.objects.create(
                school=request.school,
                name=data["name"].strip(),
                contact=data.get("contact", ""),
                email=data.get("email", ""),
                address=data.get("address", ""),
                occupation=data.get("occupation", ""),
            )
        with transaction.atomic():
            # The unique constraint spans soft-deleted rows: revive instead.
            link = StudentGuardian.all_objects.filter(
                student=student, guardian=guardian, relation=data["relation"]
            ).first()
            if link is not None and link.is_active:
                raise ValidationError("This guardian is already linked with that relation.")
            if data["is_primary_contact"]:
                student.guardian_links.update(is_primary_contact=False)
            if link is not None:
                link.is_active = True
                link.is_primary_contact = data["is_primary_contact"]
                link.save(update_fields=["is_active", "is_primary_contact", "updated_at"])
            else:
                link = StudentGuardian.objects.create(
                    student=student,
                    guardian=guardian,
                    relation=data["relation"],
                    is_primary_contact=data["is_primary_contact"],
                )
        return Response(StudentGuardianSerializer(link).data, status=201)

    @extend_schema(summary="Update or detach a guardian link")
    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"guardians/(?P<link_id>[0-9a-f-]+)",
    )
    def guardian_link(self, request, pk=None, link_id=None):
        student = self.get_object()
        link = student.guardian_links.filter(id=link_id).select_related("guardian").first()
        if link is None:
            raise ValidationError("Unknown guardian link.")
        if request.method == "DELETE":
            # Detach the relationship; the guardian person remains (they may
            # be linked to siblings).
            link.soft_delete()
            return Response(status=204)
        relation = request.data.get("relation")
        if relation is not None:
            if relation not in StudentGuardian.Relation.values:
                raise ValidationError({"relation": "Unknown relation."})
            link.relation = relation
        primary = request.data.get("is_primary_contact")
        with transaction.atomic():
            if primary is not None:
                if primary:
                    student.guardian_links.exclude(id=link.id).update(
                        is_primary_contact=False
                    )
                link.is_primary_contact = bool(primary)
            link.save()
            person_fields = {
                k: v
                for k, v in request.data.items()
                if k in ("name", "contact", "email", "address", "occupation")
            }
            if person_fields:
                person = GuardianSerializer(link.guardian, data=person_fields, partial=True)
                person.is_valid(raise_exception=True)
                person.save()
        return Response(StudentGuardianSerializer(link).data)


class GuardianViewSet(TenantScopedViewSet):
    queryset = Guardian.objects.all()
    serializer_class = GuardianSerializer
    allowed_roles = MANAGERS
    permission_code = "students"

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search", "").strip()
        if search:
            for term in search.split()[:4]:
                qs = qs.filter(name__icontains=term) | qs.filter(contact__icontains=term)
        return qs.order_by("name")


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
        search = self.request.query_params.get("search", "").strip()
        if search:
            for term in search.split()[:4]:
                qs = qs.filter(first_name__icontains=term) | qs.filter(
                    last_name__icontains=term
                )
        return qs.order_by("first_name", "last_name")


class StaffRoleListView(ListAPIView):
    """Global vocabulary — read-only for schools."""

    queryset = StaffRole.objects.all()
    serializer_class = StaffRoleSerializer
    permission_classes = [IsAuthenticated, RoleAllowed]
    allowed_roles = MANAGERS
