"""
Punch -> attendance derivation (exact port of the legacy AttendanceTransfer).

Rules AT1–AT3:
- AT1: ANY punch in a BS day means the person was physically present — but a
  school with `time_set_required` and an in-time treats a first punch AFTER
  the in-time as late -> NOT auto-present.
- AT2: check-in = earliest punch; check-out = last punch at/after the
  school's out-time when one is set, otherwise the last punch when it is at
  least 1 hour after check-in (a double-tap on the way in is not a leave).
- Recomputing from ALL stored punches makes ingestion idempotent and
  order-independent across device push batches.

Newly-present students are announced via the `students_checked_in` signal;
the communication module subscribes to it for parent push.
"""

from collections import defaultdict
from datetime import timedelta

import django.dispatch
from django.db.models import Max, Min
from django.utils import timezone

from apps.attendance.models import (
    ClassAttendanceSession,
    StaffAttendanceRecord,
    StudentAttendanceRecord,
)
from apps.core.dates import NEPAL_TZ, bs_day_utc_range, today_bs
from apps.people.models import Staff, Student
from apps.tenants.models import SchoolSettings

CHECKOUT_MIN_GAP = timedelta(hours=1)

students_checked_in = django.dispatch.Signal()  # kwargs: school_id, student_ids


def derive_in_out(first, last, in_time, out_time):
    """(first, last) punch -> (present, check_in, check_out)."""
    if not first:
        return False, None, None
    if in_time is not None and first.astimezone(NEPAL_TZ).time() > in_time:
        return False, None, None  # late -> not auto-present (AT3)
    check_out = None
    if last:
        if out_time is not None:
            if last.astimezone(NEPAL_TZ).time() >= out_time:
                check_out = last
        elif (last - first) >= CHECKOUT_MIN_GAP:
            check_out = last
    return True, first, check_out


def process_punches(device, device_user_ids, date_bs: str | None = None) -> None:
    """Recompute attendance for everyone who punched, from stored punch logs."""
    from apps.devices.models import DeviceUser, PunchLog

    device_user_ids = set(device_user_ids)
    if not device_user_ids:
        return
    school_id = device.school_id
    date_bs = date_bs or today_bs()

    settings_row = (
        SchoolSettings.objects.filter(school_id=school_id)
        .values("time_set_required", "attendance_in_time", "attendance_out_time")
        .first()
        or {}
    )
    time_set = bool(settings_row.get("time_set_required"))
    in_time = settings_row.get("attendance_in_time") if time_set else None
    out_time = settings_row.get("attendance_out_time") if time_set else None

    start, end = bs_day_utc_range(date_bs)
    spans = {
        row["user_id"]: (row["first"], row["last"])
        for row in PunchLog.objects.filter(
            user_id__in=device_user_ids, punch_time__gte=start, punch_time__lt=end
        )
        .values("user_id")
        .annotate(first=Min("punch_time"), last=Max("punch_time"))
    }

    users = DeviceUser.objects.filter(id__in=device_user_ids).select_related(
        "student", "staff"
    )
    student_punchers, staff_present, student_present = [], {}, {}
    for user in users:
        span = spans.get(user.id)
        if not span:
            continue
        present, check_in, check_out = derive_in_out(span[0], span[1], in_time, out_time)
        if user.student_id:
            student_punchers.append(user)
            if present:
                student_present[user.student_id] = (check_in, check_out)
        elif user.staff_id:
            if present:
                staff_present[user.staff_id] = (check_in, check_out)

    if student_punchers:
        _save_student_attendance(date_bs, school_id, student_punchers, student_present)
    if staff_present:
        _save_staff_attendance(date_bs, school_id, staff_present)


def _save_student_attendance(date_bs, school_id, punchers, present_times):
    """Per class: create the full register on first punch of the day (absent
    rows included), then flip/re-stamp present students on later batches."""
    class_groups = defaultdict(list)
    for user in punchers:
        class_groups[user.student.class_info_id].append(user)
    newly_present: list = []

    for class_id in class_groups:
        session, created = ClassAttendanceSession.objects.get_or_create(
            school_id=school_id, class_info_id=class_id, date_bs=date_bs
        )
        if created:
            rows = []
            for student in Student.objects.filter(
                class_info_id=class_id, status=Student.Status.RUNNING
            ):
                check_in, check_out = present_times.get(student.id, (None, None))
                present = student.id in present_times
                if present:
                    newly_present.append(student.id)
                rows.append(StudentAttendanceRecord(
                    session=session, student=student, present=present,
                    checked_in_at=check_in, checked_out_at=check_out,
                ))
            StudentAttendanceRecord.objects.bulk_create(rows)
        else:
            rows = list(StudentAttendanceRecord.objects.filter(
                session=session, student_id__in=present_times,
                student__status=Student.Status.RUNNING,
            ))
            now = timezone.now()
            for row in rows:
                if not row.present:
                    newly_present.append(row.student_id)
                row.checked_in_at, row.checked_out_at = present_times[row.student_id]
                row.present = True
                row.updated_at = now
            StudentAttendanceRecord.objects.bulk_update(
                rows, ["present", "checked_in_at", "checked_out_at", "updated_at"]
            )

    if newly_present:
        students_checked_in.send(
            sender=None, school_id=school_id, student_ids=newly_present
        )


def _save_staff_attendance(date_bs, school_id, present_times):
    exists = StaffAttendanceRecord.objects.filter(
        school_id=school_id, date_bs=date_bs
    ).exists()
    if exists:
        rows = list(StaffAttendanceRecord.objects.filter(
            school_id=school_id, date_bs=date_bs, staff_id__in=present_times,
            staff__status=Staff.Status.EMPLOYED,
        ))
        now = timezone.now()
        for row in rows:
            row.checked_in_at, row.checked_out_at = present_times[row.staff_id]
            row.present = True
            row.updated_at = now
        StaffAttendanceRecord.objects.bulk_update(
            rows, ["present", "checked_in_at", "checked_out_at", "updated_at"]
        )
    else:
        rows = []
        for staff in Staff.objects.filter(
            school_id=school_id, status=Staff.Status.EMPLOYED
        ):
            check_in, check_out = present_times.get(staff.id, (None, None))
            rows.append(StaffAttendanceRecord(
                school_id=school_id, date_bs=date_bs, staff=staff,
                present=staff.id in present_times,
                checked_in_at=check_in, checked_out_at=check_out,
            ))
        StaffAttendanceRecord.objects.bulk_create(rows)
