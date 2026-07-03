from django.contrib import admin

from .models import (
    PayrollSerialCounter,
    SalaryAccrual,
    SalaryAccrualLine,
    SalaryPayment,
    SalaryPaymentLine,
    SalaryStructure,
)


class SalaryAccrualLineInline(admin.TabularInline):
    model = SalaryAccrualLine
    extra = 0


class SalaryPaymentLineInline(admin.TabularInline):
    model = SalaryPaymentLine
    extra = 0


@admin.register(SalaryAccrual)
class SalaryAccrualAdmin(admin.ModelAdmin):
    list_display = ["staff", "school", "date_bs", "months", "total"]
    search_fields = ["staff__first_name", "staff__last_name"]
    list_select_related = ["staff", "school"]
    inlines = [SalaryAccrualLineInline]


@admin.register(SalaryPayment)
class SalaryPaymentAdmin(admin.ModelAdmin):
    list_display = ["__str__", "school", "staff", "date_bs", "gross", "net_paid", "mode"]
    list_filter = ["mode"]
    search_fields = ["staff__first_name", "staff__last_name"]
    list_select_related = ["school", "staff"]
    inlines = [SalaryPaymentLineInline]


@admin.register(SalaryStructure)
class SalaryStructureAdmin(admin.ModelAdmin):
    list_display = ["staff", "school", "basic_salary", "grade", "allowance", "extra"]
    search_fields = ["staff__first_name", "staff__last_name"]
    list_select_related = ["staff", "school"]


admin.site.register(PayrollSerialCounter)
