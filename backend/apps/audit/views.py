from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import AuditEvent
from .serializers import AuditEventSerializer


class AuditEventViewSet(TenantScopedViewSet):
    """School-scoped audit trail, admins only (staff never see the log)."""

    queryset = AuditEvent.objects.select_related("actor")
    serializer_class = AuditEventSerializer
    allowed_roles = (Role.ADMIN,)
    permission_code = "reports"
    http_method_names = ["get", "head", "options"]  # append-only

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("actor", "action", "object_table", "object_id"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        return qs.order_by("-at")
