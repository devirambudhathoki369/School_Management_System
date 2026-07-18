from django.urls import path

from apps.core.routers import ApiRouter

from .sms_views import DuesReminderSMSView, SendSMSView
from .views import (
    CalendarEventViewSet,
    DeliveryLogViewSet,
    MessageTemplateViewSet,
    NewsPostViewSet,
    NoticeViewSet,
    SlideImageViewSet,
)

router = ApiRouter()
router.register("notices", NoticeViewSet, basename="notice")
router.register("news", NewsPostViewSet, basename="news-post")
router.register("calendar", CalendarEventViewSet, basename="calendar-event")
router.register("templates", MessageTemplateViewSet, basename="message-template")
router.register("delivery-log", DeliveryLogViewSet, basename="delivery-log")
router.register("slides", SlideImageViewSet, basename="slide-image")

urlpatterns = [
    path("sms/send/", SendSMSView.as_view(), name="sms-send"),
    path("sms/dues-reminder/", DuesReminderSMSView.as_view(), name="sms-dues-reminder"),
    *router.urls,
]
