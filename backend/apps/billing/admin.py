from django.contrib import admin

from .models import (
    BillingYear,
    Charge,
    ChargeBatch,
    ChargeLine,
    EducationFeeLevel,
    FeeSchedule,
    FeeTitle,
    Payment,
    PaymentLine,
    ReceiptSerialCounter,
    StandingDiscount,
)


@admin.register(EducationFeeLevel)
class EducationFeeLevelAdmin(admin.ModelAdmin):
    """Vendor targeting for the Education Equality Fee (3% levy): one row
    per (school, education level) that collects it. No rows = fee off."""

    list_display = ["school", "education_level"]
    list_filter = ["education_level", "school"]
    search_fields = ["school__name"]


class ChargeLineInline(admin.TabularInline):
    model = ChargeLine
    extra = 0


class PaymentLineInline(admin.TabularInline):
    model = PaymentLine
    extra = 0


@admin.register(Charge)
class ChargeAdmin(admin.ModelAdmin):
    list_display = ["student", "school", "date_bs", "total"]
    search_fields = ["student__first_name", "student__last_name"]
    list_select_related = ["student", "school"]
    inlines = [ChargeLineInline]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["__str__", "school", "student", "date_bs", "kind", "mode"]
    list_filter = ["kind", "mode"]
    search_fields = ["student__first_name", "student__last_name"]
    list_select_related = ["school", "student"]
    inlines = [PaymentLineInline]


@admin.register(FeeTitle)
class FeeTitleAdmin(admin.ModelAdmin):
    list_display = ["name", "school", "kind"]
    list_filter = ["kind"]
    search_fields = ["name", "school__name"]


admin.site.register(
    [BillingYear, FeeSchedule, StandingDiscount, ChargeBatch, ReceiptSerialCounter]
)
