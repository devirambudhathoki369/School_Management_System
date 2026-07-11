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

urlpatterns = router.urls
