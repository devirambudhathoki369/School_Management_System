from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
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
from .services.dues import student_dues
from .services import education_fee

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
    http_method_names = ["get", "head", "options"]  # written via batches/year-end only

    def get_queryset(self):
        qs = super().get_queryset()
        student = self.request.query_params.get("student")
        if student:
            qs = qs.filter(student=student)
        if self.action == "retrieve":
            qs = qs.prefetch_related("lines")
        return qs.order_by("-date_bs")


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
