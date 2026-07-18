from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import ModulePermissionAllowed, RoleAllowed
from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role
from apps.people.models import Student
from apps.tenants.services import resolve_school_for

from .models import (
    BillingYear,
    Charge,
    ChargeBatch,
    FeeSchedule,
    FeeTitle,
    Payment,
    StandingDiscount,
)
from .serializers import (
    BillingYearSerializer,
    ChargeBatchSerializer,
    ChargeSerializer,
    FeeScheduleSerializer,
    FeeTitleSerializer,
    PaymentSerializer,
    StandingDiscountSerializer,
)
from .services import education_fee
from .services.dues import student_dues

MANAGERS = (Role.ADMIN, Role.STAFF)


class EducationFeeLevelsView(APIView):
    """Education Equality Fee targeting for the caller's school.

    Vendor-set (Django admin); the Collect screen reads this to preview the
    3% government levy only for students whose education level is enabled."""

    permission_classes = [IsAuthenticated, RoleAllowed, ModulePermissionAllowed]
    allowed_roles = MANAGERS
    permission_code = "billing"

    def get(self, request):
        school = resolve_school_for(request.user)
        if school is None:
            raise PermissionDenied("No school is associated with this account.")
        return Response({
            "enabled": education_fee.enabled_levels(school),
            "percent": str(education_fee.EDU_FEE_PERCENT),
        })


class BillingYearListView(ListAPIView):
    queryset = BillingYear.objects.order_by("-name")
    serializer_class = BillingYearSerializer
    permission_classes = [IsAuthenticated, RoleAllowed]
    allowed_roles = MANAGERS


class FeeTitleViewSet(TenantScopedViewSet):
    queryset = FeeTitle.objects.all()
    serializer_class = FeeTitleSerializer
    allowed_roles = MANAGERS
    permission_code = "billing"


class FeeScheduleViewSet(TenantScopedViewSet):
    queryset = FeeSchedule.objects.select_related("fee_title", "class_info")
    serializer_class = FeeScheduleSerializer
    allowed_roles = MANAGERS
    permission_code = "billing"

    def get_queryset(self):
        qs = super().get_queryset()
        class_info = self.request.query_params.get("class_info")
        if class_info:
            qs = qs.filter(class_info=class_info)
        return qs


class StandingDiscountViewSet(TenantScopedViewSet):
    queryset = StandingDiscount.objects.select_related("student", "fee_title")
    serializer_class = StandingDiscountSerializer
    allowed_roles = MANAGERS
    permission_code = "billing"

    def get_queryset(self):
        qs = super().get_queryset()
        student = self.request.query_params.get("student")
        if student:
            qs = qs.filter(student=student)
        return qs


class ChargeBatchViewSet(TenantScopedViewSet):
    """Creating a batch generates one charge per running student (M8)."""

    queryset = ChargeBatch.objects.select_related(
        "class_info__course", "class_info__section", "academic_year"
    ).order_by("-created_at")
    serializer_class = ChargeBatchSerializer
    allowed_roles = MANAGERS
    permission_code = "billing"
    http_method_names = ["get", "post", "head", "options"]  # immutable once run


class ChargeViewSet(TenantScopedViewSet):
    queryset = Charge.objects.select_related("student")
    serializer_class = ChargeSerializer
    allowed_roles = MANAGERS
    permission_code = "billing"
    http_method_names = ["get", "post", "head", "options"]  # POST = old-dues action only

    def create(self, request, *args, **kwargs):
        # Ad-hoc charges stay closed; batches/year-end and the old-dues
        # action below are the only writers.
        raise MethodNotAllowed("POST")

    def get_queryset(self):
        qs = super().get_queryset()
        student = self.request.query_params.get("student")
        if student:
            qs = qs.filter(student=student)
        if self.action == "retrieve":
            qs = qs.prefetch_related("lines")
        return qs.order_by("-date_bs")

    @extend_schema(summary="Post pre-system OLD DUES balances for many students")
    @action(detail=False, methods=["post"], url_path="post-old-dues")
    def post_old_dues(self, request):
        """Legacy old-dues posting: one OLD_DUES charge per student for
        balances carried from before the system. Zero/blank amounts skip."""
        from decimal import Decimal, InvalidOperation

        from apps.academics.models import AcademicYear
        from apps.people.models import Student

        from .models import BillingYear, ChargeLine, LineType

        year = AcademicYear.objects.filter(
            school=request.school, id=request.data.get("academic_year")
        ).first()
        billing_year = BillingYear.objects.filter(
            id=request.data.get("billing_year")
        ).first()
        date_bs = (request.data.get("date_bs") or "").strip()
        entries = request.data.get("entries")
        if year is None:
            raise ValidationError({"academic_year": "Unknown academic year."})
        if billing_year is None:
            raise ValidationError({"billing_year": "Unknown billing year."})
        if not date_bs:
            raise ValidationError({"date_bs": "Required."})
        if not isinstance(entries, list) or not entries:
            raise ValidationError({"entries": "Provide student/amount rows."})

        cleaned = []
        for i, entry in enumerate(entries):
            try:
                amount = Decimal(str(entry.get("amount") or "0"))
            except (InvalidOperation, TypeError):
                raise ValidationError(
                    {"entries": f"Row {i + 1}: bad amount."}
                ) from None
            if amount == 0:
                continue
            if amount < 0:
                raise ValidationError({"entries": f"Row {i + 1}: negative amount."})
            cleaned.append((entry.get("student"), amount, entry.get("remarks") or ""))
        if not cleaned:
            return Response({"posted": 0})

        students = {
            str(s.id): s
            for s in Student.objects.filter(
                school=request.school, id__in=[c[0] for c in cleaned]
            )
        }
        if len(students) != len({c[0] for c in cleaned}):
            raise ValidationError({"entries": "Unknown student in the list."})

        from django.db import transaction

        with transaction.atomic():
            posted = 0
            for student_id, amount, remarks in cleaned:
                charge = Charge.objects.create(
                    school=request.school, student=students[student_id],
                    date_bs=date_bs, academic_year=year, billing_year=billing_year,
                    total=amount, remarks=remarks or "Old dues",
                )
                ChargeLine.objects.create(
                    charge=charge, line_type=LineType.OLD_DUES,
                    label="Old dues", amount=amount,
                )
                posted += 1
        return Response({"posted": posted}, status=201)


class PaymentViewSet(TenantScopedViewSet):
    queryset = Payment.objects.select_related("student", "class_info")
    serializer_class = PaymentSerializer
    allowed_roles = MANAGERS
    permission_code = "billing"
    http_method_names = ["get", "post", "head", "options"]  # receipts are immutable

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("student", "kind", "academic_year"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        if self.action == "retrieve":
            qs = qs.prefetch_related("lines")
        return qs.order_by("-created_at")

    @extend_schema(summary="Outstanding dues for a student")
    @action(detail=False, methods=["get"], url_path="dues")
    def dues(self, request):
        student_id = request.query_params.get("student")
        student = Student.objects.filter(id=student_id, school=request.school).first()
        if student is None:
            return Response({"error": {"message": "Unknown student."}}, status=404)
        return Response({"student": student_id, "dues": student_dues(student)})
