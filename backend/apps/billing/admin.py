from django.contrib import admin

from .models import (
    BillingYear,
    Charge,
    ChargeBatch,
    ChargeLine,
    FeeSchedule,
    FeeTitle,
    Payment,
    PaymentLine,
    ReceiptSerialCounter,
    StandingDiscount,
)


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
