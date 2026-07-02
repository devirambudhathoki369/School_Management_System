from django.contrib import admin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ["at", "actor", "school", "action", "object_table", "object_id"]
    list_filter = ["action"]
    search_fields = ["object_table", "object_id"]
    date_hierarchy = "at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
