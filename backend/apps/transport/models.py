"""Transport: bus stations (with the per-station fee billing resolves as
the 'tn' transport line), rider subscriptions (legacy
main_studenttransportationinfo — a people satellite that is really a
transport concern) and bus-proximity alerts (ephemeral operational data,
migrated for continuity; a retention job trims it)."""

from django.db import models

from apps.core.models import TenantScopedModel
from apps.people.models import Staff, Student


class BusStation(TenantScopedModel):
    name = models.CharField(max_length=50)
    fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    latitude = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True)
    longitude = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class RiderSubscription(TenantScopedModel):
    """A student riding from a station (drives the transport fee + discount
    resolution in billing)."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="rides")
    # X2 delete-guard: a station with riders cannot be deleted
    bus_station = models.ForeignKey(
        BusStation, null=True, blank=True, on_delete=models.PROTECT, related_name="riders"
    )
    start_date_bs = models.CharField(max_length=10, blank=True, default="")
    remarks = models.CharField(max_length=50, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [models.Index(fields=["school", "student"])]

    def __str__(self):
        return f"{self.student} @ {self.bus_station}"


class ProximityAlert(TenantScopedModel):
    """'Alert me when the bus is near' subscription (student or staff)."""

    bus_number = models.PositiveIntegerField()
    student = models.ForeignKey(
        Student, null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    staff = models.ForeignKey(
        Staff, null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    latitude = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True)
    longitude = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True)
    alert_range = models.PositiveIntegerField(default=0)  # metres
    alerted_date = models.DateField(null=True, blank=True)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return f"Bus {self.bus_number} -> {self.student or self.staff}"
