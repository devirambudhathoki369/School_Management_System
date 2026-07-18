"""Final (annual) result: weighted aggregation across exams.

Pins the money rules of the aggregate: weights scale marks AND full/pass
marks identically, a missed exam contributes zero (weight not re-normalised),
absent means absent everywhere, and the payload speaks the exact class-result
contract so every marksheet design renders it untouched.
"""

from decimal import Decimal

import pytest
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassInfo, Subject
from apps.examinations.models import Exam, StudentSubjectResult, SubjectResultSheet
from apps.examinations.services.final_result import final_class_result
from apps.people.models import Student
from apps.people.tests.test_tenant_isolation import login, make_school


@pytest.fixture
def final_setup(db):
    school = make_school("final")
    year = AcademicYear.objects.create(
        school=school, name="2082", start_date_bs="2082-01-01", end_date_bs="2082-12-30"
    )
    class_info = ClassInfo.objects.create(
        school=school, education_level="school", grade="ten", academic_year=year
    )
    maths = Subject.objects.create(
        school=school, class_info=class_info, name="Maths", credit_hours="4.00"
    )
    first = Exam.objects.create(
        school=school, academic_year=year, name="First Term",
        inclusion_weight="40.00",
    )
    annual = Exam.objects.create(
        school=school, academic_year=year, name="Annual",
        inclusion_weight="60.00",
    )
    sheets = {
        exam.id: SubjectResultSheet.objects.create(
            school=school, exam=exam, class_info=class_info, subject=maths,
            full_marks="100.00", pass_marks="40.00",
        )
        for exam in (first, annual)
    }
    student = Student.objects.create(
        school=school, first_name="Final", last_name="Test", gender="female",
        class_info=class_info, academic_year=year,
    )
    return school, year, class_info, maths, first, annual, sheets, student


def mark(school, sheet, student, total, absent=False):
    return StudentSubjectResult.objects.create(
        school=school, sheet=sheet, student=student,
        theory=None if absent else total, total=total,
        passed=(not absent) and Decimal(total) >= Decimal("40"),
        absent=absent,
    )


@pytest.mark.django_db
class TestFinalResult:
    def test_weighted_totals_letters_and_positions(self, final_setup):
        school, year, class_info, maths, first, annual, sheets, student = final_setup
        rival = Student.objects.create(
            school=school, first_name="Rival", last_name="Test", gender="male",
            class_info=class_info, academic_year=year,
        )
        # student: 80 (40%) + 90 (60%) -> 32 + 54 = 86
        mark(school, sheets[first.id], student, "80.00")
        mark(school, sheets[annual.id], student, "90.00")
        # rival: 60 + 50 -> 24 + 30 = 54
        mark(school, sheets[first.id], rival, "60.00")
        mark(school, sheets[annual.id], rival, "50.00")

        data = final_class_result(school, year, class_info)
        assert data["exam"]["id"] == "final"
        # subject FM scales identically: 100*0.4 + 100*0.6 = 100
        assert data["subjects"][0]["full_marks"] == "100.00"
        by_name = {s["name"]: s for s in data["students"]}
        top = by_name["Final Test"]
        cell = top["marks"][str(maths.id)]
        assert cell["total"] == "86.00"
        assert cell["letter"] == "A"          # 86% national band
        assert cell["passed"] is True
        assert cell["breakdown"] == {str(first.id): "80.00", str(annual.id): "90.00"}
        assert top["position_in_class"] == 1
        assert by_name["Rival Test"]["position_in_class"] == 2

    def test_missed_exam_contributes_zero_not_renormalised(self, final_setup):
        school, year, class_info, maths, first, annual, sheets, student = final_setup
        # only the annual exists for this student: 90 * 0.6 = 54, against FM 100
        mark(school, sheets[annual.id], student, "90.00")
        data = final_class_result(school, year, class_info)
        cell = data["students"][0]["marks"][str(maths.id)]
        assert cell["total"] == "54.00"
        assert cell["passed"] is True         # 54 >= weighted pass 40
        assert cell["absent"] is False

    def test_absent_everywhere_is_absent(self, final_setup):
        school, year, class_info, maths, first, annual, sheets, student = final_setup
        mark(school, sheets[first.id], student, "0.00", absent=True)
        mark(school, sheets[annual.id], student, "0.00", absent=True)
        data = final_class_result(school, year, class_info)
        cell = data["students"][0]["marks"][str(maths.id)]
        assert cell["absent"] is True
        assert cell["passed"] is False

    def test_requires_weighted_exams(self, final_setup):
        school, year, class_info, *_ = final_setup
        Exam.objects.filter(school=school).update(inclusion_weight=None)
        with pytest.raises(ValidationError, match="inclusion"):
            final_class_result(school, year, class_info)

    def test_endpoint_serves_the_contract(self, final_setup):
        school, year, class_info, maths, first, annual, sheets, student = final_setup
        mark(school, sheets[first.id], student, "80.00")
        mark(school, sheets[annual.id], student, "90.00")
        api = APIClient()
        login(api, "admin_final", "admin")
        res = api.get(
            "/api/v1/examinations/exams/final-result/"
            f"?academic_year={year.id}&class_info={class_info.id}"
        )
        assert res.status_code == 200, res.content
        assert res.data["included_exams"][0]["weight"] == "40.00"
        assert res.data["students"][0]["gpa"] is not None
