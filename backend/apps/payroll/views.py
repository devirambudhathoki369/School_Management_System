from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.academics.models import AcademicYear
from apps.billing.models import BillingYear
from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role
from apps.people.models import Staff

from .models import SalaryAccrual, SalaryAccrualLine, SalaryPayment, SalaryStructure
from .serializers import (
    BulkAccrualSerializer,
    SalaryAccrualSerializer,
    SalaryPaymentSerializer,
    SalaryStructureSerializer,
)
from .services import statements

MANAGERS = (Role.ADMIN, Role.STAFF)


def _get_staff(request):
    staff_id = request.query_params.get("staff")
    if not staff_id:
        return None, Response({"error": {"message": "staff is required."}}, status=400)
    staff = Staff.objects.filter(id=staff_id, school=request.school).first()
    if staff is None:
        return None, Response({"error": {"message": "Unknown staff."}}, status=404)
    return staff, None


class SalaryStructureViewSet(TenantScopedViewSet):
    queryset = SalaryStructure.objects.select_related("staff")
    serializer_class = SalaryStructureSerializer
    allowed_roles = MANAGERS
    permission_code = "payroll"

    def get_queryset(self):
        qs = super().get_queryset()
        staff = self.request.query_params.get("staff")
        if staff:
            qs = qs.filter(staff=staff)
        return qs.order_by("staff", "-effective_from_bs")


class SalaryAccrualViewSet(TenantScopedViewSet):
    queryset = SalaryAccrual.objects.select_related("staff")
    serializer_class = SalaryAccrualSerializer
    allowed_roles = MANAGERS
    permission_code = "payroll"
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("staff", "academic_year", "billing_year"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        if self.action == "retrieve":
            qs = qs.prefetch_related("lines")
        return qs.order_by("-date_bs")

    def perform_destroy(self, instance):
        # legacy parity: deleting a posting records why
        reason = self.request.data.get("remarks") if isinstance(self.request.data, dict) else None
        if reason:
            instance.remarks = str(reason)[:100]
            instance.save(update_fields=["remarks", "updated_at"])
        instance.soft_delete()

    @extend_schema(summary="Post salaries for many staff in one run", request=BulkAccrualSerializer)
    @action(detail=False, methods=["post"], url_path="bulk")
    def bulk(self, request):
        s = BulkAccrualSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        header = s.validated_data
        academic_year = AcademicYear.objects.filter(
            id=header["academic_year"], school=request.school
        ).first()
        billing_year = BillingYear.objects.filter(id=header["billing_year"]).first()
        if academic_year is None or billing_year is None:
            return Response({"error": {"message": "Unknown year."}}, status=400)
        staff_ids = [row["staff"] for row in header["rows"]]
        staff_by_id = {
            staff.id: staff
            for staff in Staff.objects.filter(id__in=staff_ids, school=request.school)
        }
        missing = [str(sid) for sid in staff_ids if sid not in staff_by_id]
        if missing:
            return Response(
                {"error": {"message": "Unknown staff.", "staff": missing}}, status=400
            )
        created = []
        with transaction.atomic():
            for row in header["rows"]:
                accrual = SalaryAccrual.objects.create(
                    school=request.school,
                    staff=staff_by_id[row["staff"]],
                    date_bs=header["date_bs"],
                    months=header["months"],
                    academic_year=academic_year,
                    billing_year=billing_year,
                    remarks=header["remarks"],
                    total=sum(line["amount"] for line in row["lines"]),
                    created_by=request.user,
                )
                SalaryAccrualLine.objects.bulk_create(
                    SalaryAccrualLine(accrual=accrual, **line) for line in row["lines"]
                )
                created.append(accrual)
        return Response(
            {"created": len(created), "ids": [str(accrual.id) for accrual in created]},
            status=201,
        )

    @extend_schema(summary="Months already posted in a scope")
    @action(detail=False, methods=["get"], url_path="months")
    def months(self, request):
        months = statements.posted_months(
            request.school,
            staff=request.query_params.get("staff") or None,
            academic_year=request.query_params.get("academic_year") or None,
            billing_year=request.query_params.get("billing_year") or None,
        )
        return Response({"months": months})


class SalaryPaymentViewSet(TenantScopedViewSet):
    queryset = SalaryPayment.objects.select_related("staff")
    serializer_class = SalaryPaymentSerializer
    allowed_roles = MANAGERS
    permission_code = "payroll"
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("staff", "academic_year", "billing_year"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        if self.action == "retrieve":
            qs = qs.prefetch_related("lines")
        return qs.order_by("-created_at")

    def perform_destroy(self, instance):
        reason = self.request.data.get("remarks") if isinstance(self.request.data, dict) else None
        if reason:
            instance.remarks = str(reason)[:250]
            instance.save(update_fields=["remarks", "updated_at"])
        instance.soft_delete()

    @extend_schema(summary="Outstanding balance per earning head for a staff member")
    @action(detail=False, methods=["get"], url_path="balance")
    def balance(self, request):
        staff, error = _get_staff(request)
        if error:
            return error
        billing_year = request.query_params.get("billing_year") or None
        return Response(
            {"staff": str(staff.id), **statements.head_balances(staff, billing_year)}
        )

    @extend_schema(summary="Chronological payroll statement for a staff member")
    @action(detail=False, methods=["get"], url_path="statement")
    def statement(self, request):
        staff, error = _get_staff(request)
        if error:
            return error
        return Response({"staff": str(staff.id), "entries": statements.statement(staff)})

    @extend_schema(summary="Salary sheet for a BS date range")
    @action(detail=False, methods=["get"], url_path="salary-sheet")
    def salary_sheet(self, request):
        start = request.query_params.get("start_date_bs")
        end = request.query_params.get("end_date_bs")
        if not (start and end):
            return Response(
                {"error": {"message": "start_date_bs and end_date_bs are required."}},
                status=400,
            )
        return Response(statements.salary_sheet(request.school, start, end))
