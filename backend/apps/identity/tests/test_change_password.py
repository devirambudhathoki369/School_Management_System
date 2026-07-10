"""Self-service password change: validation, session revocation, forced-change flag."""

import pytest
from rest_framework.test import APIClient

from apps.identity.models import Account, Role

PASSWORD = "s3cure-pass-99"  # noqa: S105 — test-only credential
NEW_PASSWORD = "brand-new-pass-42"  # noqa: S105


def make_account(username: str, role: str = Role.ADMIN, **extra) -> Account:
    return Account.objects.create_user(username, role, PASSWORD, verified=True, **extra)


def login(api: APIClient, username: str, role: str, password: str = PASSWORD) -> dict:
    res = api.post(
        "/api/v1/auth/login/", {"username": username, "password": password, "role": role}
    )
    assert res.status_code == 200, res.content
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
    return res.data


@pytest.mark.django_db
class TestChangePassword:
    def test_change_clears_forced_flag_and_returns_fresh_session(self):
        make_account("pw_user1", password_change_required=True)
        api = APIClient()
        payload = login(api, "pw_user1", "admin")
        assert payload["account"]["password_change_required"] is True
        res = api.post(
            "/api/v1/auth/change-password/",
            {"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert res.status_code == 200, res.content
        assert res.data["account"]["password_change_required"] is False
        assert "access" in res.data and "refresh" in res.data
        # New credential works; old one is dead.
        fresh = APIClient()
        assert fresh.post(
            "/api/v1/auth/login/",
            {"username": "pw_user1", "password": NEW_PASSWORD, "role": "admin"},
        ).status_code == 200
        assert fresh.post(
            "/api/v1/auth/login/",
            {"username": "pw_user1", "password": PASSWORD, "role": "admin"},
        ).status_code == 400

    def test_change_revokes_every_other_refresh_token(self):
        make_account("pw_user2")
        api = APIClient()
        other_session = login(api, "pw_user2", "admin")
        api2 = APIClient()
        login(api2, "pw_user2", "admin")
        res = api2.post(
            "/api/v1/auth/change-password/",
            {"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert res.status_code == 200
        # The pre-change refresh token is blacklisted…
        stale = APIClient().post(
            "/api/v1/auth/refresh/", {"refresh": other_session["refresh"]}
        )
        assert stale.status_code == 401
        # …while the pair returned by the change endpoint still works.
        live = APIClient().post("/api/v1/auth/refresh/", {"refresh": res.data["refresh"]})
        assert live.status_code == 200

    def test_wrong_current_password_rejected(self):
        make_account("pw_user3")
        api = APIClient()
        login(api, "pw_user3", "admin")
        res = api.post(
            "/api/v1/auth/change-password/",
            {"current_password": "not-the-password", "new_password": NEW_PASSWORD},
        )
        assert res.status_code == 400
        assert "current_password" in res.data["error"]["details"]

    def test_weak_or_unchanged_password_rejected(self):
        make_account("pw_user4")
        api = APIClient()
        login(api, "pw_user4", "admin")
        weak = api.post(
            "/api/v1/auth/change-password/",
            {"current_password": PASSWORD, "new_password": "short"},
        )
        assert weak.status_code == 400
        same = api.post(
            "/api/v1/auth/change-password/",
            {"current_password": PASSWORD, "new_password": PASSWORD},
        )
        assert same.status_code == 400

    def test_anonymous_denied(self):
        res = APIClient().post(
            "/api/v1/auth/change-password/",
            {"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert res.status_code == 401
