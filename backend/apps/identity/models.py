"""
Unified account model replacing the legacy per-role account tables.

Usernames are unique per (role, username) — NOT globally. The legacy data has
165 usernames that exist under more than one role, and login has always been
role-scoped in the product (per-role signin endpoints, separate apps). The
RoleAwareBackend and the login API therefore always authenticate with an
explicit role.

A profile (student/staff/school) links to its account with a nullable 1:1
from the profile side, preserving legacy invariant I2: a profile may exist
without a login and gain one later.
"""

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.core.validators import MinLengthValidator
from django.db import models

from apps.core.models import UUIDv7Field


class Role(models.TextChoices):
    SUPER_ADMIN = "super_admin", "Super Admin"   # vendor onboarding staff
    ADMIN = "admin", "School Admin"              # the tenant
    STAFF = "staff", "Staff"
    STUDENT = "student", "Student"
    GUARDIAN = "guardian", "Guardian"            # new in this platform (§18.1)


class AccountManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, username: str, role: str, password: str | None = None, **extra):
        if not username:
            raise ValueError("username is required")
        if role not in Role.values:
            raise ValueError(f"invalid role: {role}")
        account = self.model(username=username, role=role, **extra)
        account.set_password(password)
        account.save(using=self._db)
        return account

    def create_superuser(self, username: str, password: str, **extra):
        extra.setdefault("role", Role.SUPER_ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("verified", True)
        return self.create_user(username=username, password=password, **extra)


class Account(AbstractBaseUser, PermissionsMixin):
    id = UUIDv7Field()
    username = models.CharField(max_length=25, validators=[MinLengthValidator(4)])
    role = models.CharField(max_length=12, choices=Role.choices, db_index=True)
    email = models.EmailField(blank=True, default="")
    verified = models.BooleanField(default=False)
    # Admin-provisioned credentials (e.g. guardian portal access) ship with a
    # temporary password; the holder must set their own before normal use.
    password_change_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django admin access only
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ETL provenance: which legacy account table/row this came from
    legacy_table = models.CharField(max_length=40, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True)

    objects = AccountManager()

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = []  # role is defaulted by create_superuser

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["role", "username"], name="uniq_role_username"),
        ]
        indexes = [models.Index(fields=["username"])]

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"
