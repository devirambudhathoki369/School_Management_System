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


class CertificateSerialCounter(models.Model):
    """Per (school, billing year) certificate numbering, serial text
    `{n}/{year name}` — the legacy shape (`45/EY 2082/083`), which resets the
    count when the economic year rolls over. Legacy computed max+1 at read
    time; here the row is locked FOR UPDATE inside the issue transaction
    (same fix as billing's ReceiptSerialCounter)."""

    id = models.BigAutoField(primary_key=True)
    school = models.ForeignKey("tenants.School", on_delete=models.CASCADE, related_name="+")
    billing_year = models.ForeignKey(
        "billing.BillingYear", on_delete=models.CASCADE, related_name="+"
    )
    last_serial = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["school", "billing_year"], name="uniq_certificate_serial_counter"
            ),
        ]

    def __str__(self):
        return f"{self.school} {self.billing_year}: {self.last_serial}"


class SeatOrdering(models.TextChoices):
    """How students are ordered within a class when seats are assigned."""

    ROLL = "roll", "Roll no"
    SYMBOL = "symbol", "Symbol no"
    NAME = "name", "Name (alphabetical)"
    REGD = "regd", "Registration no"


class SeatPlanRoom(TenantScopedModel):
    """One physical room in an exam's seat plan: a grid of benches × seats.

    The plan hangs off the exam so a result can be traced to where the
    student sat and the plan reprints verbatim (DOCUMENTATION.md §4.9, E3).
    """

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="seat_plan_rooms")
    name = models.CharField(max_length=50)
    benches = models.PositiveIntegerField(default=1)
    seats_per_bench = models.PositiveIntegerField(default=2)
    order_by = models.CharField(
        max_length=8, choices=SeatOrdering.choices, default=SeatOrdering.ROLL
    )
    note = models.CharField(max_length=200, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return f"{self.exam}: {self.name}"

    @property
    def capacity(self) -> int:
        return self.benches * self.seats_per_bench


class SeatPlanRoomClass(TenantScopedModel):
    """A class placed into a room, pinned to one bench column (side).

    Pinning a column to a single class is what enforces E3: neighbours on a
    bench always come from different classes.
    """

    room = models.ForeignKey(SeatPlanRoom, on_delete=models.CASCADE, related_name="room_classes")
    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="+")
    column = models.PositiveIntegerField(default=1)
    # Empty = use the room's ordering.
    order_by = models.CharField(
        max_length=8, choices=SeatOrdering.choices, blank=True, default=""
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Seat plan room classes"
        constraints = [
            models.UniqueConstraint(fields=["room", "column"], name="uniq_room_column"),
        ]

    def __str__(self):
        return f"{self.room}: column {self.column}"


class SeatAllocation(TenantScopedModel):
    """A student's saved seat; regenerating replaces the room's allocations."""

    room = models.ForeignKey(SeatPlanRoom, on_delete=models.CASCADE, related_name="allocations")
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="+")
    # Snapshot of the student's class at seating time (E3).
    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="+")
    bench_no = models.PositiveIntegerField()
    column = models.PositiveIntegerField()
    sequence = models.PositiveIntegerField()  # overall fill order within the room
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(fields=["room", "bench_no", "column"], name="uniq_room_seat"),
            models.UniqueConstraint(fields=["room", "student"], name="uniq_room_student"),
        ]

    def __str__(self):
        return f"{self.room}: bench {self.bench_no} seat {self.column}"
