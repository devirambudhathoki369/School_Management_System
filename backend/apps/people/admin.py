from django.contrib import admin

from .models import Guardian, Staff, StaffRole, Student, StudentGuardian


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ["full_name", "school", "class_info", "status", "roll_no"]
    list_filter = ["status", "gender"]
    search_fields = ["first_name", "last_name", "roll_no", "school__name"]
    list_select_related = ["school", "class_info"]


@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ["full_name", "school", "role", "status"]
    list_filter = ["status"]
    search_fields = ["first_name", "last_name", "school__name"]
    list_select_related = ["school", "role"]


admin.site.register([Guardian, StudentGuardian, StaffRole])
