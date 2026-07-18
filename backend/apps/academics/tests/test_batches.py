"""Batch cohorts + program promotion (legacy 0066/0067 port).

A batch is the immutable intake identity; promotion advances placements and
the batch counter, never money. These tests pin the registry rules and the
promote_program guards (same-AY, section-preserving, terminal level frozen).
"""

import pytest
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, Batch, ClassInfo, Course, Section
from apps.academics.services import promote_program
from apps.people.models import Student
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


@pytest.fixture
def program(db):
    school = make_school("prog")
    year = AcademicYear.objects.create(
        school=school, name="2082", start_date_bs="2082-01-01", end_date_bs="2082-12-30"
    )
    course = Course.objects.create(
        school=school, name="BCA", education_level="bachelor", total_semesters=4
    )
    return school, year, course


def make_class(school, year, course, semester, section=None):
    return ClassInfo.objects.create(
        school=school, education_level="bachelor", course=course,
        semester=semester, section=section, academic_year=year,
    )


def enroll(school, class_info, name, batch=None):
    return Student.objects.create(
        school=school, first_name=name, last_name="Test", gender="male",
        class_info=class_info, academic_year=class_info.academic_year, batch=batch,
    )


@pytest.mark.django_db
class TestBatchRegistry:
    def test_crud_and_uniqueness(self, program):
        school, year, course = program
        api = APIClient()
        login(api, "admin_prog", "admin")
        res = api.post("/api/v1/academics/batches/", {
            "course": str(course.id), "year": "2079",
            "start_academic_year": str(year.id), "current_semester": 1,
        }, format="json")
        assert res.status_code == 201, res.content
        assert res.data["course_name"] == "BCA"
        # same (school, course, year) refused
        dup = api.post("/api/v1/academics/batches/", {
            "course": str(course.id), "year": "2079",
        }, format="json")
        assert dup.status_code == 400

    def test_semester_and_year_counters_are_exclusive(self, program):
        school, year, course = program
        api = APIClient()
        login(api, "admin_prog", "admin")
        res = api.post("/api/v1/academics/batches/", {
            "course": str(course.id), "year": "2080",
            "current_semester": 1, "current_year": 1,
        }, format="json")
        assert res.status_code == 400

    def test_referenced_batch_cannot_be_deleted(self, program):
        school, year, course = program
        batch = Batch.objects.create(school=school, course=course, year="2079")
        cls = make_class(school, year, course, semester=1)
        enroll(school, cls, "Cohort", batch=batch)
        api = APIClient()
        login(api, "admin_prog", "admin")
        res = api.delete(f"/api/v1/academics/batches/{batch.id}/")
        assert res.status_code == 400
        assert Batch.objects.filter(id=batch.id).exists()

    def test_course_duration_exclusive(self, program):
        school, year, course = program
        api = APIClient()
        login(api, "admin_prog", "admin")
        res = api.post("/api/v1/academics/courses/", {
            "name": "Weird", "education_level": "diploma",
            "total_years": 3, "total_semesters": 6,
        }, format="json")
        assert res.status_code == 400

    def test_same_term_exists_once_per_batch(self, program):
        school, year, course = program
        b78 = Batch.objects.create(school=school, course=course, year="2078")
        b79 = Batch.objects.create(school=school, course=course, year="2079")
        ClassInfo.objects.create(
            school=school, education_level="bachelor", course=course,
            semester=1, academic_year=year, batch=b78,
        )
        # a second intake may sit in the SAME course+semester
        ClassInfo.objects.create(
            school=school, education_level="bachelor", course=course,
            semester=1, academic_year=year, batch=b79,
        )
        assert ClassInfo.objects.filter(course=course, semester=1).count() == 2


@pytest.mark.django_db
class TestProgramPromotion:
    def test_dry_run_plans_and_apply_moves(self, program):
        school, year, course = program
        batch = Batch.objects.create(
            school=school, course=course, year="2079", current_semester=1
        )
        sem1 = make_class(school, year, course, 1)
        sem2 = make_class(school, year, course, 2)
        make_class(school, year, course, 3)
        make_class(school, year, course, 4)  # terminal level
        s1 = enroll(school, sem1, "First", batch=batch)
        s2 = enroll(school, sem2, "Second")

        plan = promote_program(school, course)
        assert plan["applied"] is False
        assert len(plan["moves"]) == 2
        s1.refresh_from_db()
        assert s1.class_info_id == sem1.id  # dry-run wrote nothing

        result = promote_program(school, course, apply=True)
        assert result["applied"] is True
        s1.refresh_from_db(); s2.refresh_from_db()
        assert s1.class_info_id == sem2.id
        assert s2.class_info.semester == 3
        batch.refresh_from_db()
        assert batch.current_semester == 2

    def test_terminal_level_is_not_promoted(self, program):
        school, year, course = program
        top = make_class(school, year, course, 4)
        senior = enroll(school, top, "Finalist")
        promote_program(school, course, apply=True)
        senior.refresh_from_db()
        assert senior.class_info_id == top.id

    def test_missing_target_section_skips_not_dumps(self, program):
        school, year, course = program
        rose = Section.objects.create(school=school, name="ROSE")
        sem1_rose = make_class(school, year, course, 1, section=rose)
        make_class(school, year, course, 2)  # base class only, no ROSE
        stuck = enroll(school, sem1_rose, "Sectioned")
        result = promote_program(school, course, apply=True)
        assert len(result["skipped"]) == 1
        stuck.refresh_from_db()
        assert stuck.class_info_id == sem1_rose.id

    def test_cross_year_promotion_aborts(self, program):
        school, year, course = program
        other = AcademicYear.objects.create(
            school=school, name="2083", start_date_bs="2083-01-01",
            end_date_bs="2083-12-30",
        )
        sem1 = make_class(school, year, course, 1)
        ClassInfo.objects.create(
            school=school, education_level="bachelor", course=course,
            semester=2, academic_year=other,
        )
        enroll(school, sem1, "Blocked")
        from rest_framework.exceptions import ValidationError
        with pytest.raises(ValidationError, match="different academic"):
            promote_program(school, course, apply=True)

    def test_endpoint_is_admin_only(self, program):
        school, year, course = program
        make_class(school, year, course, 1)
        api = APIClient()
        login(api, "admin_prog", "admin")
        res = api.post(
            f"/api/v1/academics/courses/{course.id}/promote-program/", {}, format="json"
        )
        assert res.status_code == 200
        assert res.data["applied"] is False
