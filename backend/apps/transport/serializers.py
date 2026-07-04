from rest_framework import serializers

from apps.billing.serializers import TenantChildValidationMixin

from .models import BusStation, ProximityAlert, RiderSubscription


class BusStationSerializer(serializers.ModelSerializer):
    rider_count = serializers.IntegerField(source="riders.count", read_only=True)

    class Meta:
        model = BusStation
        fields = ["id", "name", "fee", "latitude", "longitude", "rider_count"]
        read_only_fields = ["id"]


class RiderSubscriptionSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("student", "bus_station")
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    station_name = serializers.CharField(source="bus_station.name", read_only=True)

    class Meta:
        model = RiderSubscription
        fields = [
            "id", "student", "student_name", "bus_station", "station_name",
            "start_date_bs", "remarks",
        ]
        read_only_fields = ["id"]


class ProximityAlertSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("student", "staff")

    class Meta:
        model = ProximityAlert
        fields = [
            "id", "bus_number", "student", "staff", "latitude", "longitude",
            "alert_range", "alerted_date",
        ]
        read_only_fields = ["id", "alerted_date"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get("student") is None and attrs.get("staff") is None:
            raise serializers.ValidationError("An alert needs a subscriber.")
        return attrs
