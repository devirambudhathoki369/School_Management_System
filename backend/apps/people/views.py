from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.parsers import FormParser, MultiPartParser
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


def _swap_photo(request, person):
    """POST replaces the photo (validated intake), DELETE removes it.
    The old file is deleted from storage — person photos are current-state,
    not history."""
    from apps.core import uploads

    if request.method == "DELETE":
        if person.photo:
            person.photo.delete(save=False)
            person.photo = None
            person.save(update_fields=["photo", "updated_at"])
        return Response(status=204)
    upload = request.FILES.get("photo")
    if upload is None:
        raise ValidationError({"photo": "Attach an image."})
    ext = uploads.validate(upload, "photo")
    if person.photo:
        person.photo.delete(save=False)
    # the upload_to callable derives the real stored name; the original
    # filename only contributes its (sniffed) extension
    upload.name = f"photo.{ext}"
    person.photo = upload
    person.save(update_fields=["photo", "updated_at"])
    return Response({"photo": person.photo.url}, status=200)



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
            qs = qs.prefetch_related("guardian_links__guardian__account")
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

    @extend_schema(summary="Enroll many students into one class at once")
    @action(detail=False, methods=["post"], url_path="bulk-enroll")
    def bulk_enroll(self, request):
        """Legacy bulk enrolment: one class, many rows in a single shot.
        All-or-nothing — one bad row rejects the batch with its row number."""
        from django.db import transaction

        from apps.academics.models import ClassInfo

        class_info = ClassInfo.objects.filter(
            id=request.data.get("class_info"), school=request.school
        ).first()
        if class_info is None:
            raise ValidationError({"class_info": "Unknown class."})
        if class_info.academic_year_id is None:
            raise ValidationError({"class_info": "Class has no academic year."})
        rows = request.data.get("rows")
        if not isinstance(rows, list) or not rows:
            raise ValidationError({"rows": "Provide at least one student row."})
        if len(rows) > 200:
            raise ValidationError({"rows": "At most 200 rows per batch."})

        allowed = {
            "first_name", "middle_name", "last_name", "gender", "roll_no",
            "contact", "address", "email", "birth_date_bs", "ethnicity",
            "previous_school", "remarks",
        }
        cleaned = []
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValidationError({"rows": f"Row {i + 1}: not an object."})
            data = {k: (row.get(k) or "").strip() for k in allowed}
            if not data["first_name"] or not data["last_name"]:
                raise ValidationError(
                    {"rows": f"Row {i + 1}: first and last name are required."}
                )
            if data["gender"] not in ("male", "female", "other"):
                raise ValidationError({"rows": f"Row {i + 1}: bad gender."})
            cleaned.append(data)

        with transaction.atomic():
            created = [
                Student.objects.create(
                    school=request.school, class_info=class_info,
                    academic_year=class_info.academic_year, **data,
                )
                for data in cleaned
            ]
        return Response(
            {"enrolled": len(created), "students": [str(s.id) for s in created]},
            status=201,
        )

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


    @extend_schema(summary="Upload or remove this student's photo")
    @action(
        detail=True,
        methods=["post", "delete"],
        url_path="photo",
        parser_classes=[MultiPartParser, FormParser],
    )
    def photo(self, request, pk=None):
        return _swap_photo(request, self.get_object())


class GuardianViewSet(TenantScopedViewSet):
    queryset = Guardian.objects.select_related("account")
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

    @extend_schema(
        summary="Grant or reset guardian portal access",
        request=None,
        description=(
            "Creates the guardian's portal login (or rotates the password of an "
            "existing one, reactivating it and ending all sessions). The response "
            "carries the temporary password exactly once; it is never retrievable "
            "again."
        ),
    )
    @action(detail=True, methods=["post", "delete"], url_path="portal-access")
    def portal_access(self, request, pk=None):
        from . import services

        guardian = self.get_object()
        if request.method == "DELETE":
            if not services.revoke_portal_access(guardian):
                raise ValidationError("This guardian has no portal account.")
            return Response(status=204)
        account, temp_password, created = services.provision_portal_access(guardian)
        return Response(
            {
                "username": account.username,
                "temp_password": temp_password,
                "created": created,
            },
            status=201 if created else 200,
        )


class StaffViewSet(TenantScopedViewSet):
    queryset = Staff.objects.select_related("role", "account")
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

    def perform_update(self, serializer):
        """Module grants are security-sensitive: every change lands in the
        append-only audit trail with the exact delta."""
        before = set(serializer.instance.permissions or [])
        super().perform_update(serializer)
        after = set(serializer.instance.permissions or [])
        if before != after:
            from apps.audit.models import AuditEvent
            from apps.audit.services import record as audit

            audit(
                action=AuditEvent.Action.UPDATE,
                object_table="people.Staff",
                object_id=serializer.instance.id,
                actor=self.request.user,
                school=self.request.school,
                changes={
                    "event": "permissions_change",
                    "granted": sorted(after - before),
                    "revoked": sorted(before - after),
                },
                request=self.request,
            )

    @extend_schema(summary="Provision, reset or revoke this staff member's login")
    @action(detail=True, methods=["post", "delete"], url_path="login-access")
    def login_access(self, request, pk=None):
        from apps.audit.models import AuditEvent
        from apps.audit.services import record as audit

        from . import services

        staff = self.get_object()
        if request.method == "DELETE":
            account_id = staff.account_id
            if not services.revoke_staff_access(staff):
                raise ValidationError("This staff member has no login.")
            audit(
                action=AuditEvent.Action.UPDATE,
                object_table="identity.Account",
                object_id=account_id,
                actor=request.user,
                school=request.school,
                changes={"event": "login_revoked", "staff": str(staff.id)},
                request=request,
            )
            return Response(status=204)
        account, temp_password, created = services.provision_staff_access(staff)
        audit(
            action=AuditEvent.Action.CREATE if created else AuditEvent.Action.UPDATE,
            object_table="identity.Account",
            object_id=account.id,
            actor=request.user,
            school=request.school,
            changes={
                "event": "login_provisioned" if created else "login_reset",
                "staff": str(staff.id),
            },
            request=request,
        )
        return Response(
            {
                "username": account.username,
                "temp_password": temp_password,
                "created": created,
            },
            status=201 if created else 200,
        )


    @extend_schema(summary="Upload or remove this staff member's photo")
    @action(
        detail=True,
        methods=["post", "delete"],
        url_path="photo",
        parser_classes=[MultiPartParser, FormParser],
    )
    def photo(self, request, pk=None):
        return _swap_photo(request, self.get_object())


class StaffRoleListView(ListAPIView):
    """Global vocabulary — read-only for schools."""

    queryset = StaffRole.objects.all()
    serializer_class = StaffRoleSerializer
    permission_classes = [IsAuthenticated, RoleAllowed]
    allowed_roles = MANAGERS
