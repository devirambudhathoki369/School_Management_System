"""
Program-level (higher-ed) cohort promotion — the batch-aware year-end step.

Exact port of legacy promote_program_level: move every running cohort of a
semester/year-wise program up one level, section-preserving, and advance each
Batch's current position. Run AFTER the academic-year roll, never before:
once every level sits on ONE academic year, year N → N+1 is a SAME-year move,
so no dues carry-forward happens and nothing double-counts. This service
therefore never touches ledgers or invoices — only Student.class_info and the
Batch counters.

Guards kept from legacy:
- source and target levels must resolve to the same academic year (the roll
  must have happened first) — hard abort otherwise;
- section-preserving: (level N, section S) → (level N+1, section S); a student
  whose section has no counterpart at the next level is SKIPPED and reported,
  never dumped into another stream;
- the terminal level is not promoted — that cohort graduates via passing-out;
- highest source level promotes first so nobody moves twice.

Dry-run by default; apply=True commits in one transaction. The returned plan
is the audit trail (legacy wrote a JSON snapshot file for its CLI revert).
"""

from collections import defaultdict

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.people.models import Student

from .models import Batch, ClassInfo, Course

HIGHER_ED_LEVELS = ("bachelor", "master", "pre_diploma", "diploma")


def promote_program(school, course: Course, *, apply: bool = False) -> dict:
    if course.education_level not in HIGHER_ED_LEVELS:
        raise ValidationError(
            f"'{course.get_education_level_display()}' is not a higher-ed program level."
        )

    classes = list(
        ClassInfo.objects.filter(
            school=school, education_level=course.education_level, course=course
        ).select_related("academic_year")
    )
    if not classes:
        raise ValidationError("No classes exist for this course.")

    use_year = any(c.year for c in classes)
    level_of = (lambda c: c.year) if use_year else (lambda c: c.semester)
    program_len = (course.total_years if use_year else course.total_semesters) or max(
        (level_of(c) or 0) for c in classes
    )

    # (level, section_id) -> class  [section None == base class]
    by_level_section = {(level_of(c), c.section_id): c for c in classes}

    moves: list[dict] = []          # {student, from, to, level}
    skipped: list[dict] = []        # {student, from, level, reason}
    batch_targets: dict = {}        # batch_id -> new level
    plan_updates: list[tuple] = []  # (student_id, target_class_id)

    # highest source level first so nobody is moved twice
    for level in range(program_len - 1, 0, -1):
        for src in (c for c in classes if level_of(c) == level):
            target = by_level_section.get((level + 1, src.section_id))
            students = list(
                Student.objects.filter(
                    class_info=src, status=Student.Status.RUNNING
                ).values_list("id", "batch_id")
            )
            for student_id, batch_id in students:
                if target is None:
                    skipped.append({
                        "student": str(student_id), "from": str(src),
                        "level": level, "reason": "no target section at next level",
                    })
                    continue
                if src.academic_year_id != target.academic_year_id:
                    raise ValidationError(
                        f"Level {level} and {level + 1} are in different academic "
                        "years — run the academic-year roll first so this is a "
                        "safe same-year promotion."
                    )
                moves.append({
                    "student": str(student_id), "from": str(src),
                    "to": str(target), "level": level,
                })
                plan_updates.append((student_id, target.id))
                if batch_id:
                    batch_targets[batch_id] = level + 1

    result = {
        "term_kind": "year" if use_year else "semester",
        "program_length": program_len,
        "moves": moves,
        "skipped": skipped,
        "batch_advances": [
            {"batch": str(b), "to": lvl} for b, lvl in sorted(batch_targets.items())
        ],
        "applied": False,
    }
    if not apply or not plan_updates:
        return result

    with transaction.atomic():
        by_target = defaultdict(list)
        for student_id, target_id in plan_updates:
            by_target[target_id].append(student_id)
        for target_id, ids in by_target.items():
            Student.objects.filter(id__in=ids).update(class_info_id=target_id)
        counter = "current_year" if use_year else "current_semester"
        for batch_id, new_level in batch_targets.items():
            Batch.objects.filter(id=batch_id).update(**{counter: new_level})
    result["applied"] = True
    return result
