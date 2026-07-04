from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import CalendarEvent, DeliveryLog, MessageTemplate, NewsPost, Notice
from .serializers import (
    CalendarEventSerializer,
    DeliveryLogSerializer,
    MessageTemplateSerializer,
    NewsPostSerializer,
    NoticeSerializer,
)

MANAGERS = (Role.ADMIN, Role.STAFF)


class NoticeViewSet(TenantScopedViewSet):
    queryset = Notice.objects.all()
    serializer_class = NoticeSerializer
    allowed_roles = MANAGERS
    permission_code = "communication"

    def get_queryset(self):
        return super().get_queryset().order_by("-date_bs")


class NewsPostViewSet(TenantScopedViewSet):
    queryset = NewsPost.objects.prefetch_related("images")
    serializer_class = NewsPostSerializer
    allowed_roles = MANAGERS
    permission_code = "communication"


class CalendarEventViewSet(TenantScopedViewSet):
    queryset = CalendarEvent.objects.all()
    serializer_class = CalendarEventSerializer
    allowed_roles = MANAGERS
    permission_code = "communication"

    def get_queryset(self):
        qs = super().get_queryset()
        start = self.request.query_params.get("from")
        end = self.request.query_params.get("to")
        if start and end:
            qs = qs.filter(start_date_bs__gte=start, start_date_bs__lte=end)
        return qs.order_by("start_date_bs")


class MessageTemplateViewSet(TenantScopedViewSet):
    queryset = MessageTemplate.objects.all()
    serializer_class = MessageTemplateSerializer
    allowed_roles = MANAGERS
    permission_code = "communication"


class DeliveryLogViewSet(TenantScopedViewSet):
    queryset = DeliveryLog.objects.select_related("recipient")
    serializer_class = DeliveryLogSerializer
    allowed_roles = MANAGERS
    permission_code = "communication"
    http_method_names = ["get", "head", "options"]  # append-only, written by senders

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("recipient", "status"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        return qs.order_by("-sent_at")
