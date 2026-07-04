from rest_framework.exceptions import ValidationError

from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import BusStation, ProximityAlert, RiderSubscription
from .serializers import (
    BusStationSerializer,
    ProximityAlertSerializer,
    RiderSubscriptionSerializer,
)

MANAGERS = (Role.ADMIN, Role.STAFF)


class BusStationViewSet(TenantScopedViewSet):
    queryset = BusStation.objects.all()
    serializer_class = BusStationSerializer
    allowed_roles = MANAGERS
    permission_code = "transport"

    def get_queryset(self):
        return super().get_queryset().order_by("name")

    def perform_destroy(self, instance):
        # X2: a station with riders can never be deleted
        if instance.riders.exists():
            raise ValidationError("Station has riders; move them first (X2).")
        super().perform_destroy(instance)


class RiderSubscriptionViewSet(TenantScopedViewSet):
    queryset = RiderSubscription.objects.select_related("student", "bus_station")
    serializer_class = RiderSubscriptionSerializer
    allowed_roles = MANAGERS
    permission_code = "transport"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("student", "bus_station"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        return qs


class ProximityAlertViewSet(TenantScopedViewSet):
    queryset = ProximityAlert.objects.select_related("student", "staff")
    serializer_class = ProximityAlertSerializer
    allowed_roles = MANAGERS
    permission_code = "transport"
