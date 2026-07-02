from django.contrib import admin

from .models import Foundation, School, SchoolBranding, SchoolSettings, Shareholder


class SchoolSettingsInline(admin.StackedInline):
    model = SchoolSettings
    extra = 0


class SchoolBrandingInline(admin.StackedInline):
    model = SchoolBranding
    extra = 0


@admin.register(School)
class SchoolAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "status", "is_test", "created_at"]
    list_filter = ["status", "is_test"]
    search_fields = ["name", "slug", "pan_no"]
    prepopulated_fields = {"slug": ["name"]}
    inlines = [SchoolSettingsInline, SchoolBrandingInline]


@admin.register(Foundation)
class FoundationAdmin(admin.ModelAdmin):
    list_display = ["name", "ceo", "contact"]


admin.site.register(Shareholder)
