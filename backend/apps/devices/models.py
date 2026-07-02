"""
RFID/biometric attendance devices (ZKTeco-style push protocol, /iclock/*).

Hardening over legacy (DOCUMENTATION.md §17.2, invariant AT4): devices must
be PRE-REGISTERED (created by the vendor/school with a serial + school);
the legacy server auto-created unknown devices on first contact, which let
any device impersonate a school. Unknown serials are now rejected.
"""

from django.db import models

from apps.core.models import TenantScopedModel
from apps.people.models import Staff, Student


class Device(TenantScopedModel):
    class State(models.TextChoices):
        REGISTERED = "registered", "Registered"
        CONNECTING = "connecting", "Connecting"
        ONLINE = "online", "Online"

    serial_number = models.CharField(max_length=32, unique=True)
    alias = models.CharField(max_length=64, blank=True, default="")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    firmware = models.CharField(max_length=64, blank=True, default="")
    push_version = models.CharField(max_length=16, blank=True, default="")
    device_type = models.CharField(max_length=32, blank=True, default="")
    push_comm_key = models.CharField(max_length=64, blank=True, default="")
    timezone_min = models.IntegerField(default=345)  # Nepal = UTC+5:45
    real_time = models.BooleanField(default=True)
    state = models.CharField(max_length=16, choices=State.choices, default=State.REGISTERED)
    last_seen = models.DateTimeField(null=True, blank=True)
    attlog_stamp = models.CharField(max_length=32, default="None")
    operlog_stamp = models.CharField(max_length=32, default="None")
    photo_stamp = models.CharField(max_length=32, default="None")
    user_count = models.IntegerField(default=0)
    fp_count = models.IntegerField(default=0)
    face_count = models.IntegerField(default=0)
    trans_count = models.IntegerField(default=0)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return f"{self.alias or self.serial_number} ({self.school})"


class DeviceCommand(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"

    id = models.BigAutoField(primary_key=True)
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="commands")
    cmd_id = models.CharField(max_length=16, unique=True)
    cmd_content = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    return_code = models.IntegerField(null=True, blank=True)
    return_info = models.TextField(blank=True, default="")

    class Meta:
        indexes = [models.Index(fields=["device", "status"])]

    def __str__(self):
        return f"{self.cmd_id}: {self.cmd_content[:40]}"


class DeviceUser(TenantScopedModel):
    """A person enrolled on a device (pin/card), linked to a profile."""

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="users")
    pin = models.CharField(max_length=24)
    privilege = models.IntegerField(default=0)
    password = models.CharField(max_length=16, blank=True, default="")
    card = models.CharField(max_length=32, blank=True, default="")
    group_id = models.IntegerField(default=1)
    tz_str = models.CharField(max_length=32, blank=True, default="")
    verify = models.IntegerField(default=-1)
    student = models.ForeignKey(
        Student, null=True, blank=True, on_delete=models.SET_NULL, related_name="device_users"
    )
    staff = models.ForeignKey(
        Staff, null=True, blank=True, on_delete=models.SET_NULL, related_name="device_users"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["device", "pin"], name="uniq_device_pin"),
        ]

    def __str__(self):
        return f"pin {self.pin} on {self.device}"


class PunchLog(models.Model):
    """Raw punches; deduped on (user, punch_time, status, verify) — AT4."""

    class PunchStatus(models.IntegerChoices):
        CHECK_IN = 0
        CHECK_OUT = 1
        BREAK_OUT = 2
        BREAK_IN = 3
        OT_IN = 4
        OT_OUT = 5
        PUNCH = 255

    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(
        DeviceUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="punches"
    )
    punch_time = models.DateTimeField(db_index=True)
    status = models.IntegerField(default=0)
    verify = models.IntegerField(default=0)
    workcode = models.IntegerField(default=0)
    received_at = models.DateTimeField(auto_now_add=True)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "punch_time", "status", "verify"], name="uniq_punch"
            ),
        ]

    def __str__(self):
        return f"{self.user} @ {self.punch_time}"
