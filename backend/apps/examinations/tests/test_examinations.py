"""Examinations: grading parity with legacy, marks entry, publish workflow."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassInfo, Section, Subject
from apps.examinations.models import Exam, StudentSubjectResult, SubjectResultSheet
from apps.examinations.services import grading
from apps.people.models import Student
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school


class TestGradingEngine:
    """Exact parity with the legacy ResultCalculation + national bands."""

    @pytest.mark.parametrize(("pct", "gp", "letter"), [
        (Decimal("95"), Decimal("4.0"), "A+"),
        (Decimal("85"), Decimal("3.6"), "A"),
        (Decimal("70"), Decimal("3.2"), "B+"),
        (Decimal("60"), Decimal("2.8"), "B"),
        (Decimal("50"), Decimal("2.4"), "C+"),
        (Decimal("40"), Decimal("2.0"), "C"),
        (Decimal("35"), Decimal("1.6"), "D"),
        (Decimal("20"), Decimal("0.0"), "NG"),
    ])
    def test_default_bands(self, pct, gp, letter):
        assert grading.grade_point(pct) == gp
        assert grading.letter_grade(pct) == letter

    def test_percentage_rounding(self):
        assert grading.percentage(Decimal("33"), Decimal("75")) == Decimal("44.00")

    def test_weighted_grade_point(self):
        # 3.6 theory (4 cr) + 2.8 practical (1 cr) -> (14.4+2.8)/5 = 3.44
        assert grading.weighted_grade_point(
            Decimal("3.6"), Decimal("2.8"), Decimal("4"), Decimal("1")
        ) == Decimal("3.44")

    def test_gp_letter_uses_exclusive_min(self):
        assert grading.gp_letter(Decimal("3.6")) == "A"    # boundary belongs below
        assert grading.gp_letter(Decimal("3.61")) == "A+"
        assert grading.gp_letter(Decimal("0.9")) == "NG"


@pytest.fixture
def exam_setup(db):
    school = make_school("delta")
    year = AcademicYear.objects.create(
        school=school, name="2082", start_date_bs="2082-01-01", end_date_bs="2082-12-30"
    )
    section_a = Section.objects.create(school=school, name="A")
    section_b = Section.objects.create(school=school, name="B")
    class_a = ClassInfo.objects.create(
        school=school, education_level="school", grade="ten",
        section=section_a, academic_year=year,
    )
    class_b = ClassInfo.objects.create(
        school=school, education_level="school", grade="ten",
        section=section_b, academic_year=year,
    )
    subject_a = Subject.objects.create(
        school=school, class_info=class_a, name="Maths", credit_hours="4.00"
    )
    exam = Exam.objects.create(school=school, academic_year=year, name="First Term")
    sheet = SubjectResultSheet.objects.create(
        school=school, exam=exam, class_info=class_a, subject=subject_a,
        full_marks="100.00", pass_marks="40.00",
        full_marks_theory="75.00", pass_marks_theory="30.00",
        full_marks_practical="25.00", pass_marks_practical="10.00",
    )
    students = [
        Student.objects.create(
            school=school, first_name=name, last_name="Delta", gender="female",
            class_info=class_a, academic_year=year,
        )
        for name in ("Amina", "Binita", "Champa")
    ]
    return school, exam, class_a, class_b, sheet, students


@pytest.mark.django_db
class TestMarksEntry:
    def entry(self, api, sheet, marks):
        return api.put(
            f"/api/v1/examinations/sheets/{sheet.id}/marks/entry/",
            {"marks": marks}, format="json",
        )

    def test_totals_and_pass_computed_server_side(self, exam_setup):
        school, exam, class_a, _, sheet, (amina, binita, champa) = exam_setup
        api = APIClient()
        login(api, "admin_delta", "admin")
        res = self.entry(api, sheet, [
            # Client-sent total/passed values must be ignored.
            {"student": str(amina.id), "theory": "60", "practical": "20"},
            {"student": str(binita.id), "theory": "25", "practical": "20"},  # fails theory pm
            {"student": str(champa.id), "absent": True},
        ])
        assert res.status_code == 200, res.content
        assert res.data == {"created": 3, "updated": 0}
        rows = {r.student_id: r for r in StudentSubjectResult.objects.all()}
        assert rows[amina.id].total == Decimal("80.00") and rows[amina.id].passed
        assert rows[binita.id].total == Decimal("45.00") and not rows[binita.id].passed
        assert rows[champa.id].total == 0 and not rows[champa.id].passed
        assert rows[champa.id].absent

    def test_upsert_updates_existing_rows(self, exam_setup):
        school, exam, class_a, _, sheet, (amina, *_) = exam_setup
        api = APIClient()
        login(api, "admin_delta", "admin")
        self.entry(api, sheet, [{"student": str(amina.id), "theory": "50"}])
        res = self.entry(api, sheet, [{"student": str(amina.id), "theory": "70"}])
        assert res.data == {"created": 0, "updated": 1}
        assert sheet.results.count() == 1  # no duplicate rows (the legacy bug)
        assert sheet.results.get().total == Decimal("70.00")

    def test_staff_cannot_amend_published_sheet_but_admin_can(self, exam_setup):
        school, exam, class_a, _, sheet, (amina, *_) = exam_setup
        make_staff(school, "staff_exam", ["examinations.manage"])
        sheet.published_date_bs = "2082-04-01"
        sheet.save(update_fields=["published_date_bs"])
        staff_api, admin_api = APIClient(), APIClient()
        login(staff_api, "staff_exam", "staff")
        login(admin_api, "admin_delta", "admin")
        marks = [{"student": str(amina.id), "theory": "50"}]
        assert self.entry(staff_api, sheet, marks).status_code == 400
        assert self.entry(admin_api, sheet, marks).status_code == 200


@pytest.mark.django_db
class TestPublishAndPositions:
    def test_publish_stamps_sheets_and_ranks_across_sections(self, exam_setup):
        school, exam, class_a, class_b, sheet_a, (amina, binita, champa) = exam_setup
        subject_b = Subject.objects.create(
            school=school, class_info=class_b, name="Maths", credit_hours="4.00"
        )
        sheet_b = SubjectResultSheet.objects.create(
            school=school, exam=exam, class_info=class_b, subject=subject_b,
            full_marks="100.00", pass_marks="40.00",
        )
        dinesh = Student.objects.create(
            school=school, first_name="Dinesh", last_name="Delta", gender="male",
            class_info=class_b, academic_year=exam.academic_year,
        )
        api = APIClient()
        login(api, "admin_delta", "admin")
        api.put(f"/api/v1/examinations/sheets/{sheet_a.id}/marks/entry/", {"marks": [
            {"student": str(amina.id), "theory": "60", "practical": "20"},   # 80
            {"student": str(binita.id), "theory": "50", "practical": "20"},  # 70
            {"student": str(champa.id), "theory": "60", "practical": "20"},  # 80 (tie)
        ]}, format="json")
        api.put(f"/api/v1/examinations/sheets/{sheet_b.id}/marks/entry/", {"marks": [
            {"student": str(dinesh.id), "theory": "90"},                     # 90, other section
        ]}, format="json")

        res = api.post(f"/api/v1/examinations/exams/{exam.id}/publish/", {
            "class_info": str(class_a.id), "published_date_bs": "2082-04-15",
        }, format="json")
        assert res.status_code == 200, res.content

        rows = {r.student_id: r for r in StudentSubjectResult.objects.all()}
        # Section ranks (class A only): tie at 80 -> both rank 1 (dense)
        assert rows[amina.id].position_in_section == 1
        assert rows[champa.id].position_in_section == 1
        assert rows[binita.id].position_in_section == 2
        # Class ranks span sibling sections (A3): Dinesh (90, section B) is 1st
        assert rows[dinesh.id].position_in_class == 1
        assert rows[amina.id].position_in_class == 2
        assert rows[binita.id].position_in_class == 3
        # Publish stamped only class A's sheet (per exam+class semantics)
        sheet_a.refresh_from_db()
        sheet_b.refresh_from_db()
        assert sheet_a.is_published and not sheet_b.is_published
