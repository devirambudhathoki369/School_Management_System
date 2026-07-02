from django.contrib import admin

from .models import AcademicYear, ClassInfo, Course, CurrentYearPointer, Section, Subject


@admin.register(AcademicYear)
class AcademicYearAdmin(admin.ModelAdmin):
    list_display = ["name", "school", "start_date_bs", "end_date_bs", "closed"]
    list_filter = ["closed"]
    search_fields = ["name", "school__name"]


@admin.register(ClassInfo)
class ClassInfoAdmin(admin.ModelAdmin):
    list_display = ["__str__", "school", "education_level", "grade", "academic_year"]
    list_filter = ["education_level", "grade"]
    search_fields = ["school__name", "display_name"]


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "type", "class_info", "school", "is_protected"]
    list_filter = ["type", "is_protected"]
    search_fields = ["name", "code"]


admin.site.register([CurrentYearPointer, Course, Section])
