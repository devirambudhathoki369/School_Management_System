"""Family-only gate for the portal surface.

The portal serves the documented family channel (§18.1): guardians see
their linked children, students see themselves. Neither ever passes the
staff module gate (ModulePermissionAllowed denies them by design);
symmetrically, staff and admins never pass this one. The two API surfaces
stay disjoint so neither can be widened by accident.
"""

from rest_framework.permissions import BasePermission

from apps.identity.models import Role

FAMILY_ROLES = frozenset({Role.GUARDIAN, Role.STUDENT})


class IsFamilyPrincipal(BasePermission):
    message = "This area is for guardians and students only."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in FAMILY_ROLES)
