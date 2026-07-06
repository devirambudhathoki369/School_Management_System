"""Attendance roster: class/staff name lists under the attendance grant."""

import pytest
from rest_framework.test import APIClient

from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


@pytest.mark.django_db
class TestAttendanceRoster:
    def test_class_roster_with_attendance_grant_only(self, db):
        school = make_school("aroster")
        student = make_student(school, "Rita")
        make_staff(school, "aroster_clerk", ["attendance.view"])
        api = APIClient()
        login(api, "aroster_clerk", "staff")
        res = api.get(f"/api/v1/attendance/roster/?class_info={student.class_info_id}")
        assert res.status_code == 200
        assert [r["full_name"] for r in res.data] == ["Rita Test"]
        assert api.get("/api/v1/people/students/").status_code == 403

    def test_staff_roster_without_class_param(self, db):
        school = make_school("aroster2")
        make_staff(school, "aroster2_clerk", ["attendance.manage"])
        api = APIClient()
        login(api, "aroster2_clerk", "staff")
        res = api.get("/api/v1/attendance/roster/")
        assert res.status_code == 200
        assert [r["full_name"] for r in res.data] == ["Hari Karki"]

    def test_no_grant_denied_and_tenant_scoped(self, db):
        school_a = make_school("arostera")
        make_school("arosterb")
        student = make_student(school_a, "Sita")
        make_staff(school_a, "arostera_none", ["students.view"])
        api = APIClient()
        login(api, "arostera_none", "staff")
        assert api.get("/api/v1/attendance/roster/").status_code == 403
        # other school's admin sees nothing of school A
        login(api, "admin_arosterb", "admin")
        res = api.get(f"/api/v1/attendance/roster/?class_info={student.class_info_id}")
        assert res.status_code == 200 and res.data == []
