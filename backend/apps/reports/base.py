"""
Shared plumbing for the report endpoints (legacy "Reports" menu port).

Every report is a read-only GET view gated by the *owning module's*
permission code — the same rule the dashboard applies to its blocks — so a
report can never reach data its viewer could not open through the module
itself. The school always comes from the authenticated principal (I1).

Registers are capped at ROW_CAP rows per response; summaries/totals are
always aggregated over the FULL queryset so a truncated table still shows
correct grand totals.
"""

import re

from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.core.permissions import ModulePermissionAllowed, RoleAllowed
from apps.identity.models import Role
from apps.tenants.services import resolve_school_for

ROW_CAP = 2000
BS_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ReportView(APIView):
    permission_classes = [IsAuthenticated, RoleAllowed, ModulePermissionAllowed]
    allowed_roles = (Role.ADMIN, Role.STAFF)

    def school(self, request):
        school = resolve_school_for(request.user)
        if school is None:
            raise PermissionDenied("No school is associated with this account.")
        return school

    def bs_date(self, request, name: str, required: bool = False) -> str | None:
        value = request.query_params.get(name)
        if not value:
            if required:
                raise ValidationError({name: "This BS date is required."})
            return None
        if not BS_DATE.match(value):
            raise ValidationError({name: "Use the YYYY-MM-DD BS format."})
        return value

    def bs_range(self, request) -> tuple[str | None, str | None]:
        """Both bounds or neither — a half-open range silently matching
        everything is how legacy reports produced misleading sheets."""
        from_bs = self.bs_date(request, "from_bs")
        to_bs = self.bs_date(request, "to_bs")
        if (from_bs is None) != (to_bs is None):
            raise ValidationError({"from_bs": "Provide both from_bs and to_bs, or neither."})
        if from_bs and to_bs and from_bs > to_bs:
            raise ValidationError({"from_bs": "from_bs must not be after to_bs."})
        return from_bs, to_bs


def actor_label(account) -> str:
    """Human name for a created_by account: staff name, else username."""
    if account is None:
        return ""
    staff = getattr(account, "staff_profile", None)
    if staff is not None:
        return staff.full_name
    return account.username
