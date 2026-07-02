"""
Position (rank) computation — legacy E2: positions in section and in class.

Section = the student's exact ClassInfo. Class = all sibling sections of the
same grade tuple (invariant A3: siblings share every grade field but
`section`). Rank is by aggregate exam total (sum across subjects), dense
ranking (equal totals share a position), computed at publish time.
"""

from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Q

from apps.academics.models import ClassInfo
from apps.examinations.models import StudentSubjectResult, SubjectResultSheet


def sibling_class_ids(class_info: ClassInfo) -> list:
    """All ClassInfo ids of the same grade group (every field but section)."""
    return list(
        ClassInfo.objects.filter(
            school_id=class_info.school_id,
            education_level=class_info.education_level,
            grade=class_info.grade,
            faculty=class_info.faculty,
            course_id=class_info.course_id,
            year=class_info.year,
            semester=class_info.semester,
            academic_year_id=class_info.academic_year_id,
        ).values_list("id", flat=True)
    )


def _dense_ranks(totals: dict) -> dict:
    """student_id -> 1-based dense rank by descending total."""
    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    ranks, rank, previous = {}, 0, None
    for student_id, total in ranked:
        if total != previous:
            rank += 1
            previous = total
        ranks[student_id] = rank
    return ranks


@transaction.atomic
def recompute_positions(exam, class_info: ClassInfo) -> int:
    """Recompute and store both positions for one exam + grade group."""
    class_ids = sibling_class_ids(class_info)
    sheets = SubjectResultSheet.objects.filter(exam=exam, class_info_id__in=class_ids)
    rows = list(
        StudentSubjectResult.objects.filter(sheet__in=sheets)
        .select_related("sheet")
        .only("id", "student_id", "total", "sheet__class_info_id")
    )

    by_section: dict = defaultdict(lambda: defaultdict(Decimal))
    by_class: dict = defaultdict(Decimal)
    for row in rows:
        by_section[row.sheet.class_info_id][row.student_id] += row.total
        by_class[row.student_id] += row.total

    section_ranks = {
        section_id: _dense_ranks(totals) for section_id, totals in by_section.items()
    }
    class_ranks = _dense_ranks(by_class)

    for row in rows:
        row.position_in_section = section_ranks[row.sheet.class_info_id][row.student_id]
        row.position_in_class = class_ranks[row.student_id]
    StudentSubjectResult.objects.bulk_update(
        rows, ["position_in_section", "position_in_class"], batch_size=2000
    )
    return len(rows)


@transaction.atomic
def publish(exam, class_info: ClassInfo, published_date_bs: str) -> int:
    """
    Publish every sheet of (exam, class) — legacy semantics — after
    recomputing positions so published results carry final ranks.
    """
    recompute_positions(exam, class_info)
    return SubjectResultSheet.objects.filter(
        Q(exam=exam, class_info=class_info)
    ).update(published_date_bs=published_date_bs)
