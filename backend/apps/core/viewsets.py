"""
Tenant-scoped view base: the tenant comes from the authenticated principal.

Every school-owned resource inherits TenantScopedViewSet. The school is
resolved once per request from the JWT principal (never from client data),
used to filter every queryset, and stamped onto every created row.
Deleting is always a soft delete.
"""

from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import ModulePermissionAllowed, RoleAllowed
from apps.tenants.services import resolve_school_for


class TenantScopedViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, RoleAllowed, ModulePermissionAllowed]
    allowed_roles: tuple[str, ...] = ()  # subclasses MUST declare (fail closed)
    permission_code: str = ""            # subclasses MUST declare (fail closed)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        school = resolve_school_for(request.user)
        if school is None:
            raise PermissionDenied("No school is associated with this account.")
        request.school = school

    def get_queryset(self):
        qs = super().get_queryset().filter(school=self.request.school)
        # Deterministic pagination: an unordered queryset repeats/drops rows
        # across pages. UUIDv7 ids are time-ordered, so this is creation
        # order; subclasses may override with their own order_by.
        if not qs.ordered:
            qs = qs.order_by("id")
        return qs

    def perform_create(self, serializer):
        serializer.save(school=self.request.school)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.perform_destroy(instance)
        return Response(status=204)

    def perform_destroy(self, instance):
        instance.soft_delete()
