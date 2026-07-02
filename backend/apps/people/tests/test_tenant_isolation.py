"""
Tenant isolation and role enforcement — the trust boundaries from
DOCUMENTATION.md §17.1. These tests are the platform's security contract:
if any of them fails, nothing else matters.
"""

import pytest
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassInfo, Subject
from apps.identity.models import Account, Role
from apps.people.models import Staff, StaffRole, Student
from apps.tenants.models import School

PASSWORD = "s3cure-pass-99"  # noqa: S105 — test-only credential


def make_school(slug: str) -> School:
    admin = Account.objects.create_user(
        f"admin_{slug}", Role.ADMIN, PASSWORD, verified=True
    )
    return School.objects.create(
        name=f"School {slug}", slug=slug, address="Kathmandu", admin_account=admin
    )


def make_student(school: School, first_name: str) -> Student:
    year = AcademicYear.objects.get_or_create(
        school=school,
        name="2082",
        defaults={"start_date_bs": "2082-01-01", "end_date_bs": "2082-12-30"},
    )[0]
    class_info = ClassInfo.objects.get_or_create(
        school=school, education_level="school", grade="one", academic_year=year
    )[0]
    return Student.objects.create(
        school=school, first_name=first_name, last_name="Test", gender="male",
        class_info=class_info, academic_year=year,
    )


def login(api: APIClient, username: str, role: str):
    res = api.post(
        "/api/v1/auth/login/", {"username": username, "password": PASSWORD, "role": role}
    )
    assert res.status_code == 200, res.content
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")


@pytest.fixture
def two_schools(db):
    school_a, school_b = make_school("alpha"), make_school("beta")
    make_student(school_a, "Asha")
    make_student(school_b, "Bikash")
    return school_a, school_b


@pytest.mark.django_db
class TestTenantIsolation:
    def test_admin_sees_only_own_students(self, two_schools):
        api = APIClient()
        login(api, "admin_alpha", "admin")
        res = api.get("/api/v1/people/students/")
        assert res.status_code == 200
        names = [s["full_name"] for s in res.data["results"]]
        assert names == ["Asha Test"]

    def test_admin_cannot_fetch_other_schools_student_by_id(self, two_schools):
        _, school_b = two_schools
        other_student = Student.objects.get(school=school_b)
        api = APIClient()
        login(api, "admin_alpha", "admin")
        res = api.get(f"/api/v1/people/students/{other_student.id}/")
        assert res.status_code == 404  # invisible, not just forbidden

    def test_client_supplied_school_id_is_ignored(self, two_schools):
        school_a, school_b = two_schools
        api = APIClient()
        login(api, "admin_alpha", "admin")
        year_b = AcademicYear.objects.get(school=school_b)
        class_b = ClassInfo.objects.get(school=school_b)
        res = api.post("/api/v1/people/students/", {
            "first_name": "Evil", "last_name": "Write", "gender": "male",
            "class_info": str(class_b.id), "academic_year": str(year_b.id),
            "school": str(school_b.id),  # must be ignored/rejected
        })
        assert res.status_code == 400  # cross-school class/year rejected
        assert Student.objects.filter(school=school_b).count() == 1

    def test_student_role_cannot_manage_students(self, two_schools):
        school_a, _ = two_schools
        student = Student.objects.get(school=school_a)
        account = Account.objects.create_user("stud_alpha1", Role.STUDENT, PASSWORD, verified=True)
        student.account = account
        student.save(update_fields=["account"])
        api = APIClient()
        login(api, "stud_alpha1", "student")
        assert api.get("/api/v1/people/students/").status_code == 403

    def test_account_without_school_is_denied(self, two_schools, db):
        Account.objects.create_user("sa_root1", Role.SUPER_ADMIN, PASSWORD, verified=True)
        api = APIClient()
        login(api, "sa_root1", "super_admin")
        assert api.get("/api/v1/people/students/").status_code == 403


@pytest.mark.django_db
class TestSubjectGuards:
    def test_protected_subject_cannot_be_deleted(self, two_schools):
        school_a, _ = two_schools
        class_a = ClassInfo.objects.get(school=school_a)
        subject = Subject.objects.create(
            school=school_a, class_info=class_a, name="Maths",
            credit_hours="4.00", is_protected=True,
        )
        api = APIClient()
        login(api, "admin_alpha", "admin")
        res = api.delete(f"/api/v1/academics/subjects/{subject.id}/")
        assert res.status_code == 400
        assert Subject.objects.filter(id=subject.id).exists()

    def test_referenced_subject_cannot_be_deleted(self, two_schools):
        school_a, _ = two_schools
        class_a = ClassInfo.objects.get(school=school_a)
        subject = Subject.objects.create(
            school=school_a, class_info=class_a, name="Science", credit_hours="4.00"
        )
        role = StaffRole.objects.create(name="Teacher")
        Staff.objects.create(
            school=school_a, role=role, first_name="Tara", last_name="Sharma",
            primary_contact="9800000000", primary_subject=subject,
        )
        api = APIClient()
        login(api, "admin_alpha", "admin")
        res = api.delete(f"/api/v1/academics/subjects/{subject.id}/")
        assert res.status_code == 400
        assert Subject.objects.filter(id=subject.id).exists()

    def test_unused_subject_soft_deletes(self, two_schools):
        school_a, _ = two_schools
        class_a = ClassInfo.objects.get(school=school_a)
        subject = Subject.objects.create(
            school=school_a, class_info=class_a, name="Art", credit_hours="2.00"
        )
        api = APIClient()
        login(api, "admin_alpha", "admin")
        assert api.delete(f"/api/v1/academics/subjects/{subject.id}/").status_code == 204
        assert not Subject.objects.filter(id=subject.id).exists()
        assert Subject.all_objects.filter(id=subject.id).exists()  # soft-deleted
