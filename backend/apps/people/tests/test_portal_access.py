"""Guardian portal-access provisioning: create, reset, revoke, tenancy."""

import pytest
from rest_framework.test import APIClient

from apps.identity.models import Account, Role
from apps.people.models import Guardian
from apps.people.tests.test_tenant_isolation import login, make_school


def make_guardian(school, name="Hari Prasad", contact="9812345678") -> Guardian:
    return Guardian.objects.create(school=school, name=name, contact=contact)


@pytest.mark.django_db
class TestPortalAccessProvisioning:
    def test_provision_creates_guardian_account_with_forced_change(self):
        school = make_school("portal1")
        guardian = make_guardian(school)
        api = APIClient()
        login(api, "admin_portal1", "admin")
        res = api.post(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        assert res.status_code == 201, res.content
        assert res.data["created"] is True
        assert res.data["username"] == "9812345678"  # phone-derived
        guardian.refresh_from_db()
        account = guardian.account
        assert account.role == Role.GUARDIAN
        assert account.verified and account.is_active
        assert account.password_change_required is True
        # The temp credential actually signs in.
        portal = APIClient()
        signin = portal.post(
            "/api/v1/auth/login/",
            {
                "username": res.data["username"],
                "password": res.data["temp_password"],
                "role": "guardian",
            },
        )
        assert signin.status_code == 200, signin.content
        assert signin.data["account"]["password_change_required"] is True
        assert signin.data["account"]["school"]["name"] == school.name

    def test_username_collision_gets_suffix(self):
        school = make_school("portal2")
        first = make_guardian(school, "Aama Devi", "9800000010")
        second = make_guardian(school, "Buwa Ji", "9800000010")  # shared family phone
        api = APIClient()
        login(api, "admin_portal2", "admin")
        res_a = api.post(f"/api/v1/people/guardians/{first.id}/portal-access/")
        res_b = api.post(f"/api/v1/people/guardians/{second.id}/portal-access/")
        assert res_a.data["username"] == "9800000010"
        assert res_b.data["username"] != "9800000010"
        assert res_b.data["username"].startswith("9800000010"[:21])

    def test_no_contact_falls_back_to_name_slug(self):
        school = make_school("portal3")
        guardian = make_guardian(school, "Sita Kumari", contact="")
        api = APIClient()
        login(api, "admin_portal3", "admin")
        res = api.post(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        assert res.status_code == 201
        assert res.data["username"].startswith("sitakumari")

    def test_reprovision_rotates_password_and_kills_sessions(self):
        school = make_school("portal4")
        guardian = make_guardian(school, contact="9800000040")
        api = APIClient()
        login(api, "admin_portal4", "admin")
        first = api.post(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        old_password = first.data["temp_password"]
        portal = APIClient()
        session = portal.post(
            "/api/v1/auth/login/",
            {"username": "9800000040", "password": old_password, "role": "guardian"},
        )
        second = api.post(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        assert second.status_code == 200
        assert second.data["created"] is False
        assert second.data["username"] == "9800000040"  # username is stable
        # Old password dead, old refresh token blacklisted.
        assert APIClient().post(
            "/api/v1/auth/login/",
            {"username": "9800000040", "password": old_password, "role": "guardian"},
        ).status_code == 400
        assert APIClient().post(
            "/api/v1/auth/refresh/", {"refresh": session.data["refresh"]}
        ).status_code == 401
        assert Account.objects.filter(role=Role.GUARDIAN, username="9800000040").count() == 1

    def test_revoke_disables_login_and_reprovision_reactivates(self):
        school = make_school("portal5")
        guardian = make_guardian(school, contact="9800000050")
        api = APIClient()
        login(api, "admin_portal5", "admin")
        api.post(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        res = api.delete(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        assert res.status_code == 204
        guardian.refresh_from_db()
        assert guardian.account.is_active is False
        listed = api.get(f"/api/v1/people/guardians/{guardian.id}/")
        assert listed.data["portal_active"] is False
        assert listed.data["portal_username"] == "9800000050"
        again = api.post(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        assert again.status_code == 200
        guardian.refresh_from_db()
        assert guardian.account.is_active is True

    def test_revoke_without_account_is_a_validation_error(self):
        school = make_school("portal6")
        guardian = make_guardian(school)
        api = APIClient()
        login(api, "admin_portal6", "admin")
        res = api.delete(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        assert res.status_code == 400

    def test_other_schools_admin_cannot_provision(self):
        school_a = make_school("portal7a")
        make_school("portal7b")
        guardian = make_guardian(school_a)
        api = APIClient()
        login(api, "admin_portal7b", "admin")
        res = api.post(f"/api/v1/people/guardians/{guardian.id}/portal-access/")
        assert res.status_code == 404  # invisible across tenants
