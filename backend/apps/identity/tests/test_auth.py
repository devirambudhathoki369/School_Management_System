"""Smoke tests for the identity foundation: role-scoped accounts and login."""

import pytest
from django.db import IntegrityError
from rest_framework.test import APIClient

from apps.identity.models import Account, Role


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def student_account(db):
    return Account.objects.create_user(
        username="ram123",
        role=Role.STUDENT,
        password="s3cure-pass-99",  # noqa: S106 — test fixture credential
        verified=True,
    )


@pytest.mark.django_db
class TestAccountModel:
    def test_same_username_allowed_across_roles(self):
        """165 legacy usernames exist under multiple roles — this must work."""
        Account.objects.create_user("shared01", Role.STUDENT, "s3cure-pass-99")
        staff = Account.objects.create_user("shared01", Role.STAFF, "s3cure-pass-99")
        assert staff.pk is not None

    def test_same_username_and_role_rejected(self):
        Account.objects.create_user("dup001", Role.STUDENT, "s3cure-pass-99")
        with pytest.raises(IntegrityError):
            Account.objects.create_user("dup001", Role.STUDENT, "other-pass-100")

    def test_uuidv7_pk_assigned_by_database(self, student_account):
        assert student_account.pk is not None
        assert student_account.pk.version == 7

    def test_password_hashed_with_argon2(self, student_account):
        assert student_account.password.startswith("argon2")


@pytest.mark.django_db
class TestLoginAPI:
    URL = "/api/v1/auth/login/"

    def test_login_returns_tokens_and_account(self, api, student_account):
        res = api.post(self.URL, {
            "username": "ram123", "password": "s3cure-pass-99", "role": "student",
        })
        assert res.status_code == 200
        assert set(res.data) == {"access", "refresh", "account"}
        assert res.data["account"]["role"] == "student"

    def test_login_with_wrong_role_fails(self, api, student_account):
        res = api.post(self.URL, {
            "username": "ram123", "password": "s3cure-pass-99", "role": "staff",
        })
        assert res.status_code == 400

    def test_unverified_account_rejected(self, api, db):
        Account.objects.create_user("newkid99", Role.STUDENT, "s3cure-pass-99")
        res = api.post(self.URL, {
            "username": "newkid99", "password": "s3cure-pass-99", "role": "student",
        })
        assert res.status_code == 400

    def test_me_requires_authentication(self, api):
        assert api.get("/api/v1/auth/me/").status_code == 401

    def test_me_returns_current_account(self, api, student_account):
        login = api.post(self.URL, {
            "username": "ram123", "password": "s3cure-pass-99", "role": "student",
        })
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        res = api.get("/api/v1/auth/me/")
        assert res.status_code == 200
        assert res.data["username"] == "ram123"


@pytest.mark.django_db
def test_health_endpoint(api):
    res = api.get("/health/")
    assert res.status_code == 200
    assert res.data["checks"] == {"database": True, "cache": True}
