from apps.core.routers import ApiRouter

from .views import AuditEventViewSet

router = ApiRouter()
router.register("events", AuditEventViewSet, basename="audit-event")

urlpatterns = router.urls
