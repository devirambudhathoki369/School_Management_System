from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
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
from .services import closing, reports

MANAGERS = (Role.ADMIN, Role.STAFF)


def require_admin(request):
    """Year-end operations are the school owner's call, not general staff."""
    if request.user.role != Role.ADMIN:
        raise PermissionDenied("Only the school admin can run year-end operations.")


class FiscalYearCloseSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=20)
    start_date_bs = serializers.CharField(max_length=10)
    end_date_bs = serializers.CharField(max_length=10)
    retained_ledger = serializers.UUIDField()


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

    @extend_schema(
        summary="Close this fiscal year into a new one",
        request=FiscalYearCloseSerializer,
    )
    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        require_admin(request)
        fiscal_year = self.get_object()
        s = FiscalYearCloseSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        payload = dict(s.validated_data)
        retained_ledger = LedgerAccount.objects.filter(
            id=payload.pop("retained_ledger"), school=request.school
        ).first()
        if retained_ledger is None:
            return Response({"error": {"message": "Unknown retained ledger."}}, status=404)
        new_year = closing.close_fiscal_year(
            request.school, fiscal_year, payload, retained_ledger
        )
        return Response(
            {"message": f"Fiscal year {fiscal_year.name} closed.",
             "new_fiscal_year": FiscalYearSerializer(new_year).data},
            status=201,
        )

    @extend_schema(summary="Undo this fiscal year's close")
    @action(detail=True, methods=["post"], url_path="undo-close")
    def undo_close(self, request, pk=None):
        require_admin(request)
        fiscal_year = closing.undo_fiscal_year_close(request.school, self.get_object())
        return Response({"message": f"Fiscal year {fiscal_year.name} reopened."})


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

    def _as_of_scope(self, request):
        """(fiscal_year, end_date_bs) for as-of reports; end defaults to the
        fiscal year's last day."""
        fiscal_year = FiscalYear.objects.filter(
            id=request.query_params.get("fiscal_year"), school=request.school
        ).first()
        if fiscal_year is None:
            return None, Response(
                {"error": {"message": "fiscal_year is required."}}, status=400
            )
        end = request.query_params.get("end_date_bs") or fiscal_year.end_date_bs
        return (fiscal_year, end), None

    @extend_schema(summary="Profit & loss for a fiscal year (through a BS date)")
    @action(detail=False, methods=["get"], url_path="income-statement")
    def income_statement(self, request):
        scope, error = self._as_of_scope(request)
        if error:
            return error
        return Response(reports.income_statement(request.school, *scope))

    @extend_schema(summary="Balance sheet as of a BS date")
    @action(detail=False, methods=["get"], url_path="balance-sheet")
    def balance_sheet(self, request):
        scope, error = self._as_of_scope(request)
        if error:
            return error
        return Response(reports.balance_sheet(request.school, *scope))

    @extend_schema(summary="Cash flow statement (fiscal-year start through a BS date)")
    @action(detail=False, methods=["get"], url_path="cash-flow")
    def cash_flow(self, request):
        scope, error = self._as_of_scope(request)
        if error:
            return error
        return Response(reports.cash_flow_statement(request.school, *scope))

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
