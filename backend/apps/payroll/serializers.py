from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.billing.serializers import TenantChildValidationMixin
from apps.payroll.services import serials

from .models import (
    SalaryAccrual,
    SalaryAccrualLine,
    SalaryPayment,
    SalaryPaymentLine,
    SalaryStructure,
)

ZERO = Decimal("0")


class SalaryStructureSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("staff",)
    staff_name = serializers.CharField(source="staff.full_name", read_only=True)

    class Meta:
        model = SalaryStructure
        fields = [
            "id", "staff", "staff_name", "effective_from_bs", "basic_salary",
            "grade", "allowance", "extra", "insurance", "pf_contribution", "pan_no",
        ]
        read_only_fields = ["id"]


class SalaryAccrualLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryAccrualLine
        fields = ["id", "earning_type", "amount"]
        read_only_fields = ["id"]


class SalaryAccrualSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("staff", "academic_year")
    lines = SalaryAccrualLineSerializer(many=True)
    staff_name = serializers.CharField(source="staff.full_name", read_only=True)

    class Meta:
        model = SalaryAccrual
        fields = [
            "id", "staff", "staff_name", "date_bs", "months", "academic_year",
            "billing_year", "total", "remarks", "lines",
        ]
        read_only_fields = ["id", "total"]  # total is always the sum of lines

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not attrs.get("lines"):
            raise serializers.ValidationError({"lines": "An accrual needs at least one line."})
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        lines = validated_data.pop("lines")
        with transaction.atomic():
            accrual = SalaryAccrual.objects.create(
                total=sum((line["amount"] for line in lines), ZERO),
                created_by=request.user,
                **validated_data,
            )
            SalaryAccrualLine.objects.bulk_create(
                SalaryAccrualLine(accrual=accrual, **line) for line in lines
            )
        return accrual


class SalaryPaymentLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryPaymentLine
        fields = ["id", "earning_type", "amount", "due_after", "tds_pct", "tds_amount"]
        read_only_fields = ["id"]


class SalaryPaymentSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("staff", "academic_year")
    lines = SalaryPaymentLineSerializer(many=True)
    staff_name = serializers.CharField(source="staff.full_name", read_only=True)

    class Meta:
        model = SalaryPayment
        fields = [
            "id", "staff", "staff_name", "serial", "legacy_serial", "date_bs",
            "academic_year", "billing_year", "payment_month", "mode",
            "gross", "tds_amount", "pf_amount", "insurance_amount", "net_paid",
            "tds_percent", "total_due", "remarks", "lines",
        ]
        # every amount is computed server-side from the lines and the
        # header deductions — the net identity is not client input
        read_only_fields = ["id", "serial", "legacy_serial", "gross", "tds_amount", "net_paid"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not attrs.get("lines"):
            raise serializers.ValidationError({"lines": "A payment needs at least one line."})
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        lines = validated_data.pop("lines")
        gross = sum((line["amount"] for line in lines), ZERO)
        tds = sum((line.get("tds_amount") or ZERO for line in lines), ZERO)
        pf = validated_data.get("pf_amount") or ZERO
        insurance = validated_data.get("insurance_amount") or ZERO
        with transaction.atomic():
            payment = SalaryPayment.objects.create(
                serial=serials.allocate(request.school, validated_data["billing_year"]),
                gross=gross,
                tds_amount=tds,
                net_paid=gross - tds - pf - insurance,
                created_by=request.user,
                **validated_data,
            )
            SalaryPaymentLine.objects.bulk_create(
                SalaryPaymentLine(payment=payment, **line) for line in lines
            )
        return payment


class BulkAccrualRowSerializer(serializers.Serializer):
    staff = serializers.UUIDField()
    lines = SalaryAccrualLineSerializer(many=True)


class BulkAccrualSerializer(serializers.Serializer):
    """One posting run: shared header, one accrual per staff row (legacy
    StaffLedgerView.prepareData)."""

    date_bs = serializers.CharField(max_length=10)
    months = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=12), allow_empty=False
    )
    academic_year = serializers.UUIDField()
    billing_year = serializers.UUIDField()
    remarks = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    rows = BulkAccrualRowSerializer(many=True, allow_empty=False)


__all__ = [
    "BulkAccrualSerializer",
    "SalaryAccrualSerializer",
    "SalaryPaymentSerializer",
    "SalaryStructureSerializer",
]
