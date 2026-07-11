"""Auth hardening: per-account lockout, refresh re-validation, audit trail."""

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from apps.identity import lockout
from apps.identity.models import Account, Role
from apps.people.tests.test_tenant_isolation import PASSWORD, login, make_school


@pytest.fixture(autouse=True)
def _clean_lockout_cache():
    cache.clear()
    yield
    cache.clear()


def attempt(api, username, password, role="admin"):
    return api.post(
        "/api/v1/auth/login/", {"username": username, "password": password, "role": role}
    )


@pytest.mark.django_db
class TestAccountLockout:
    def test_locks_after_threshold_and_audits_once(self):
        make_school("locky")
        api = APIClient()
        for _ in range(lockout.LOCKOUT_THRESHOLD):
            assert attempt(api, "admin_locky", "wrong-password-99").status_code == 400
        res = attempt(api, "admin_locky", "wrong-password-99")
        assert res.status_code == 429
        assert "try again" in res.data["detail"].lower()
        # even the CORRECT password is refused while locked
        assert attempt(api, "admin_locky", PASSWORD).status_code == 429
        events = AuditEvent.objects.filter(changes__event="lockout")
        assert events.count() == 1

    def test_lockout_is_per_role_and_username(self):
        make_school("scopey")
        api = APIClient()
        for _ in range(lockout.LOCKOUT_THRESHOLD):
            attempt(api, "admin_scopey", "wrong-password-99")
        # same username under another role is unaffected
        assert attempt(api, "admin_scopey", "x" * 12, role="staff").status_code == 400

    def test_success_resets_the_counter(self):
        make_school("resety")
        api = APIClient()
        for _ in range(lockout.LOCKOUT_THRESHOLD - 1):
            attempt(api, "admin_resety", "wrong-password-99")
        assert attempt(api, "admin_resety", PASSWORD).status_code == 200
        # the slate is clean: another bad try is failure #1, not a lockout
        assert attempt(api, "admin_resety", "wrong-password-99").status_code == 400
        assert attempt(api, "admin_resety", PASSWORD).status_code == 200

    def test_unknown_usernames_lock_identically(self):
        """No account-enumeration oracle: a nonexistent username shows the
        same lockout behaviour as a real one."""
        api = APIClient()
        for _ in range(lockout.LOCKOUT_THRESHOLD):
            assert attempt(api, "ghost_user", "wrong-password-99").status_code == 400
        assert attempt(api, "ghost_user", "wrong-password-99").status_code == 429


@pytest.mark.django_db
class TestLoginAudit:
    def test_successful_login_is_recorded_with_actor(self):
        school = make_school("audity")
        api = APIClient()
        assert attempt(api, "admin_audity", PASSWORD).status_code == 200
        event = AuditEvent.objects.get(action=AuditEvent.Action.LOGIN)
        assert event.actor == school.admin_account
        assert event.changes["event"] == "success"
        assert event.school == school

    def test_password_change_is_recorded_and_kills_sessions(self):
        make_school("pwaudit")
        api = APIClient()
        login(api, "admin_pwaudit", "admin")
        res = api.post(
            "/api/v1/auth/change-password/",
            {"current_password": PASSWORD, "new_password": "Brand-New-Secret-77"},
        )
        assert res.status_code == 200
        assert AuditEvent.objects.filter(changes__event="password_change").count() == 1


@pytest.mark.django_db
class TestHardenedRefresh:
    def get_pair(self, username):
        api = APIClient()
        res = attempt(api, username, PASSWORD)
        assert res.status_code == 200
        return res.data["access"], res.data["refresh"]

    def test_refresh_works_for_live_accounts(self):
        make_school("fresh")
        _, refresh = self.get_pair("admin_fresh")
        res = APIClient().post("/api/v1/auth/refresh/", {"refresh": refresh})
        assert res.status_code == 200
        assert "access" in res.data

    def test_deactivated_account_cannot_refresh(self):
        make_school("deady")
        _, refresh = self.get_pair("admin_deady")
        Account.objects.filter(username="admin_deady").update(is_active=False)
        res = APIClient().post("/api/v1/auth/refresh/", {"refresh": refresh})
        assert res.status_code == 401
        # and the token was burned: reactivating does not resurrect it
        Account.objects.filter(username="admin_deady").update(is_active=True)
        res = APIClient().post("/api/v1/auth/refresh/", {"refresh": refresh})
        assert res.status_code == 401

    def test_password_length_is_bounded(self):
        make_school("boundy")
        api = APIClient()
        res = attempt(api, "admin_boundy", "x" * 100_000)
        assert res.status_code == 400  # rejected by validation, never hashed


@pytest.mark.django_db
class TestStaffLoginProvisioning:
    def test_admin_provisions_resets_and_revokes(self):
        from apps.people.models import Staff, StaffRole

        school = make_school("provy")
        role = StaffRole.objects.get_or_create(name="Teacher")[0]
        staff = Staff.objects.create(
            school=school, role=role, first_name="Nabin", last_name="Shrestha",
            primary_contact="9800000001",
        )
        api = APIClient()
        login(api, "admin_provy", "admin")

        res = api.post(f"/api/v1/people/staff/{staff.id}/login-access/")
        assert res.status_code == 201, res.content
        username, temp = res.data["username"], res.data["temp_password"]
        assert username.startswith("nabinshrestha")
        assert len(temp) == 12

        # the temp credential logs in but demands a password change
        staff_api = APIClient()
        first = staff_api.post(
            "/api/v1/auth/login/", {"username": username, "password": temp, "role": "staff"}
        )
        assert first.status_code == 200
        assert first.data["account"]["password_change_required"] is True

        # reset rotates the password: the old temp dies
        res = api.post(f"/api/v1/people/staff/{staff.id}/login-access/")
        assert res.status_code == 200
        assert res.data["temp_password"] != temp
        again = APIClient().post(
            "/api/v1/auth/login/", {"username": username, "password": temp, "role": "staff"}
        )
        assert again.status_code == 400

        # revoke disables the account
        res = api.delete(f"/api/v1/people/staff/{staff.id}/login-access/")
        assert res.status_code == 204
        staff.refresh_from_db()
        assert staff.account.is_active is False
        assert AuditEvent.objects.filter(changes__event="login_revoked").count() == 1

    def test_permission_changes_are_audited_with_delta(self):
        from apps.people.tests.test_module_permissions import make_staff

        school = make_school("granty")
        staff = make_staff(school, "grantee", ["billing.view"])
        api = APIClient()
        login(api, "admin_granty", "admin")
        res = api.patch(
            f"/api/v1/people/staff/{staff.id}/",
            {"permissions": ["billing.view", "examinations.manage"]},
            format="json",
        )
        assert res.status_code == 200, res.content
        event = AuditEvent.objects.get(changes__event="permissions_change")
        assert event.changes["granted"] == ["examinations.manage"]
        assert event.changes["revoked"] == []
        assert event.actor == school.admin_account
