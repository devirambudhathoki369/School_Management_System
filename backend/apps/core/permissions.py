"""
Server-side authorization primitives.

Deny-by-default: every tenant-scoped view must declare `allowed_roles`.
This replaces the legacy model where `Staff.permissions` only gated the UI
(DOCUMENTATION.md §17.2 — the rebuild's core security fix).
"""

from rest_framework.permissions import BasePermission


class RoleAllowed(BasePermission):
    """Grants access only if the account's role is in the view's allowed_roles."""

    message = "Your role does not permit this operation."

    def has_permission(self, request, view):
        allowed = getattr(view, "allowed_roles", None)
        if not allowed:  # no declaration -> deny (fail closed)
            return False
        user = request.user
        return bool(user and user.is_authenticated and user.role in allowed)
