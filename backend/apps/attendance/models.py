"""
Attendance: manual class/staff attendance, also fed by RFID punches.

Legacy rules preserved (DOCUMENTATION.md §19 AT1–AT3) and hardened with the
DB constraints the legacy system lacked (443 duplicate class sessions exist
in production because get_or_create raced):
- one session per (school, class, BS day); one record per (session, student);
  one staff record per (staff, BS day).
"""

from django.db import models

from apps.academics.models import ClassInfo
from apps.core.models import BaseModel, TenantScopedModel
from apps.people.models import Staff, Student


class ClassAttendanceSession(TenantScopedModel):
    """One class's attendance register for one BS day."""

    date_bs = models.CharField(max_length=10, db_index=True)
    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="+")
    teacher = models.ForeignKey(
        Staff, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["school", "class_info", "date_bs"], name="uniq_class_session"
            ),
        ]

    def __str__(self):
        return f"{self.class_info} on {self.date_bs}"


class StudentAttendanceRecord(BaseModel):
    session = models.ForeignKey(
        ClassAttendanceSession, on_delete=models.CASCADE, related_name="records"
    )
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="attendance")
    present = models.BooleanField(default=False)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=50, blank=True, default="")

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["session", "student"], name="uniq_student_attd"),
        ]

    def __str__(self):
        return f"{self.student}: {'P' if self.present else 'A'} ({self.session.date_bs})"


class StaffAttendanceRecord(TenantScopedModel):
    date_bs = models.CharField(max_length=10, db_index=True)
    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name="attendance")
    present = models.BooleanField(default=False)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=50, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["staff", "date_bs"], name="uniq_staff_attd"),
        ]

    def __str__(self):
        return f"{self.staff}: {'P' if self.present else 'A'} ({self.date_bs})"
