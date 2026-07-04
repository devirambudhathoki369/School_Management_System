from rest_framework.routers import DefaultRouter

from .views import BusStationViewSet, ProximityAlertViewSet, RiderSubscriptionViewSet

router = DefaultRouter()
router.register("stations", BusStationViewSet, basename="bus-station")
router.register("riders", RiderSubscriptionViewSet, basename="rider")
router.register("alerts", ProximityAlertViewSet, basename="proximity-alert")

urlpatterns = router.urls
