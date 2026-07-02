from django.contrib import admin

from .models import Device, DeviceCommand, DeviceUser, PunchLog


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ["serial_number", "alias", "school", "state", "last_seen"]
    list_filter = ["state"]
    search_fields = ["serial_number", "alias", "school__name"]
    list_select_related = ["school"]


@admin.register(DeviceCommand)
class DeviceCommandAdmin(admin.ModelAdmin):
    list_display = ["cmd_id", "device", "status", "created_at", "finished_at"]
    list_filter = ["status"]
    list_select_related = ["device"]


@admin.register(DeviceUser)
class DeviceUserAdmin(admin.ModelAdmin):
    list_display = ["pin", "card", "device", "student", "staff"]
    search_fields = ["pin", "card"]
    list_select_related = ["device", "student", "staff"]


@admin.register(PunchLog)
class PunchLogAdmin(admin.ModelAdmin):
    list_display = ["user", "punch_time", "status", "verify", "received_at"]
    date_hierarchy = "punch_time"
    list_select_related = ["user"]
