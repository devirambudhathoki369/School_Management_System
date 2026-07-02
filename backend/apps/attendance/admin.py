from django.contrib import admin

from .models import ClassAttendanceSession, StaffAttendanceRecord, StudentAttendanceRecord


@admin.register(ClassAttendanceSession)
class ClassAttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ["date_bs", "class_info", "school", "teacher"]
    search_fields = ["date_bs", "school__name"]
    list_select_related = ["class_info", "school", "teacher"]


@admin.register(StudentAttendanceRecord)
class StudentAttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ["student", "session", "present", "checked_in_at"]
    list_select_related = ["student", "session"]


@admin.register(StaffAttendanceRecord)
class StaffAttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ["staff", "date_bs", "present", "checked_in_at"]
    list_select_related = ["staff"]
