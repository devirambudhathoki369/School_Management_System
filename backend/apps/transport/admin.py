from django.contrib import admin

from .models import BusStation, ProximityAlert, RiderSubscription


@admin.register(BusStation)
class BusStationAdmin(admin.ModelAdmin):
    list_display = ["name", "school", "fee"]
    search_fields = ["name", "school__name"]
    list_select_related = ["school"]


admin.site.register([RiderSubscription, ProximityAlert])
