"""
Seat plan arrangement — exact port of the legacy generator (invariant E3).

Each bench column is pinned to one class, so neighbours on a bench come from
different classes (anti-cheating). Students are dealt from a SINGLE shared
queue per class consumed across rooms in room order, so a class pinned in
several rooms overflows from one room into the next instead of being seated
twice or dropped. Regenerating replaces every allocation for the given rooms
(idempotent); anyone still queued when every room is full is reported as
unseated.
"""

import random

from django.db import transaction

from apps.people.models import Student

from ..models import SeatAllocation, SeatOrdering, SeatPlanRoom, SubjectResultSheet


def eligible_class_ids(exam) -> list[str]:
    """Classes a seat plan may offer for this exam: every class of the SAME
    education level(s) the exam actually touches (via its schedule and result
    sheets), in the exam's academic year. Empty when nothing ties the exam to
    a class yet — the caller then falls back to all classes."""
    touched = set(
        exam.schedule_entries.values_list("class_info", flat=True)
    ) | set(
        SubjectResultSheet.objects.filter(exam=exam).values_list("class_info", flat=True)
    )
    if not touched:
        return []
    from apps.academics.models import ClassInfo

    levels = (
        ClassInfo.objects.filter(id__in=touched)
        .values_list("education_level", flat=True)
        .distinct()
    )
    return [
        str(pk)
        for pk in ClassInfo.objects.filter(
            school=exam.school,
            academic_year=exam.academic_year,
            education_level__in=list(levels),
        ).values_list("id", flat=True)
    ]


def _numeric(value):
    """Sort key that treats numeric strings numerically (roll '10' after '2')."""
    try:
        return (0, int(str(value)), "")
    except (TypeError, ValueError):
        return (1, 0, str(value or "").lower())


def _class_students(class_info_id, order_by: str) -> list[dict]:
    rows = list(
        Student.objects.filter(
            class_info_id=class_info_id, status=Student.Status.RUNNING
        ).values("id", "first_name", "middle_name", "last_name", "roll_no", "symbol_no", "regd_no")
    )
    if order_by == SeatOrdering.SYMBOL:
        return sorted(rows, key=lambda s: _numeric(s["symbol_no"]))
    if order_by == SeatOrdering.REGD:
        return sorted(rows, key=lambda s: _numeric(s["regd_no"]))
    if order_by == SeatOrdering.NAME:
        return sorted(
            rows,
            key=lambda s: " ".join(
                p for p in (s["first_name"], s["middle_name"], s["last_name"]) if p
            ).lower(),
        )
    return sorted(rows, key=lambda s: _numeric(s["roll_no"]))


def generate(rooms, shuffle: bool = False) -> tuple[dict, int]:
    """Allocate students across the given rooms (in order). Returns
    (per_room_seated: {room_id: count}, unseated)."""
    rooms = list(rooms)
    queues: dict = {}  # class_info_id -> remaining students, shared across rooms

    def queue_for(class_info_id, order_by):
        if class_info_id not in queues:
            students = _class_students(class_info_id, order_by)
            if shuffle:
                random.shuffle(students)
            queues[class_info_id] = students
        return queues[class_info_id]

    per_room_seated = {}
    with transaction.atomic():
        SeatAllocation.objects.filter(room__in=rooms).delete()
        for room in rooms:
            col_class = {
                rc.column: (rc.class_info_id, rc.order_by or room.order_by)
                for rc in room.room_classes.order_by("column")
            }
            allocations = []
            seq = 0
            for bench in range(1, room.benches + 1):
                for col in range(1, room.seats_per_bench + 1):
                    pinned = col_class.get(col)
                    if not pinned:
                        continue
                    class_info_id, order_by = pinned
                    queue = queue_for(class_info_id, order_by)
                    if not queue:
                        continue
                    student = queue.pop(0)
                    seq += 1
                    allocations.append(
                        SeatAllocation(
                            school_id=room.school_id,
                            room=room,
                            student_id=student["id"],
                            class_info_id=class_info_id,
                            bench_no=bench,
                            column=col,
                            sequence=seq,
                        )
                    )
            SeatAllocation.objects.bulk_create(allocations)
            per_room_seated[room.id] = len(allocations)
    unseated = sum(len(q) for q in queues.values())
    return per_room_seated, unseated


def hard_delete_room(room: SeatPlanRoom):
    """Rooms are working documents, not financial records: deleting one
    removes its classes and allocations outright (legacy cascade)."""
    SeatPlanRoom.all_objects.filter(pk=room.pk).delete()
