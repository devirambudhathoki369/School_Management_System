from django.contrib import admin

from .models import (
    FiscalYear,
    LedgerAccount,
    LedgerGroup,
    OpeningBalance,
    Voucher,
    VoucherLine,
    VoucherSerialCounter,
)


class VoucherLineInline(admin.TabularInline):
    model = VoucherLine
    extra = 0


@admin.register(Voucher)
class VoucherAdmin(admin.ModelAdmin):
    list_display = ["__str__", "school", "voucher_type", "date_bs", "needs_review"]
    list_filter = ["voucher_type", "needs_review"]
    list_select_related = ["school"]
    inlines = [VoucherLineInline]


@admin.register(LedgerAccount)
class LedgerAccountAdmin(admin.ModelAdmin):
    list_display = ["name", "school", "group"]
    list_filter = ["group"]
    search_fields = ["name", "school__name"]
    list_select_related = ["school", "group"]


admin.site.register([FiscalYear, LedgerGroup, OpeningBalance, VoucherSerialCounter])
