from django.db import transaction
from rest_framework import serializers

from apps.accounting.services import entries, serials
from apps.billing.serializers import TenantChildValidationMixin

from .models import (
    FiscalYear,
    LedgerAccount,
    LedgerGroup,
    OpeningBalance,
    Voucher,
    VoucherLine,
    VoucherType,
)


class FiscalYearSerializer(serializers.ModelSerializer):
    class Meta:
        model = FiscalYear
        fields = ["id", "name", "start_date_bs", "end_date_bs", "closed", "previous", "remarks"]
        read_only_fields = ["id", "closed", "previous"]  # closing is its own flow

    def validate(self, attrs):
        request = self.context["request"]
        name = attrs.get("name")
        if name and (
            FiscalYear.objects.filter(school=request.school, name=name)
            .exclude(id=getattr(self.instance, "id", None))
            .exists()
        ):
            raise serializers.ValidationError({"name": "Fiscal year already exists."})
        return attrs


class LedgerGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = LedgerGroup
        fields = ["code", "name", "natural_side", "category", "cash_flow"]


class LedgerAccountSerializer(serializers.ModelSerializer):
    group_name = serializers.CharField(source="group.name", read_only=True)

    class Meta:
        model = LedgerAccount
        fields = ["id", "name", "group", "group_name", "address", "contact"]
        read_only_fields = ["id"]


class OpeningBalanceSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("ledger", "fiscal_year")
    ledger_name = serializers.CharField(source="ledger.name", read_only=True)

    class Meta:
        model = OpeningBalance
        fields = ["id", "ledger", "ledger_name", "fiscal_year", "side", "amount"]
        read_only_fields = ["id"]


class VoucherLineSerializer(serializers.ModelSerializer):
    ledger_name = serializers.CharField(source="ledger.name", read_only=True)

    class Meta:
        model = VoucherLine
        fields = ["id", "ledger", "ledger_name", "side", "amount", "remarks"]
        read_only_fields = ["id"]
        extra_kwargs = {
            # income/expense/contra sides are server-derived; journal lines
            # must send one (validated in services.entries)
            "side": {"required": False},
            "remarks": {"required": False, "default": ""},
        }


class VoucherSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("fiscal_year", "cash_ledger")
    lines = VoucherLineSerializer(many=True)
    number = serializers.CharField(read_only=True)

    class Meta:
        model = Voucher
        fields = [
            "id", "voucher_type", "serial", "number", "date_bs", "fiscal_year",
            "cash_ledger", "mode", "remarks", "needs_review", "lines",
        ]
        read_only_fields = ["id", "serial", "needs_review"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not attrs.get("lines"):
            raise serializers.ValidationError({"lines": "A voucher needs at least one line."})
        for line in attrs["lines"]:
            if line["ledger"].school_id != self.context["request"].school.id:
                raise serializers.ValidationError(
                    {"lines": "A ledger does not belong to your school."}
                )
        if attrs["fiscal_year"].closed:
            raise serializers.ValidationError(
                {"fiscal_year": "This fiscal year is closed."}
            )
        voucher_type = attrs["voucher_type"]
        if voucher_type in (VoucherType.INCOME, VoucherType.EXPENSE) and not attrs.get("mode"):
            raise serializers.ValidationError(
                {"mode": "Income/expense vouchers need a payment mode."}
            )
        if voucher_type == VoucherType.JOURNAL:
            attrs["cash_ledger"] = None
            attrs["mode"] = ""
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        lines = entries.build_lines(
            validated_data["voucher_type"],
            validated_data.get("cash_ledger"),
            validated_data.pop("lines"),
        )
        with transaction.atomic():
            voucher = Voucher.objects.create(
                serial=serials.allocate(
                    request.school,
                    validated_data["fiscal_year"],
                    validated_data["voucher_type"],
                ),
                created_by=request.user,
                **validated_data,
            )
            VoucherLine.objects.bulk_create(
                VoucherLine(voucher=voucher, **line) for line in lines
            )
        return voucher


__all__ = [
    "FiscalYearSerializer",
    "LedgerAccountSerializer",
    "LedgerGroupSerializer",
    "OpeningBalanceSerializer",
    "VoucherSerializer",
]
