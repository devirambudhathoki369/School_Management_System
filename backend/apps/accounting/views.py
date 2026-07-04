from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import RoleAllowed
from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import FiscalYear, LedgerAccount, LedgerGroup, OpeningBalance, Voucher
from .serializers import (
    FiscalYearSerializer,
    LedgerAccountSerializer,
    LedgerGroupSerializer,
    OpeningBalanceSerializer,
    VoucherSerializer,
)
from .services import reports

MANAGERS = (Role.ADMIN, Role.STAFF)


class LedgerGroupListView(ListAPIView):
    """Global reference data: the 34 ledger groups."""

    queryset = LedgerGroup.objects.all()
    serializer_class = LedgerGroupSerializer
    permission_classes = [IsAuthenticated, RoleAllowed]
    allowed_roles = MANAGERS
    pagination_class = None


class FiscalYearViewSet(TenantScopedViewSet):
    queryset = FiscalYear.objects.all()
    serializer_class = FiscalYearSerializer
    allowed_roles = MANAGERS
    permission_code = "accounting"
    http_method_names = ["get", "post", "patch", "head", "options"]  # closing != deleting

    def get_queryset(self):
        return super().get_queryset().order_by("-start_date_bs")


class LedgerAccountViewSet(TenantScopedViewSet):
    queryset = LedgerAccount.objects.select_related("group")
    serializer_class = LedgerAccountSerializer
    allowed_roles = MANAGERS
    permission_code = "accounting"

    def get_queryset(self):
        qs = super().get_queryset()
        group = self.request.query_params.get("group")
        if group:
            qs = qs.filter(group=group)
        return qs.order_by("name")


class OpeningBalanceViewSet(TenantScopedViewSet):
    queryset = OpeningBalance.objects.select_related("ledger")
    serializer_class = OpeningBalanceSerializer
    allowed_roles = MANAGERS
    permission_code = "accounting"

    def get_queryset(self):
        qs = super().get_queryset()
        fiscal_year = self.request.query_params.get("fiscal_year")
        if fiscal_year:
            qs = qs.filter(fiscal_year=fiscal_year)
        return qs


class VoucherViewSet(TenantScopedViewSet):
    queryset = Voucher.objects.select_related("fiscal_year", "cash_ledger")
    serializer_class = VoucherSerializer
    allowed_roles = MANAGERS
    permission_code = "accounting"
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("voucher_type", "fiscal_year", "needs_review"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        if self.action == "retrieve":
            qs = qs.prefetch_related("lines__ledger")
        return qs.order_by("-date_bs", "-created_at")

    def perform_destroy(self, instance):
        reason = self.request.data.get("remarks") if isinstance(self.request.data, dict) else None
        if reason:
            instance.remarks = str(reason)[:250]
            instance.save(update_fields=["remarks", "updated_at"])
        instance.soft_delete()

    def _report_scope(self, request):
        fiscal_year = FiscalYear.objects.filter(
            id=request.query_params.get("fiscal_year"), school=request.school
        ).first()
        start = request.query_params.get("start_date_bs")
        end = request.query_params.get("end_date_bs")
        if fiscal_year is None or not (start and end):
            return None, Response(
                {"error": {"message": "fiscal_year, start_date_bs and end_date_bs are required."}},
                status=400,
            )
        return (fiscal_year, start, end), None

    @extend_schema(summary="Trial balance for a BS date range")
    @action(detail=False, methods=["get"], url_path="trial-balance")
    def trial_balance(self, request):
        scope, error = self._report_scope(request)
        if error:
            return error
        return Response(reports.trial_balance(request.school, *scope))

    @extend_schema(summary="Individual or group-wise ledger report")
    @action(detail=False, methods=["get"], url_path="ledger-report")
    def ledger_report(self, request):
        scope, error = self._report_scope(request)
        if error:
            return error
        fiscal_year, start, end = scope
        ledger_id = request.query_params.get("ledger")
        if ledger_id:
            ledger = LedgerAccount.objects.filter(id=ledger_id, school=request.school).first()
            if ledger is None:
                return Response({"error": {"message": "Unknown ledger."}}, status=404)
            return Response(
                reports.ledger_statement(request.school, fiscal_year, ledger, start, end)
            )
        groups = request.query_params.get("groups")
        if not groups:
            return Response(
                {"error": {"message": "Provide ledger or groups."}}, status=400
            )
        codes = [int(code) for code in groups.split(",") if code.strip().isdigit()]
        return Response(
            reports.group_statement(request.school, fiscal_year, codes, start, end)
        )
