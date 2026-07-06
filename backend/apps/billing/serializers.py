from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.billing.services import charges as charge_service
from apps.billing.services import serials

from .models import (
    BillingYear,
    Charge,
    ChargeBatch,
    ChargeLine,
    FeeSchedule,
    FeeTitle,
    LineType,
    Payment,
    PaymentLine,
    StandingDiscount,
)


class TenantChildValidationMixin:
    tenant_fields: tuple[str, ...] = ()

    def validate(self, attrs):
        request = self.context["request"]
        for field in self.tenant_fields:
            value = attrs.get(field)
            if value is not None and value.school_id != request.school.id:
                raise serializers.ValidationError({field: "Does not belong to your school."})
        return attrs


class BillingYearSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillingYear
        fields = ["id", "name", "start_date_bs", "end_date_bs", "closed"]
        read_only_fields = fields  # vendor-managed; schools only read


class FeeTitleSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeTitle
        fields = ["id", "name", "months", "kind"]
        read_only_fields = ["id"]


class FeeScheduleSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("class_info", "fee_title")
    title_name = serializers.CharField(source="fee_title.name", read_only=True)

    class Meta:
        model = FeeSchedule
        fields = ["id", "class_info", "fee_title", "title_name", "amount"]
        read_only_fields = ["id"]


class StandingDiscountSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("student", "fee_title", "academic_year")

    class Meta:
        model = StandingDiscount
        fields = [
            "id", "student", "fee_title", "flat_amount", "percentage",
            "academic_year", "remarks",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get("flat_amount") is None and attrs.get("percentage") is None:
            raise serializers.ValidationError("Provide a flat amount or a percentage.")
        return attrs


class ChargeLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChargeLine
        fields = ["id", "line_type", "fee_title", "label", "amount"]


class ChargeSerializer(serializers.ModelSerializer):
    lines = ChargeLineSerializer(many=True, read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = Charge
        fields = [
            "id", "batch", "student", "student_name", "date_bs",
            "academic_year", "billing_year", "total", "remarks", "lines",
        ]


class ChargeBatchSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("academic_year", "class_info")
    charge_count = serializers.IntegerField(source="charges.count", read_only=True)
    class_label = serializers.CharField(source="class_info.__str__", read_only=True)
    academic_year_name = serializers.CharField(source="academic_year.name", read_only=True)

    class Meta:
        model = ChargeBatch
        fields = [
            "id", "date_bs", "months", "academic_year", "academic_year_name",
            "billing_year", "class_info", "class_label", "remarks", "charge_count",
        ]
        read_only_fields = ["id"]

    def create(self, validated_data):
        request = self.context["request"]
        with transaction.atomic():
            batch = ChargeBatch.objects.create(created_by=request.user, **validated_data)
            created = charge_service.generate(batch)
        self._generated = created
        return batch


class PaymentLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentLine
        fields = [
            "id", "line_type", "fee_title", "label", "amount",
            "discount", "due_after", "tax_pct", "tax_amount",
        ]
        read_only_fields = ["id"]


class PaymentSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("student", "academic_year")
    lines = PaymentLineSerializer(many=True)
    receipt_no = serializers.SerializerMethodField()
    student_name = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id", "kind", "serial", "legacy_serial", "receipt_no", "date_bs",
            "student", "student_name", "class_info", "academic_year",
            "billing_year", "payment_month", "mode", "total_paid",
            "total_discount", "total_due", "remarks", "payer_name",
            "payer_address", "lines",
        ]
        read_only_fields = ["id", "serial", "legacy_serial", "class_info", "total_paid"]

    def get_receipt_no(self, payment) -> int | None:
        return payment.serial or payment.legacy_serial

    def get_student_name(self, payment) -> str | None:
        return payment.student.full_name if payment.student_id else None

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs["kind"] == FeeTitle.Kind.REGULAR and attrs.get("student") is None:
            raise serializers.ValidationError({"student": "Required for regular receipts."})
        if not attrs.get("lines"):
            raise serializers.ValidationError({"lines": "A receipt needs at least one line."})
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        lines = validated_data.pop("lines")
        student = validated_data.get("student")
        with transaction.atomic():
            payment = Payment.objects.create(
                serial=serials.allocate(
                    request.school, validated_data["billing_year"], validated_data["kind"]
                ),
                # M3: snapshot the class at payment time; M1: total_paid is the
                # pre-discount sum of lines, discount tracked separately.
                class_info=student.class_info if student else None,
                total_paid=sum((line["amount"] for line in lines), Decimal("0")),
                total_discount=sum(
                    (line.get("discount") or Decimal("0") for line in lines), Decimal("0")
                ),
                created_by=request.user,
                **validated_data,
            )
            PaymentLine.objects.bulk_create(
                PaymentLine(payment=payment, **line) for line in lines
            )
        return payment


__all__ = [
    "BillingYearSerializer", "ChargeBatchSerializer", "ChargeSerializer",
    "FeeScheduleSerializer", "FeeTitleSerializer", "LineType",
    "PaymentSerializer", "StandingDiscountSerializer",
]
