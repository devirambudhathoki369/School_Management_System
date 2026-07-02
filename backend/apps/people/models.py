"""
People: students, guardians and staff.

Modernisations over the legacy schema (LEGACY_DATA_MAP.md §4.4):
- Guardians are first-class people linked to students with a relation,
  enabling the Parent role (one guardian <-> many children).
- The legacy 1:1 "other info" satellites are merged in as nullable columns.
- Accounts link from the profile side and stay optional (invariant I2).
"""

from django.db import models

from apps.academics.models import AcademicYear, ClassInfo, Subject
from apps.core.models import BaseModel, TenantScopedModel


class Gender(models.TextChoices):
    MALE = "male", "Male"
    FEMALE = "female", "Female"
    OTHERS = "others", "Others"


class Guardian(TenantScopedModel):
    name = models.CharField(max_length=60)
    contact = models.CharField(max_length=15, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.CharField(max_length=100, blank=True, default="")
    occupation = models.CharField(max_length=40, blank=True, default="")
    account = models.OneToOneField(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="guardian_profile",
    )

    def __str__(self):
        return self.name


class Student(TenantScopedModel):
    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        PASSED_OUT = "passed_out", "Passed out"
        DROPPED_OUT = "dropped_out", "Dropped out"

    first_name = models.CharField(max_length=30)
    middle_name = models.CharField(max_length=30, blank=True, default="")
    last_name = models.CharField(max_length=30)
    birth_date_bs = models.CharField(max_length=10, blank=True, default="")
    gender = models.CharField(max_length=8, choices=Gender.choices)
    email = models.EmailField(blank=True, default="")
    contact = models.CharField(max_length=15, blank=True, default="")
    address = models.CharField(max_length=100, blank=True, default="")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.RUNNING)

    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="students")
    academic_year = models.ForeignKey(
        AcademicYear, on_delete=models.PROTECT, related_name="students"
    )

    roll_no = models.CharField(max_length=15, blank=True, default="")
    symbol_no = models.CharField(max_length=15, blank=True, default="")
    regd_no = models.CharField(max_length=15, blank=True, default="")
    emis = models.CharField(max_length=50, blank=True, default="")
    rfid_card = models.CharField(max_length=32, blank=True, default="")

    previous_school = models.CharField(max_length=100, blank=True, default="")
    remarks = models.CharField(max_length=100, blank=True, default="")

    # Merged legacy StudentOtherInfo satellite
    ethnicity = models.CharField(max_length=30, blank=True, default="")
    blood_group = models.CharField(max_length=5, blank=True, default="")

    account = models.OneToOneField(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="student_profile",
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [
            models.Index(fields=["school", "status"]),
            models.Index(fields=["school", "class_info"]),
        ]

    def __str__(self):
        return self.full_name

    @property
    def full_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.middle_name, self.last_name) if p)


class StudentGuardian(BaseModel):
    """Links a student to a guardian with the relationship kind."""

    class Relation(models.TextChoices):
        FATHER = "father", "Father"
        MOTHER = "mother", "Mother"
        GUARDIAN = "guardian", "Guardian"
        OTHER = "other", "Other"

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="guardian_links")
    guardian = models.ForeignKey(Guardian, on_delete=models.CASCADE, related_name="student_links")
    relation = models.CharField(max_length=10, choices=Relation.choices)
    is_primary_contact = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["student", "guardian", "relation"], name="uniq_student_guardian"
            ),
        ]

    def __str__(self):
        return f"{self.guardian} ({self.relation} of {self.student})"


class StaffRole(BaseModel):
    """Job title vocabulary (teacher, accountant, librarian…). Global, like legacy."""

    name = models.CharField(max_length=30, unique=True)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class Staff(TenantScopedModel):
    class Status(models.TextChoices):
        EMPLOYED = "employed", "Employed"
        DEPARTED = "departed", "Departed"
        RETIRED = "retired", "Retired"
        ON_LEAVE = "on_leave", "On leave"

    role = models.ForeignKey(StaffRole, on_delete=models.PROTECT, related_name="staff")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.EMPLOYED)
    first_name = models.CharField(max_length=30)
    middle_name = models.CharField(max_length=30, blank=True, default="")
    last_name = models.CharField(max_length=30)
    gender = models.CharField(max_length=8, choices=Gender.choices, blank=True, default="")
    birth_date_bs = models.CharField(max_length=10, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    primary_contact = models.CharField(max_length=15)
    secondary_contact = models.CharField(max_length=15, blank=True, default="")
    address = models.CharField(max_length=100, blank=True, default="")
    qualification = models.CharField(max_length=100, blank=True, default="")
    joined_date_bs = models.CharField(max_length=10, blank=True, default="")
    rfid_card = models.CharField(max_length=32, blank=True, default="")

    primary_subject = models.ForeignKey(
        Subject, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    secondary_subject = models.ForeignKey(
        Subject, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )

    # Module permission codes checked server-side (successor of the legacy
    # UI-only permissions JSON). Evolves into full RBAC tables.
    permissions = models.JSONField(default=list, blank=True)

    account = models.OneToOneField(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="staff_profile",
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Staff"
        indexes = [models.Index(fields=["school", "status"])]

    def __str__(self):
        return self.full_name

    @property
    def full_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.middle_name, self.last_name) if p)
