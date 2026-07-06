"""
Server-side authorization: roles + per-school module permissions.

Deny-by-default at two levels (DOCUMENTATION.md §17.2/§17.3):

1. Role gate — every tenant-scoped view declares `allowed_roles`.
2. Module gate — every tenant-scoped view declares `permission_code`.
   Admins implicitly hold every permission for their own school. Staff hold
   exactly the codes granted on their profile (managed by the school admin),
   split into `<module>.view` (read) and `<module>.manage` (write); manage
   implies view. Anything undeclared or ungranted is denied.

Legacy note: imported staff carry the old numeric permission codes; those
grant nothing here until translated/assigned — new-system access is opt-in.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.identity.models import Role

# Catalog of grantable modules. Serializers validate grants against this and
# the frontend renders the admin's permission-management UI from it.
PERMISSION_MODULES: dict[str, str] = {
    "students": "Students & guardians",
    "staff": "Staff records",
    "academics": "Academic structure (years, classes, subjects)",
    "examinations": "Examinations & results",
    "homework": "Homework",
    "attendance": "Attendance",
    "devices": "RFID / biometric devices",
    "billing": "Fees, billing & dues",
    "payroll": "Staff payroll",
    "accounting": "Double-entry accounting",
    "library": "Library",
    "transport": "Transport",
    "communication": "Notices, SMS & push",
    "inventory": "Inventory",
    "reports": "Dashboards & reports",
}

READ_ACTIONS = frozenset({"list", "retrieve"})


def permission_codes() -> list[str]:
    return [f"{m}.{kind}" for m in PERMISSION_MODULES for kind in ("view", "manage")]


class RoleAllowed(BasePermission):
    """Grants access only if the account's role is in the view's allowed_roles."""

    message = "Your role does not permit this operation."

    def has_permission(self, request, view):
        allowed = getattr(view, "allowed_roles", None)
        if not allowed:  # no declaration -> deny (fail closed)
            return False
        user = request.user
        return bool(user and user.is_authenticated and user.role in allowed)


class ModulePermissionAllowed(BasePermission):
    """
    Per-school module permission for staff; admins pass within their school.

    Views declare `permission_code` (a key of PERMISSION_MODULES). Read
    actions need `<code>.view` or `<code>.manage`; write actions need
    `<code>.manage`.
    """

    message = "You have not been granted access to this module."

    def has_permission(self, request, view):
        code = getattr(view, "permission_code", None)
        if not code:  # undeclared -> deny (fail closed)
            return False
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.role == Role.ADMIN:
            return True
        if user.role != Role.STAFF:
            # Students/guardians never pass the module gate; their access is
            # via dedicated self-service endpoints with own-record scoping.
            return False
        profile = getattr(user, "staff_profile", None)
        if profile is None:
            return False
        granted = set(profile.permissions or [])
        # Viewsets expose .action; plain APIViews fall back to the HTTP
        # method. Anything unrecognised stays a write (fail closed).
        action = getattr(view, "action", None)
        is_read = action in READ_ACTIONS if action else request.method in SAFE_METHODS
        needed = (
            {f"{code}.view", f"{code}.manage"} if is_read else {f"{code}.manage"}
        )
        return bool(granted & needed)
