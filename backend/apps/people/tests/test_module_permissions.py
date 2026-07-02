"""
Per-school module permissions: every CRUD action is gated server-side.

Staff hold only the codes their school admin grants (`<module>.view` /
`<module>.manage`); admins implicitly hold everything for their own school.
"""

import pytest
from rest_framework.test import APIClient

from apps.identity.models import Account, Role
from apps.people.models import Staff, StaffRole
from apps.people.tests.test_tenant_isolation import (
    PASSWORD,
    login,
    make_school,
    make_student,
)


@pytest.fixture
def school(db):
    school = make_school("gamma")
    make_student(school, "Gita")
    return school


def make_staff(school, username: str, permissions: list[str]) -> Staff:
    account = Account.objects.create_user(username, Role.STAFF, PASSWORD, verified=True)
    role = StaffRole.objects.get_or_create(name="Teacher")[0]
    return Staff.objects.create(
        school=school, role=role, first_name="Hari", last_name="Karki",
        primary_contact="9811111111", account=account, permissions=permissions,
    )


@pytest.mark.django_db
class TestModulePermissions:
    def test_staff_without_grant_is_denied(self, school):
        make_staff(school, "staff_none", [])
        api = APIClient()
        login(api, "staff_none", "staff")
        assert api.get("/api/v1/people/students/").status_code == 403

    def test_view_grant_allows_read_but_not_write(self, school):
        make_staff(school, "staff_view", ["students.view"])
        api = APIClient()
        login(api, "staff_view", "staff")
        assert api.get("/api/v1/people/students/").status_code == 200
        res = api.post("/api/v1/people/students/", {"first_name": "X"})
        assert res.status_code == 403

    def test_manage_grant_allows_read_and_write(self, school):
        make_staff(school, "staff_mgr", ["students.manage"])
        api = APIClient()
        login(api, "staff_mgr", "staff")
        assert api.get("/api/v1/people/students/").status_code == 200
        student_id = api.get("/api/v1/people/students/").data["results"][0]["id"]
        res = api.patch(f"/api/v1/people/students/{student_id}/", {"roll_no": "42"})
        assert res.status_code == 200
        assert res.data["roll_no"] == "42"

    def test_grant_is_module_scoped(self, school):
        make_staff(school, "staff_acad", ["academics.manage"])
        api = APIClient()
        login(api, "staff_acad", "staff")
        assert api.get("/api/v1/academics/subjects/").status_code == 200
        assert api.get("/api/v1/people/students/").status_code == 403

    def test_admin_implicitly_holds_all_modules(self, school):
        api = APIClient()
        login(api, "admin_gamma", "admin")
        assert api.get("/api/v1/people/students/").status_code == 200
        assert api.get("/api/v1/academics/subjects/").status_code == 200

    def test_unknown_permission_codes_rejected_on_staff_update(self, school):
        staff = make_staff(school, "staff_upd", [])
        api = APIClient()
        login(api, "admin_gamma", "admin")
        res = api.patch(
            f"/api/v1/people/staff/{staff.id}/", {"permissions": ["hacking.manage"]},
            format="json",
        )
        assert res.status_code == 400

    def test_admin_grants_permission_and_staff_gains_access(self, school):
        staff = make_staff(school, "staff_gain", [])
        admin_api, staff_api = APIClient(), APIClient()
        login(admin_api, "admin_gamma", "admin")
        login(staff_api, "staff_gain", "staff")
        assert staff_api.get("/api/v1/people/students/").status_code == 403
        res = admin_api.patch(
            f"/api/v1/people/staff/{staff.id}/", {"permissions": ["students.view"]},
            format="json",
        )
        assert res.status_code == 200
        assert staff_api.get("/api/v1/people/students/").status_code == 200

    def test_login_returns_permissions_for_ui(self, school):
        make_staff(school, "staff_ui", ["students.view"])
        api = APIClient()
        res = api.post("/api/v1/auth/login/", {
            "username": "staff_ui", "password": PASSWORD, "role": "staff",
        })
        assert res.data["account"]["permissions"] == ["students.view"]
