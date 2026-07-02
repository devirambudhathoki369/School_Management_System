"""
Examinations: exams, schedules, grading, result sheets and marks.

Legacy rules preserved (DOCUMENTATION.md §19 E1–E2) and hardened:
- E1: student-facing results stay hidden until the sheet is published.
- Pass/fail and totals are computed SERVER-side (legacy trusted the client).
- Unique (exam, class, subject) sheet and (sheet, student) marks — the
  legacy system re-created rows on every save (446k duplicate mark rows in
  production); the ETL merges them with latest-entry-wins.
- Staff cannot modify a published sheet; only the school admin can.
"""

from django.db import models

from apps.academics.models import AcademicYear, ClassInfo, Subject
from apps.core.models import TenantScopedModel
from apps.people.models import Student


class Exam(TenantScopedModel):
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="exams")
    name = models.CharField(max_length=40)
    # Percentage of this exam carried into a final/aggregate exam (legacy `inclusion`)
    inclusion_weight = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    include_attendance = models.BooleanField(default=False)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return f"{self.name} ({self.academic_year.name})"


class ExamScheduleEntry(TenantScopedModel):
    """One subject sitting (legacy stored a {subject: date} JSON per class)."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="schedule_entries")
    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="+")
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT, related_name="+")
    exam_date_bs = models.CharField(max_length=10)
    start_time = models.CharField(max_length=10, blank=True, default="")
    end_time = models.CharField(max_length=10, blank=True, default="")

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Exam schedule entries"
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "class_info", "subject"], name="uniq_schedule_sitting"
            ),
        ]

    def __str__(self):
        return f"{self.exam}: {self.subject} on {self.exam_date_bs}"


class GradingScheme(TenantScopedModel):
    """Per-school marks->remarks/divisions bands (legacy GradingRules)."""

    class Type(models.TextChoices):
        NUMBER = "number", "Number system"
        GRADING = "grading", "Grading system"
        DIVISION = "division", "Division"

    type = models.CharField(max_length=10, choices=Type.choices)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["school", "type"], name="uniq_grading_scheme"),
        ]

    def __str__(self):
        return f"{self.school}: {self.get_type_display()}"


class GradeBand(TenantScopedModel):
    scheme = models.ForeignKey(GradingScheme, on_delete=models.CASCADE, related_name="bands")
    min_score = models.DecimalField(max_digits=5, decimal_places=2)
    max_score = models.DecimalField(max_digits=5, decimal_places=2)
    remarks = models.CharField(max_length=60)

    class Meta(TenantScopedModel.Meta):
        ordering = ["min_score"]

    def __str__(self):
        return f"{self.min_score}-{self.max_score}: {self.remarks}"


class SubjectResultSheet(TenantScopedModel):
    """
    Marks configuration + publication state for one (exam, class, subject)
    (legacy ClassResult; its `criteria` JSON becomes typed columns).
    """

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="sheets")
    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="+")
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT, related_name="result_sheets")
    full_marks = models.DecimalField(max_digits=6, decimal_places=2)
    pass_marks = models.DecimalField(max_digits=6, decimal_places=2)
    full_marks_theory = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    pass_marks_theory = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    full_marks_practical = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True
    )
    pass_marks_practical = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True
    )
    attendance_days = models.IntegerField(null=True, blank=True)  # total class days
    published_date_bs = models.CharField(max_length=10, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "class_info", "subject"], name="uniq_result_sheet"
            ),
        ]

    def __str__(self):
        return f"{self.exam} / {self.subject}"

    @property
    def is_published(self) -> bool:
        return bool(self.published_date_bs)


class StudentSubjectResult(TenantScopedModel):
    """One student's marks for one sheet. Totals/pass are server-computed."""

    sheet = models.ForeignKey(
        SubjectResultSheet, on_delete=models.CASCADE, related_name="results"
    )
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="results")
    theory = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    practical = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    total = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    # Carried-in portion from an included exam (legacy `inclusion`)
    inclusion = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    attendance_days = models.IntegerField(null=True, blank=True)  # days present
    passed = models.BooleanField(default=False)
    absent = models.BooleanField(default=False)
    position_in_section = models.IntegerField(null=True, blank=True)
    position_in_class = models.IntegerField(null=True, blank=True)
    legacy_id = models.BigIntegerField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["sheet", "student"], name="uniq_student_mark"),
        ]
        indexes = [models.Index(fields=["school", "student"])]

    def __str__(self):
        return f"{self.student}: {self.total} ({self.sheet})"


class ActivityDefinition(TenantScopedModel):
    """Extra-curricular activity vocabulary per school."""

    name = models.CharField(max_length=100)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class ActivityGrade(TenantScopedModel):
    """Graded co-curricular per student per exam (legacy JSON exploded)."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="activity_grades")
    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="+")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="activity_grades")
    activity = models.ForeignKey(ActivityDefinition, on_delete=models.PROTECT, related_name="+")
    grade = models.CharField(max_length=20)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "student", "activity"], name="uniq_activity_grade"
            ),
        ]


class CharacterCertificate(TenantScopedModel):
    """Serial-numbered certificate; `data` snapshots fields for stable reprints."""

    serial_no = models.CharField(max_length=40)
    student = models.ForeignKey(
        Student, null=True, blank=True, on_delete=models.SET_NULL, related_name="certificates"
    )
    data = models.JSONField()
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return f"CC {self.serial_no}"
