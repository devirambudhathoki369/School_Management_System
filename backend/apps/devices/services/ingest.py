"""Ingest device pushes: punches (ATTLOG) and user enrolments (OPERLOG)."""

from django.db import transaction

from apps.attendance.services import process_punches
from apps.devices.models import DeviceUser, PunchLog
from apps.devices.services.parsers import parse_attlog, parse_operlog


def ingest_attlog(device, body: bytes) -> int:
    """
    Store punches, then derive attendance (AT1–AT3) in one transaction.

    Pins resolve only against THIS device's school (legacy matched pins
    globally — a cross-tenant leak). Exact resends dedupe on the
    (user, punch_time, status, verify) unique key. Every record the device
    sent is acknowledged so it doesn't resend "failed" ones.
    """
    records = list(parse_attlog(body))
    if not records:
        return 0

    users = {
        u.pin: u
        for u in DeviceUser.objects.filter(
            pin__in={r["pin"] for r in records}, school_id=device.school_id
        ).only("id", "pin", "student_id", "staff_id")
    }
    rows = [
        PunchLog(
            user=users.get(r["pin"]), punch_time=r["punch_time"],
            status=r["status"], verify=r["verify"], workcode=r["workcode"],
        )
        for r in records
    ]
    with transaction.atomic():
        PunchLog.objects.bulk_create(rows, ignore_conflicts=True)
        user_ids = {
            user.id for r in records if (user := users.get(r["pin"])) is not None
        }
        process_punches(device, user_ids)
    return len(records)


def ingest_operlog(device, body: bytes) -> int:
    """USER lines enrol/update device users; other prefixes are ignored."""
    count = 0
    for prefix, kv in parse_operlog(body):
        if prefix != "USER":
            continue
        pin = kv.get("PIN")
        if not pin:
            continue
        DeviceUser.all_objects.update_or_create(
            device=device,
            pin=pin,
            defaults={
                "school_id": device.school_id,
                "privilege": int(kv.get("Pri", "0") or 0),
                "password": kv.get("Passwd", ""),
                "card": kv.get("Card", ""),
                "group_id": int(kv.get("Grp", "1") or 1),
                "tz_str": kv.get("TZ", ""),
                "verify": int(kv.get("Verify", "-1") or -1),
                "is_active": True,
            },
        )
        count += 1
    return count
