"""Guardian-link management on students: inline create, revive, primary flag."""

import pytest
from rest_framework.test import APIClient

from apps.people.models import Guardian, StudentGuardian
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


@pytest.mark.django_db
class TestGuardianLinks:
    def test_inline_create_and_detail_shape(self, db):
        school = make_school("glink1")
        student = make_student(school, "Ram")
        api = APIClient()
        login(api, "admin_glink1", "admin")
        res = api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {
                "name": "Hari Prasad", "contact": "9800000001",
                "relation": "father", "is_primary_contact": True,
            },
        )
        assert res.status_code == 201, res.content
        assert res.data["guardian"]["name"] == "Hari Prasad"
        detail = api.get(f"/api/v1/people/students/{student.id}/")
        assert [g["relation"] for g in detail.data["guardians"]] == ["father"]

    def test_primary_contact_is_exclusive(self, db):
        school = make_school("glink2")
        student = make_student(school, "Shyam")
        api = APIClient()
        login(api, "admin_glink2", "admin")
        first = api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {"name": "Mata Devi", "relation": "mother", "is_primary_contact": True},
        )
        api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {"name": "Pita Ji", "relation": "father", "is_primary_contact": True},
        )
        links = {
            link.relation: link.is_primary_contact
            for link in StudentGuardian.objects.filter(student=student)
        }
        assert links == {"mother": False, "father": True}
        assert first.status_code == 201

    def test_duplicate_relation_rejected_but_soft_deleted_link_revives(self, db):
        school = make_school("glink3")
        student = make_student(school, "Gita")
        api = APIClient()
        login(api, "admin_glink3", "admin")
        res = api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {"name": "Kaka Ji", "relation": "guardian"},
        )
        link_id = res.data["id"]
        guardian_id = res.data["guardian"]["id"]
        dup = api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {"guardian": guardian_id, "relation": "guardian"},
        )
        assert dup.status_code == 400
        # Detach, then re-link: the soft-deleted row is revived, not duplicated.
        assert (
            api.delete(
                f"/api/v1/people/students/{student.id}/guardians/{link_id}/"
            ).status_code
            == 204
        )
        assert Guardian.objects.filter(id=guardian_id).exists()  # person remains
        again = api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {"guardian": guardian_id, "relation": "guardian"},
        )
        assert again.status_code == 201
        assert StudentGuardian.all_objects.filter(student=student).count() == 1

    def test_cross_school_guardian_rejected(self, db):
        school_a = make_school("glink4a")
        school_b = make_school("glink4b")
        student = make_student(school_a, "Nita")
        foreign = Guardian.objects.create(school=school_b, name="Other School Parent")
        api = APIClient()
        login(api, "admin_glink4a", "admin")
        res = api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {"guardian": str(foreign.id), "relation": "father"},
        )
        assert res.status_code == 400

    def test_patch_updates_link_and_person(self, db):
        school = make_school("glink5")
        student = make_student(school, "Rita")
        api = APIClient()
        login(api, "admin_glink5", "admin")
        res = api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {"name": "Aama", "relation": "other"},
        )
        link_id = res.data["id"]
        patched = api.patch(
            f"/api/v1/people/students/{student.id}/guardians/{link_id}/",
            {"relation": "mother", "is_primary_contact": True, "contact": "9811111119"},
        )
        assert patched.status_code == 200, patched.content
        assert patched.data["relation"] == "mother"
        assert patched.data["is_primary_contact"] is True
        assert patched.data["guardian"]["contact"] == "9811111119"

    def test_requires_students_manage(self, db):
        school = make_school("glink6")
        student = make_student(school, "Sita")
        make_staff(school, "glink6_view", ["students.view"])
        api = APIClient()
        login(api, "glink6_view", "staff")
        res = api.post(
            f"/api/v1/people/students/{student.id}/guardians/",
            {"name": "Blocked", "relation": "father"},
        )
        assert res.status_code == 403


@pytest.mark.django_db
class TestDirectorySupport:
    def test_class_list_carries_running_student_count(self, db):
        school = make_school("gdir1")
        student = make_student(school, "Counted")
        make_student(school, "Also")
        api = APIClient()
        login(api, "admin_gdir1", "admin")
        res = api.get("/api/v1/academics/classes/")
        row = next(r for r in res.data["results"] if r["id"] == str(student.class_info_id))
        assert row["students_count"] == 2

    def test_staff_search_filters_by_name(self, db):
        school = make_school("gdir2")
        make_staff(school, "gdir2_a", [])  # Hari Karki
        api = APIClient()
        login(api, "admin_gdir2", "admin")
        assert len(api.get("/api/v1/people/staff/?search=karki").data["results"]) == 1
        assert len(api.get("/api/v1/people/staff/?search=nomatch").data["results"]) == 0
