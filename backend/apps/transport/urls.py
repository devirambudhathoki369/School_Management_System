from apps.core.routers import ApiRouter

from .views import BusStationViewSet, ProximityAlertViewSet, RiderSubscriptionViewSet

router = ApiRouter()
router.register("stations", BusStationViewSet, basename="bus-station")
router.register("riders", RiderSubscriptionViewSet, basename="rider")
router.register("alerts", ProximityAlertViewSet, basename="proximity-alert")

urlpatterns = router.urls
