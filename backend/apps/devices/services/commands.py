"""Device command queue (server -> device, delivered via /iclock/getrequest)."""

import secrets

from django.db import transaction
from django.utils import timezone

from apps.devices.models import Device, DeviceCommand


def enqueue(device: Device, content: str) -> DeviceCommand:
    return DeviceCommand.objects.create(
        device=device, cmd_id=secrets.token_hex(8), cmd_content=content
    )


def pop_pending(device: Device, limit: int = 10) -> list[DeviceCommand]:
    with transaction.atomic():
        rows = list(
            DeviceCommand.objects.select_for_update(skip_locked=True)
            .filter(device=device, status=DeviceCommand.Status.PENDING)
            .order_by("created_at")[:limit]
        )
        if rows:
            DeviceCommand.objects.filter(pk__in=[c.pk for c in rows]).update(
                status=DeviceCommand.Status.SENT, sent_at=timezone.now()
            )
        return rows


def enqueue_pull_attlog(
    device: Device, start: str | None = None, end: str | None = None
) -> DeviceCommand:
    """Ask the device to re-upload buffered punches for a window (device-local
    'YYYY-MM-DD HH:MM:SS'); idempotent ingest dedupes anything re-sent."""
    cmd = "DATA QUERY ATTLOG"
    if start:
        cmd += f" StartTime={start}"
    if end:
        cmd += f"\tEndTime={end}"
    return enqueue(device, cmd + "\r\n")


def mark_done(cmd_id: str, return_code: int, raw_line: str) -> None:
    status = (
        DeviceCommand.Status.DONE if return_code >= 0 else DeviceCommand.Status.FAILED
    )
    DeviceCommand.objects.filter(cmd_id=cmd_id).update(
        status=status,
        return_code=return_code,
        return_info=raw_line,
        finished_at=timezone.now(),
    )
