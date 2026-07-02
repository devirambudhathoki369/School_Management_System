from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Account


@admin.register(Account)
class AccountAdmin(UserAdmin):
    ordering = ["role", "username"]
    list_display = ["username", "role", "verified", "is_active", "last_login"]
    list_filter = ["role", "verified", "is_active"]
    search_fields = ["username", "email"]
    fieldsets = (
        (None, {"fields": ("username", "role", "password")}),
        ("Status", {"fields": ("email", "verified", "is_active")}),
        ("Django admin", {"fields": ("is_staff", "is_superuser")}),
        ("Provenance", {"fields": ("legacy_table", "legacy_id")}),
        ("Dates", {"fields": ("last_login",)}),
    )
    add_fieldsets = (
        (None, {"fields": ("username", "role", "password1", "password2")}),
    )
    readonly_fields = ["last_login", "legacy_table", "legacy_id"]
    filter_horizontal = ()
