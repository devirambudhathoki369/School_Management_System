"""Guardian-only gate for the portal surface.

Guardians never pass the staff module gate (ModulePermissionAllowed denies
them by design); symmetrically, staff and admins never pass this one. The
two API surfaces stay disjoint so neither can be widened by accident.
"""

from rest_framework.permissions import BasePermission

from apps.identity.models import Role


class IsGuardian(BasePermission):
    message = "This area is for guardians only."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == Role.GUARDIAN)
