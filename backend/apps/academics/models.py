"""
Academic structure: years, classes, subjects.

Legacy invariants enforced here (DOCUMENTATION.md §19):
- A1: a ClassInfo is unique on its full tuple within a school (DB constraint,
  NULLS NOT DISTINCT so optional dimensions can't create duplicates).
- A2: "current academic year" is only ever resolved through
  CurrentYearPointer (per faculty key) — never a global flag.
- S1/S2: subjects in use, or explicitly protected, cannot be deleted.

Dates are Bikram Sambat strings (the operational calendar), suffixed `_bs`.
"""

from django.db import models

from apps.core.models import TenantScopedModel


class EducationLevel(models.TextChoices):
    MONTESSORI = "montessori", "Montessori"
    SCHOOL = "school", "School"
    SCHOOL_GOVT = "school_govt", "School (GOVT.)"
    PRE_DIPLOMA = "pre_diploma", "Pre-diploma"
    DIPLOMA = "diploma", "Diploma"
    HIGHSCHOOL = "highschool", "High school"
    BACHELOR = "bachelor", "Bachelor"
    MASTER = "master", "Master"


class Grade(models.TextChoices):
    PLAY_GROUP = "play_group", "Play group"
    NURSERY = "nursery", "Nursery"
    LKG = "lkg", "LKG"
    UKG = "ukg", "UKG"
    ONE = "one", "One"
    TWO = "two", "Two"
    THREE = "three", "Three"
    FOUR = "four", "Four"
    FIVE = "five", "Five"
    SIX = "six", "Six"
    SEVEN = "seven", "Seven"
    EIGHT = "eight", "Eight"
    NINE = "nine", "Nine"
    TEN = "ten", "Ten"
    ELEVEN = "eleven", "Eleven"
    TWELVE = "twelve", "Twelve"


class Faculty(models.TextChoices):
    SCIENCE = "science", "Science"
    MANAGEMENT = "management", "Management"
    EDUCATION = "education", "Education"
    ARTS = "arts", "Arts"
    HUMANITIES = "humanities", "Humanities"
    LAW = "law", "Law"


class AcademicYear(TenantScopedModel):
    name = models.CharField(max_length=20)
    start_date_bs = models.CharField(max_length=10)
    end_date_bs = models.CharField(max_length=10)
    closed = models.BooleanField(default=False)
    remarks = models.CharField(max_length=100, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    # No unique (school, name): 7 schools in production legitimately reuse a
    # year name across faculty groups (staggered years, invariant A2).

    def __str__(self):
        return f"{self.name} ({self.school})"


class CurrentYearPointer(TenantScopedModel):
    """
    Source of truth for "the running academic year" per faculty group (A2).
    Different keys may run different years simultaneously (staggered roll-over).
    """

    key = models.CharField(max_length=10)
    academic_year = models.ForeignKey(
        AcademicYear, on_delete=models.PROTECT, related_name="current_pointers"
    )
    previous_academic_year = models.ForeignKey(
        AcademicYear, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["school", "key"], name="uniq_year_pointer_key"),
        ]

    def __str__(self):
        return f"{self.school}: {self.key} -> {self.academic_year.name}"


class Course(TenantScopedModel):
    name = models.CharField(max_length=50)
    education_level = models.CharField(max_length=20, choices=EducationLevel.choices)
    # Program length — a course runs EITHER semester-wise (BCA: 8 semesters)
    # OR year-wise (diploma Forestry/Pharmacy: 3 years). At most one is set;
    # promotion and batch tooling read it to know the final term.
    total_years = models.PositiveSmallIntegerField(null=True, blank=True)
    total_semesters = models.PositiveSmallIntegerField(null=True, blank=True)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class Batch(TenantScopedModel):
    """A cohort/intake for higher-education programs (bachelor / master /
    diploma / pre-diploma).

    The batch is a student's IMMUTABLE identity for life — the semester or
    year they are in is just a counter that advances on promotion. Stamping
    classes with a batch lets two intakes sit in the same course+semester at
    once (2078 and 2079 both in BCA sem-1 during an overlap) without
    collapsing onto one ClassInfo row. Purely additive: un-batched (school)
    data never references it."""

    course = models.ForeignKey(
        Course, null=True, blank=True, on_delete=models.PROTECT, related_name="batches"
    )
    # Admission year in Bikram Sambat ("2079") — the cohort's stable name.
    year = models.CharField(max_length=9)
    start_academic_year = models.ForeignKey(
        AcademicYear, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    # Convenience pointer to the cohort's current term; the authoritative
    # per-term rows are the ClassInfo rows the batch has passed through.
    # Exactly one of these carries the term (semester-wise vs year-wise).
    current_semester = models.PositiveSmallIntegerField(null=True, blank=True)
    current_year = models.PositiveSmallIntegerField(null=True, blank=True)
    # Set once the cohort finishes its final term; history stays intact.
    graduated = models.BooleanField(default=False)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Batches"
        constraints = [
            models.UniqueConstraint(
                fields=["school", "course", "year"],
                nulls_distinct=False,
                name="uniq_batch_intake",
            ),
        ]

    def __str__(self):
        return f"Batch {self.year} — {self.course.name if self.course_id else '?'}"


class Section(TenantScopedModel):
    name = models.CharField(max_length=25)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class ClassInfo(TenantScopedModel):
    """The unique class tuple a student belongs to (A1)."""

    education_level = models.CharField(max_length=20, choices=EducationLevel.choices)
    grade = models.CharField(max_length=12, choices=Grade.choices, blank=True, default="")
    faculty = models.CharField(max_length=12, choices=Faculty.choices, blank=True, default="")
    course = models.ForeignKey(Course, null=True, blank=True, on_delete=models.PROTECT)
    section = models.ForeignKey(Section, null=True, blank=True, on_delete=models.PROTECT)
    year = models.PositiveSmallIntegerField(null=True, blank=True)      # 1-4
    semester = models.PositiveSmallIntegerField(null=True, blank=True)  # 1-10
    # Cohort dimension: lets the same course+term exist once per intake.
    # NULL for school-level classes and pre-batch program rows.
    batch = models.ForeignKey(
        Batch, null=True, blank=True, on_delete=models.PROTECT, related_name="classes"
    )
    display_name = models.CharField(max_length=100, blank=True, default="")
    academic_year = models.ForeignKey(
        AcademicYear, null=True, blank=True, on_delete=models.PROTECT, related_name="classes"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Class infos"
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "school", "education_level", "grade", "faculty",
                    "course", "section", "year", "semester", "academic_year",
                    "batch",
                ],
                nulls_distinct=False,
                name="uniq_class_tuple",
            ),
        ]

    def __str__(self):
        parts = [self.get_grade_display() or self.get_education_level_display()]
        if self.faculty:
            parts.append(self.get_faculty_display())
        if self.section_id:
            parts.append(str(self.section))
        return " · ".join(parts)


class Subject(TenantScopedModel):
    """
    A subject taught to a class. "Partitioned" subjects (S3) keep the theory
    part in the base fields and the practical part in the *_practical fields.
    """

    class Type(models.TextChoices):
        COMPULSORY = "compulsory", "Compulsory"
        OPTIONAL = "optional", "Optional"

    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="subjects")
    name = models.CharField(max_length=50)
    code = models.CharField(max_length=10, blank=True, default="")
    type = models.CharField(max_length=10, choices=Type.choices, default=Type.COMPULSORY)
    credit_hours = models.DecimalField(max_digits=4, decimal_places=2)
    order = models.SmallIntegerField(default=0)  # legacy uses -1 as "unordered"
    name_practical = models.CharField(max_length=50, blank=True, default="")
    code_practical = models.CharField(max_length=10, blank=True, default="")
    credit_hours_practical = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True
    )
    is_protected = models.BooleanField(default=False)  # hard delete-lock (S2)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["order", "name"]

    def __str__(self):
        return f"{self.name} ({self.class_info})"

    @property
    def has_practical(self) -> bool:
        return bool(self.name_practical)

    def is_referenced(self) -> bool:
        """S1: a subject used anywhere can never be deleted. Each module that
        references Subject registers its check here as it lands."""
        from apps.people.models import Staff

        return Staff.all_objects.filter(
            models.Q(primary_subject=self) | models.Q(secondary_subject=self)
        ).exists()
