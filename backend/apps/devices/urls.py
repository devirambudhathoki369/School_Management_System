from apps.core.routers import ApiRouter

from .views_admin import DeviceUserViewSet, DeviceViewSet, PunchLogViewSet

router = ApiRouter()
router.register("devices", DeviceViewSet, basename="device")
router.register("users", DeviceUserViewSet, basename="device-user")
router.register("logs", PunchLogViewSet, basename="punch-log")

urlpatterns = router.urls
