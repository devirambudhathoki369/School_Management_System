from django.contrib import admin

from .models import (
    ActivityDefinition,
    ActivityGrade,
    CharacterCertificate,
    Exam,
    ExamScheduleEntry,
    GradeBand,
    GradingScheme,
    StudentSubjectResult,
    SubjectResultSheet,
)


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ["name", "school", "academic_year", "include_attendance"]
    search_fields = ["name", "school__name"]
    list_select_related = ["school", "academic_year"]


@admin.register(SubjectResultSheet)
class SubjectResultSheetAdmin(admin.ModelAdmin):
    list_display = ["exam", "class_info", "subject", "full_marks", "published_date_bs"]
    search_fields = ["exam__name", "subject__name"]
    list_select_related = ["exam", "class_info", "subject"]


@admin.register(StudentSubjectResult)
class StudentSubjectResultAdmin(admin.ModelAdmin):
    list_display = ["student", "sheet", "total", "passed", "absent"]
    list_select_related = ["student", "sheet"]
    search_fields = ["student__first_name", "student__last_name"]


admin.site.register(
    [ExamScheduleEntry, GradingScheme, GradeBand, ActivityDefinition,
     ActivityGrade, CharacterCertificate]
)
