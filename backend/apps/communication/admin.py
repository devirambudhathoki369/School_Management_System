from django.contrib import admin

from .models import CalendarEvent, DeliveryLog, MessageTemplate, NewsImage, NewsPost, Notice


@admin.register(DeliveryLog)
class DeliveryLogAdmin(admin.ModelAdmin):
    list_display = ["title", "school", "recipient", "status", "sent_at"]
    list_filter = ["status"]
    list_select_related = ["school", "recipient"]


admin.site.register([Notice, NewsPost, NewsImage, CalendarEvent, MessageTemplate])
