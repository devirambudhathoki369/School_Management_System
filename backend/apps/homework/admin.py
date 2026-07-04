from django.contrib import admin

from .models import Homework, HomeworkAttachment, Submission


class HomeworkAttachmentInline(admin.TabularInline):
    model = HomeworkAttachment
    extra = 0


@admin.register(Homework)
class HomeworkAdmin(admin.ModelAdmin):
    list_display = ["title", "school", "class_info", "subject", "due_date_bs"]
    search_fields = ["title", "school__name"]
    list_select_related = ["school", "class_info", "subject"]
    inlines = [HomeworkAttachmentInline]


admin.site.register(Submission)
