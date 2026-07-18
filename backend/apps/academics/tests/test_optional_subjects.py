"""Optional-subject assignment (legacy SubjectAssignment port)."""

import pytest
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassInfo, Subject
from apps.examinations.models import Exam, SubjectResultSheet
from apps.people.models import Student
from apps.people.tests.test_tenant_isolation import login, make_school


@pytest.fixture
def optional_setup(db):
    school = make_school("opt")
    year = AcademicYear.objects.create(
        school=school, name="2082", start_date_bs="2082-01-01", end_date_bs="2082-12-30"
    )
    class_info = ClassInfo.objects.create(
        school=school, education_level="school", grade="nine", academic_year=year
    )
    optional = Subject.objects.create(
        school=school, class_info=class_info, name="Optional Maths",
        type="optional", credit_hours="4.00",
    )
    students = [
        Student.objects.create(
            school=school, first_name=n, last_name="Opt", gender="male",
            class_info=class_info, academic_year=year,
        )
        for n in ("Ek", "Dui", "Tin")
    ]
    return school, year, class_info, optional, students


@pytest.mark.django_db
class TestOptionalAssignment:
    def test_replace_set_roundtrip(self, optional_setup):
        school, year, class_info, optional, students = optional_setup
        api = APIClient()
        login(api, "admin_opt", "admin")
        url = f"/api/v1/academics/subjects/{optional.id}/assignments/"
        res = api.put(url, {"students": [str(students[0].id), str(students[2].id)]},
                      format="json")
        assert res.status_code == 200, res.content
        assert api.get(url).data["students"] == sorted(
            [str(students[0].id), str(students[2].id)]
        )
        # replace shrinks the set
        api.put(url, {"students": [str(students[1].id)]}, format="json")
        assert api.get(url).data["students"] == [str(students[1].id)]

    def test_foreign_student_refused(self, optional_setup):
        school, year, class_info, optional, students = optional_setup
        other = make_school("opt2")
        outsider = Student.objects.create(
            school=other, first_name="Out", last_name="Sider", gender="male",
            class_info=ClassInfo.objects.create(
                school=other, education_level="school", grade="one",
                academic_year=AcademicYear.objects.create(
                    school=other, name="2082",
                    start_date_bs="2082-01-01", end_date_bs="2082-12-30",
                ),
            ),
            academic_year=AcademicYear.objects.get(school=other),
        )
        api = APIClient()
        login(api, "admin_opt", "admin")
        res = api.put(
            f"/api/v1/academics/subjects/{optional.id}/assignments/",
            {"students": [str(outsider.id)]}, format="json",
        )
        assert res.status_code == 400

    def test_marks_roster_narrows_to_assigned(self, optional_setup):
        school, year, class_info, optional, students = optional_setup
        exam = Exam.objects.create(school=school, academic_year=year, name="First Term")
        sheet = SubjectResultSheet.objects.create(
            school=school, exam=exam, class_info=class_info, subject=optional,
            full_marks="100.00", pass_marks="40.00",
        )
        api = APIClient()
        login(api, "admin_opt", "admin")
        url = f"/api/v1/examinations/sheets/{sheet.id}/roster/"
        # no assignments -> whole class
        assert len(api.get(url).data) == 3
        api.put(
            f"/api/v1/academics/subjects/{optional.id}/assignments/",
            {"students": [str(students[0].id)]}, format="json",
        )
        names = [r["full_name"] for r in api.get(url).data]
        assert names == ["Ek Opt"]
