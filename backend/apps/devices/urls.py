from rest_framework.routers import DefaultRouter

from .views_admin import DeviceUserViewSet, DeviceViewSet, PunchLogViewSet

router = DefaultRouter()
router.register("devices", DeviceViewSet, basename="device")
router.register("users", DeviceUserViewSet, basename="device-user")
router.register("logs", PunchLogViewSet, basename="punch-log")

urlpatterns = router.urls
