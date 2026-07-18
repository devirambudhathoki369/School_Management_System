"""
Final (annual) result aggregation — the legacy "Final result / Combined
marksheet" leaves.

Exams carrying `inclusion_weight` participate (legacy `Exam.inclusion`,
e.g. First Term 25 + Second Term 25 + Annual 50). Per subject and student,
the final mark is the weight-scaled sum across those exams; full/pass marks
scale by the same weights, so letters, grade points, GPA and pass flags come
from the SAME grading engine as a single exam — the aggregate behaves like
one big exam sheet.

Rules kept from legacy behaviour:
- a subject a student missed in one exam contributes 0 for that exam (the
  weight is not re-normalised); absent only when absent in EVERY included
  exam that examined the subject;
- positions are dense-ranked on the final total within the class view;
- the payload matches the per-exam class-result contract exactly, so every
  marksheet design and the printed grid work unchanged; `included_exams`
  and per-student `breakdown` (exam → total) power the combined columns.
"""

from collections import defaultdict
from decimal import Decimal

from rest_framework.exceptions import ValidationError

from ..models import Exam, SubjectResultSheet
from . import grading

ZERO = Decimal("0")
HUNDRED = Decimal("100")


def final_class_result(school, academic_year, class_info) -> dict:
    exams = list(
        Exam.objects.filter(
            school=school, academic_year=academic_year,
            inclusion_weight__isnull=False,
        ).order_by("created_at")
    )
    if not exams:
        raise ValidationError(
            "No exams in this academic year carry a final-result weight "
            "(set each exam's inclusion % first)."
        )
    weight_of = {e.id: (e.inclusion_weight or ZERO) / HUNDRED for e in exams}

    sheets = list(
        SubjectResultSheet.objects.filter(exam__in=exams, class_info=class_info)
        .select_related("subject", "exam")
        .order_by("subject__order", "subject__name")
        .prefetch_related("results__student")
    )
    if not sheets:
        raise ValidationError("No result sheets exist for this class in these exams.")

    # subject meta: weighted full/pass marks summed over the exams that
    # actually examined the subject
    subjects: dict = {}
    # (subject, student) accumulator
    cells: dict = defaultdict(
        lambda: {
            "theory": ZERO, "practical": ZERO, "total": ZERO,
            "seen": 0, "absent_all": True, "breakdown": {},
            "has_theory": False, "has_practical": False,
        }
    )
    students_meta: dict = {}

    for sheet in sheets:
        w = weight_of[sheet.exam_id]
        meta = subjects.setdefault(
            sheet.subject_id,
            {
                "subject": sheet.subject,
                "full_marks": ZERO,
                "pass_marks": ZERO,
                "published": True,
            },
        )
        meta["full_marks"] += (sheet.full_marks or ZERO) * w
        meta["pass_marks"] += (sheet.pass_marks or ZERO) * w
        meta["published"] = meta["published"] and bool(sheet.published_date_bs)
        for result in sheet.results.all():
            students_meta.setdefault(result.student_id, result.student)
            cell = cells[(sheet.subject_id, result.student_id)]
            cell["seen"] += 1
            if not result.absent:
                cell["absent_all"] = False
            cell["theory"] += (result.theory or ZERO) * w
            if result.practical is not None:
                cell["practical"] += result.practical * w
                cell["has_practical"] = True
            if result.theory is not None:
                cell["has_theory"] = True
            cell["total"] += (result.total or ZERO) * w
            cell["breakdown"][str(sheet.exam_id)] = str(result.total)

    rows: dict = {}
    for (subject_id, student_id), cell in cells.items():
        meta = subjects[subject_id]
        subject = meta["subject"]
        hours = subject.credit_hours + (subject.credit_hours_practical or 0)
        full = meta["full_marks"]
        total = cell["total"].quantize(Decimal("0.01"))
        passed = (not cell["absent_all"]) and total >= meta["pass_marks"]
        gp = grading.grade_point(total, full)
        row = rows.setdefault(
            student_id,
            {
                "id": str(student_id),
                "name": students_meta[student_id].full_name,
                "roll_no": students_meta[student_id].roll_no,
                "marks": {},
                "total": ZERO,
                "full_marks": ZERO,
                "weighted_gp": ZERO,
                "credit_hours": ZERO,
                "all_passed": True,
            },
        )
        row["marks"][str(subject_id)] = {
            "theory": str(cell["theory"].quantize(Decimal("0.01")))
            if cell["has_theory"] else None,
            "practical": str(cell["practical"].quantize(Decimal("0.01")))
            if cell["has_practical"] else None,
            "total": str(total),
            "passed": passed,
            "absent": cell["absent_all"],
            "letter": grading.letter_grade(total, full),
            "grade_point": str(gp),
            "breakdown": cell["breakdown"],
        }
        row["total"] += total
        row["full_marks"] += full
        row["weighted_gp"] += gp * hours
        row["credit_hours"] += hours
        if not passed:
            row["all_passed"] = False

    # dense-rank on final totals (class view)
    ranked = sorted(rows.values(), key=lambda r: -r["total"])
    last_total, rank = None, 0
    for row in ranked:
        if row["total"] != last_total:
            rank += 1
            last_total = row["total"]
        row["position_in_class"] = rank
        row["position_in_section"] = rank

    payload = []
    for row in ranked:
        student_gpa = (
            grading.gpa(row.pop("weighted_gp"), row["credit_hours"])
            if row["credit_hours"] else None
        )
        row.pop("credit_hours")
        payload.append({
            **row,
            "total": str(row["total"].quantize(Decimal("0.01"))),
            "full_marks": str(row["full_marks"].quantize(Decimal("0.01"))),
            "percentage": str(grading.percentage(row["total"], row["full_marks"])),
            "gpa": str(student_gpa) if student_gpa is not None else None,
            "gpa_letter": grading.gp_letter(student_gpa) if student_gpa else "",
        })

    return {
        "exam": {
            # Prints alongside academic_year_name — no year in the name, or
            # marksheet headers would show it twice.
            "id": "final",
            "name": "Final Result",
            "academic_year_name": academic_year.name,
        },
        "class_label": str(class_info),
        "published": all(m["published"] for m in subjects.values()),
        "included_exams": [
            {"id": str(e.id), "name": e.name, "weight": str(e.inclusion_weight)}
            for e in exams
        ],
        "subjects": [
            {
                "id": str(sid),
                "name": m["subject"].name,
                "full_marks": str(m["full_marks"].quantize(Decimal("0.01"))),
                "pass_marks": str(m["pass_marks"].quantize(Decimal("0.01"))),
                "published": m["published"],
            }
            for sid, m in subjects.items()
        ],
        "students": payload,
    }
