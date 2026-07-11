"""Homework with file attachments and student submissions (legacy
main_homework/homeworkfile/homeworksubmission; submissions are schema-only —
zero production rows). Imported attachments keep their legacy relative media
path in the FileField; the media rsync preserves paths."""

from django.db import models

from apps.academics.models import ClassInfo, Subject
from apps.core.models import BaseModel, TenantScopedModel
from apps.people.models import Staff, Student


class Homework(TenantScopedModel):
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    due_date_bs = models.CharField(max_length=10)
    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="+")
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT, related_name="+")
    staff = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="+")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [models.Index(fields=["school", "class_info", "due_date_bs"])]

    def __str__(self):
        return self.title


def homework_file_path(instance, filename):
    from apps.core.uploads import stored_name

    return stored_name(instance.homework.school_id, "homework", filename.rsplit(".", 1)[-1])


def submission_file_path(instance, filename):
    from apps.core.uploads import stored_name

    return stored_name(instance.submission.school_id, "homework", filename.rsplit(".", 1)[-1])


class HomeworkAttachment(BaseModel):
    homework = models.ForeignKey(Homework, on_delete=models.CASCADE, related_name="attachments")
    # New uploads land in the per-school layout; imported rows keep
    # their legacy paths (upload_to only affects fresh saves).
    file = models.FileField(upload_to=homework_file_path)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.file.name


class Submission(TenantScopedModel):
    class Status(models.TextChoices):
        RECEIVED = "received", "Received"
        CHECKED = "checked", "Checked"

    homework = models.ForeignKey(Homework, on_delete=models.CASCADE, related_name="submissions")
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="+")
    submitted_date_bs = models.CharField(max_length=10)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RECEIVED)
    remarks = models.TextField(blank=True, default="")

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["homework", "student"], name="uniq_submission"),
        ]

    def __str__(self):
        return f"{self.student} -> {self.homework}"


class SubmissionAttachment(BaseModel):
    submission = models.ForeignKey(
        Submission, on_delete=models.CASCADE, related_name="attachments"
    )
    file = models.FileField(upload_to=submission_file_path)

    def __str__(self):
        return self.file.name
