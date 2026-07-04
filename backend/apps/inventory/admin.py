from django.contrib import admin

from .models import Category, Item, StockTransaction


@admin.register(StockTransaction)
class StockTransactionAdmin(admin.ModelAdmin):
    list_display = ["item", "school", "txn_type", "quantity", "date_bs"]
    list_filter = ["txn_type"]
    list_select_related = ["item", "school"]


admin.site.register([Category, Item])
