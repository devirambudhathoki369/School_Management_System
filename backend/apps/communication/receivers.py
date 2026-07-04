"""Attendance -> parent notification bridge.

The attendance punch engine fires `students_checked_in` when RFID punches
newly mark students present (AT1). Each event becomes a QUEUED DeliveryLog
row per student account; the push provider (parent-app phase, §18.1/18.14)
consumes the queue and stamps sent/failed."""

from django.dispatch import receiver

from apps.attendance.services import students_checked_in
from apps.people.models import Student

from .models import DeliveryLog


@receiver(students_checked_in, dispatch_uid="communication.checkin_push")
def queue_checkin_notifications(sender, school_id, student_ids, **kwargs):
    students = Student.objects.filter(
        id__in=student_ids, school_id=school_id, account__isnull=False
    ).only("id", "first_name", "account_id")
    DeliveryLog.objects.bulk_create(
        DeliveryLog(
            school_id=school_id,
            recipient_id=student.account_id,
            title="Checked in",
            body=f"{student.first_name} arrived at school.",
            data={"kind": "attendance.check_in", "student": str(student.id)},
        )
        for student in students
    )
