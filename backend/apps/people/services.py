"""
Login provisioning for guardians (§18.1) and staff.

The school office hands out credentials in person (or over a verified phone
call) — there is no self-signup, because the school is the authority on who
may access its records. Credentials are therefore:

- created by an authorised operator (guardians: ``students.manage``;
  staff logins: the school admin only);
- a temporary password shown exactly once to the operator, never stored in
  plain text anywhere;
- flagged ``password_change_required`` so the holder must set their own
  secret on first login.

Re-provisioning an existing account rotates the password, reactivates the
account and kills every outstanding session (lost-phone recovery).
"""

import re
import secrets

from django.db import IntegrityError, transaction
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.identity.models import Account, Role

from .models import Guardian

USERNAME_MAX = 25
# Unambiguous alphabet (no 0/O, 1/l/I) — these get read out loud and typed
# from a paper slip.
TEMP_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"  # noqa: S105 — an alphabet, not a secret


def _generate_temp_password() -> str:
    return "".join(secrets.choice(TEMP_PASSWORD_ALPHABET) for _ in range(12))


def _username_base(guardian: Guardian) -> str:
    """Prefer the guardian's phone number (memorable, already theirs);
    fall back to a name slug."""
    digits = re.sub(r"\D", "", guardian.contact or "")
    if len(digits) >= 7:
        return digits[-10:]
    slug = re.sub(r"[^a-z0-9]", "", guardian.name.lower())[: USERNAME_MAX - 4]
    return slug or "guardian"


def _available_username(base: str, role: str) -> str:
    candidate = base if len(base) >= 4 else f"{base}{secrets.randbelow(10_000):04d}"
    for _ in range(50):
        if not Account.objects.filter(role=role, username=candidate).exists():
            return candidate
        candidate = f"{base[: USERNAME_MAX - 4]}{secrets.randbelow(10_000):04d}"
    raise RuntimeError("Could not find a free portal username.")  # pragma: no cover


def _revoke_sessions(account: Account) -> None:
    for token in OutstandingToken.objects.filter(user=account):
        BlacklistedToken.objects.get_or_create(token=token)


def _provision(profile, *, role: str, username_base: str, email: str) -> tuple[Account, str, bool]:
    """Create or reset the login linked to `profile` (any model with a
    nullable 1:1 `account`). Returns (account, temp_password, created); the
    temp password exists only in this return value — the caller shows it
    once and discards it. Re-provisioning rotates the password, reactivates
    the account and kills every outstanding session."""
    temp_password = _generate_temp_password()
    with transaction.atomic():
        account = profile.account
        if account is not None:
            account.set_password(temp_password)
            account.is_active = True
            account.password_change_required = True
            account.save(
                update_fields=[
                    "password", "is_active", "password_change_required", "updated_at",
                ]
            )
            _revoke_sessions(account)
            return account, temp_password, False
        for _ in range(3):  # username uniqueness can race; retry with a fresh pick
            try:
                with transaction.atomic():
                    account = Account.objects.create_user(
                        _available_username(username_base, role),
                        role,
                        temp_password,
                        email=email,
                        verified=True,
                        password_change_required=True,
                    )
                break
            except IntegrityError:
                account = None
        if account is None:
            raise RuntimeError("Could not provision a portal account.")  # pragma: no cover
        profile.account = account
        profile.save(update_fields=["account", "updated_at"])
    return account, temp_password, True


def _revoke(profile) -> bool:
    """Disable the profile's login and end its sessions. The account row
    stays (audit trail + username reservation); re-provisioning reactivates."""
    account = profile.account
    if account is None:
        return False
    with transaction.atomic():
        account.is_active = False
        account.save(update_fields=["is_active", "updated_at"])
        _revoke_sessions(account)
    return True


def provision_portal_access(guardian: Guardian) -> tuple[Account, str, bool]:
    """Create or reset a guardian's portal login."""
    return _provision(
        guardian,
        role=Role.GUARDIAN,
        username_base=_username_base(guardian),
        email=guardian.email or "",
    )


def provision_staff_access(staff) -> tuple[Account, str, bool]:
    """Create or reset a staff member's console login. Same ceremony as the
    guardian portal: temp password shown once, forced change on first use."""
    slug = re.sub(
        r"[^a-z0-9]", "", f"{staff.first_name}{staff.last_name}".lower()
    )[: USERNAME_MAX - 4]
    return _provision(
        staff, role=Role.STAFF, username_base=slug or "staff", email=staff.email or ""
    )


def revoke_staff_access(staff) -> bool:
    return _revoke(staff)


def revoke_portal_access(guardian: Guardian) -> bool:
    return _revoke(guardian)
