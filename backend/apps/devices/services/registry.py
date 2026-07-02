"""
Device registry: liveness, counters, stamps, offline auto-recovery.

Hardened vs legacy: `touch` only accepts PRE-REGISTERED serials (AT4 /
§17.2). The legacy get_or_create auto-provisioned unknown hardware, letting
any device with a guessed URL feed a school's attendance.
"""

from datetime import timedelta

from django.utils import timezone

from apps.core.dates import NEPAL_TZ
from apps.devices.models import Device, DeviceCommand
from apps.devices.services import commands

# A device silent for at least this long, then reconnecting, is treated as
# "was offline": we auto-ask it to re-upload the punches it buffered.
AUTO_PULL_GAP = timedelta(hours=1)


def touch(serial: str, request) -> Device | None:
    """Mark a registered device alive; returns None for unknown serials."""
    device = Device.all_objects.filter(serial_number=serial, is_active=True).first()
    if device is None:
        return None
    ip = request.META.get("REMOTE_ADDR")
    prev_last_seen = device.last_seen
    Device.all_objects.filter(pk=device.pk).update(
        ip_address=ip or device.ip_address,
        last_seen=timezone.now(),
        state=Device.State.ONLINE,
    )
    device.refresh_from_db()
    _auto_recover_logs(device, prev_last_seen)
    return device


def _auto_recover_logs(device: Device, prev_last_seen) -> None:
    """Queue a DATA QUERY ATTLOG for the offline window after a reconnect;
    idempotent ingest makes the re-upload safe, and we skip if one is
    already pending so polls don't pile up duplicate commands."""
    if not prev_last_seen or (timezone.now() - prev_last_seen) < AUTO_PULL_GAP:
        return
    already_queued = DeviceCommand.objects.filter(
        device=device,
        status=DeviceCommand.Status.PENDING,
        cmd_content__startswith="DATA QUERY ATTLOG",
    ).exists()
    if already_queued:
        return
    start_local = prev_last_seen.astimezone(NEPAL_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    commands.enqueue_pull_attlog(
        device,
        start=start_local.strftime("%Y-%m-%d %H:%M:%S"),
        end=timezone.now().astimezone(NEPAL_TZ).strftime("%Y-%m-%d %H:%M:%S"),
    )


def update_stamp(device: Device, table: str, stamp: str | None) -> None:
    attr = {"ATTLOG": "attlog_stamp", "OPERLOG": "operlog_stamp",
            "ATTPHOTO": "photo_stamp"}.get(table)
    if attr and stamp:
        setattr(device, attr, stamp)
        device.save(update_fields=[attr])


def update_counters(device: Device, info: str) -> None:
    """INFO is comma-separated: firmware, users, fp, trans, ip, ..., faces."""
    parts = info.split(",")
    if len(parts) >= 1:
        device.firmware = parts[0]
    if len(parts) >= 2 and parts[1].isdigit():
        device.user_count = int(parts[1])
    if len(parts) >= 3 and parts[2].isdigit():
        device.fp_count = int(parts[2])
    if len(parts) >= 4 and parts[3].isdigit():
        device.trans_count = int(parts[3])
    if len(parts) >= 5:
        device.ip_address = parts[4] or device.ip_address
    if len(parts) >= 9 and parts[8].isdigit():
        device.face_count = int(parts[8])
    device.save()
