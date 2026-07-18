from apps.core.routers import ApiRouter

from .views import (
    CalendarEventViewSet,
    DeliveryLogViewSet,
    MessageTemplateViewSet,
    NewsPostViewSet,
    NoticeViewSet,
)

router = ApiRouter()
router.register("notices", NoticeViewSet, basename="notice")
router.register("news", NewsPostViewSet, basename="news-post")
router.register("calendar", CalendarEventViewSet, basename="calendar-event")
router.register("templates", MessageTemplateViewSet, basename="message-template")
router.register("delivery-log", DeliveryLogViewSet, basename="delivery-log")

from .views import SlideImageViewSet  # noqa: E402

router.register("slides", SlideImageViewSet, basename="slide-image")

from django.urls import path

from .sms_views import DuesReminderSMSView, SendSMSView

urlpatterns = [
    path("sms/send/", SendSMSView.as_view(), name="sms-send"),
    path("sms/dues-reminder/", DuesReminderSMSView.as_view(), name="sms-dues-reminder"),
    *router.urls,
]
