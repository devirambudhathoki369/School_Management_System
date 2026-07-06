"""Staff lookup: the payroll-gated, names-only staff directory."""

import pytest
from rest_framework.test import APIClient

from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school


@pytest.mark.django_db
class TestStaffLookup:
    def test_payroll_clerk_can_list_names_only(self, db):
        school = make_school("plook")
        make_staff(school, "plook_clerk", ["payroll.view"])
        api = APIClient()
        login(api, "plook_clerk", "staff")
        res = api.get("/api/v1/payroll/staff-lookup/")
        assert res.status_code == 200
        row = res.data["results"][0]
        assert set(row) == {"id", "full_name", "role_name", "status"}
        # the full staff module stays closed to them
        assert api.get("/api/v1/people/staff/").status_code == 403

    def test_without_payroll_grant_denied(self, db):
        school = make_school("plook2")
        make_staff(school, "plook_none", ["students.view"])
        api = APIClient()
        login(api, "plook_none", "staff")
        assert api.get("/api/v1/payroll/staff-lookup/").status_code == 403

    def test_tenant_scoped(self, db):
        school_a = make_school("plooka")
        make_school("plookb")
        make_staff(school_a, "plooka_s", ["payroll.view"])
        api = APIClient()
        login(api, "admin_plookb", "admin")
        assert api.get("/api/v1/payroll/staff-lookup/").data["count"] == 0
