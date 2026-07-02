"""
RFID push system: full device conversation + punch->attendance rules.

Simulates real ZKTeco traffic against /iclock/*: handshake, punch upload,
command polling — and verifies the attendance derivation (AT1–AT4).
"""

from datetime import datetime, timedelta

import pytest
from django.test import Client
from django.utils import timezone

from apps.attendance.models import ClassAttendanceSession, StudentAttendanceRecord
from apps.attendance.services import CHECKOUT_MIN_GAP
from apps.core.dates import NEPAL_TZ, today_bs
from apps.devices.models import Device, DeviceCommand, DeviceUser, PunchLog
from apps.devices.services import commands
from apps.people.models import Student
from apps.people.tests.test_tenant_isolation import make_school, make_student


@pytest.fixture
def device_setup(db):
    school = make_school("rfid")
    student = make_student(school, "Punita")
    device = Device.objects.create(
        school=school, serial_number="ZK123456", alias="Front gate"
    )
    device_user = DeviceUser.objects.create(
        school=school, device=device, pin="101", card="0012345", student=student
    )
    return school, device, device_user, student


def _attlog_body(pin: str, *times: datetime) -> str:
    return "".join(
        f"{pin}\t{t.astimezone(NEPAL_TZ).strftime('%Y-%m-%d %H:%M:%S')}\t0\t1\t0\n"
        for t in times
    )


def _today_at(hour: int, minute: int = 0) -> datetime:
    now = timezone.now().astimezone(NEPAL_TZ)
    return now.replace(hour=hour, minute=minute, second=0, microsecond=0)


@pytest.mark.django_db
class TestProtocol:
    def test_unregistered_device_is_rejected(self, device_setup):
        client = Client()
        res = client.get("/iclock/getrequest", {"SN": "UNKNOWN99"})
        assert res.status_code == 403  # AT4: pre-registration required

    def test_handshake_legacy_and_new_firmware(self, device_setup):
        client = Client()
        legacy = client.get("/iclock/cdata", {"SN": "ZK123456", "options": "all"})
        assert legacy.status_code == 200
        assert legacy.content.startswith(b"GET OPTION FROM: ZK123456")
        newer = client.get(
            "/iclock/cdata",
            {"SN": "ZK123456", "options": "all", "PushOptionsFlag": "1", "pushver": "3.1"},
        )
        assert newer.content.startswith(b"registry=ok")
        registry = client.post("/iclock/registry?SN=ZK123456")
        assert registry.content.startswith(b"RegistryCode=")

    def test_punch_upload_creates_attendance(self, device_setup):
        school, device, device_user, student = device_setup
        client = Client()
        res = client.post(
            "/iclock/cdata?SN=ZK123456&table=ATTLOG&Stamp=100",
            data=_attlog_body("101", _today_at(9)),
            content_type="text/plain",
        )
        assert res.content == b"OK: 1"
        assert PunchLog.objects.count() == 1
        record = StudentAttendanceRecord.objects.get(student=student)
        assert record.present and record.checked_in_at is not None
        assert record.checked_out_at is None  # single punch: no checkout
        device.refresh_from_db()
        assert device.attlog_stamp == "100" and device.state == Device.State.ONLINE

    def test_punch_resend_is_idempotent(self, device_setup):
        client = Client()
        body = _attlog_body("101", _today_at(9))
        for _ in range(2):
            client.post(
                "/iclock/cdata?SN=ZK123456&table=ATTLOG",
                data=body, content_type="text/plain",
            )
        assert PunchLog.objects.count() == 1  # deduped on unique key

    def test_checkout_needs_one_hour_gap(self, device_setup):
        school, device, device_user, student = device_setup
        client = Client()
        client.post(
            "/iclock/cdata?SN=ZK123456&table=ATTLOG",
            data=_attlog_body("101", _today_at(9), _today_at(9, 20)),
            content_type="text/plain",
        )
        record = StudentAttendanceRecord.objects.get(student=student)
        assert record.checked_out_at is None  # double tap on the way in
        client.post(
            "/iclock/cdata?SN=ZK123456&table=ATTLOG",
            data=_attlog_body("101", _today_at(15)),
            content_type="text/plain",
        )
        record.refresh_from_db()
        assert record.checked_out_at is not None
        assert record.checked_out_at - record.checked_in_at >= CHECKOUT_MIN_GAP

    def test_late_punch_not_present_when_time_set(self, device_setup):
        school, device, device_user, student = device_setup
        settings = school.settings
        settings.time_set_required = True
        settings.attendance_in_time = _today_at(10).time()
        settings.save()
        client = Client()
        client.post(
            "/iclock/cdata?SN=ZK123456&table=ATTLOG",
            data=_attlog_body("101", _today_at(11)),  # first punch after in-time
            content_type="text/plain",
        )
        record = StudentAttendanceRecord.objects.get(student=student)
        assert not record.present  # AT3: late -> not auto-present
        assert PunchLog.objects.count() == 1  # punch still stored

    def test_absent_rows_created_for_whole_class(self, device_setup):
        school, device, device_user, student = device_setup
        classmate = Student.objects.create(
            school=school, first_name="Absent", last_name="Kid", gender="male",
            class_info=student.class_info, academic_year=student.academic_year,
        )
        Client().post(
            "/iclock/cdata?SN=ZK123456&table=ATTLOG",
            data=_attlog_body("101", _today_at(9)),
            content_type="text/plain",
        )
        session = ClassAttendanceSession.objects.get(date_bs=today_bs())
        by_student = {r.student_id: r.present for r in session.records.all()}
        assert by_student == {student.id: True, classmate.id: False}

    def test_command_queue_roundtrip(self, device_setup):
        school, device, device_user, student = device_setup
        command = commands.enqueue_pull_attlog(device, start="2026-07-01 00:00:00")
        client = Client()
        poll = client.get("/iclock/getrequest", {"SN": "ZK123456"})
        assert f"C:{command.cmd_id}:DATA QUERY ATTLOG".encode() in poll.content
        result = client.post(
            "/iclock/devicecmd?SN=ZK123456",
            data=f"ID={command.cmd_id}&Return=0&CMD=DATA",
            content_type="text/plain",
        )
        assert result.content == b"OK"
        command.refresh_from_db()
        assert command.status == DeviceCommand.Status.DONE

    def test_offline_reconnect_queues_auto_pull(self, device_setup):
        school, device, device_user, student = device_setup
        Device.all_objects.filter(pk=device.pk).update(
            last_seen=timezone.now() - timedelta(hours=3)
        )
        Client().get("/iclock/ping", {"SN": "ZK123456"})
        assert DeviceCommand.objects.filter(
            device=device, cmd_content__startswith="DATA QUERY ATTLOG"
        ).exists()

    def test_operlog_enrolls_device_user(self, device_setup):
        school, device, *_ = device_setup
        res = Client().post(
            "/iclock/cdata?SN=ZK123456&table=OPERLOG",
            data="USER PIN=202\tName=New Kid\tPri=0\tCard=0099887\tGrp=1\tVerify=1\n",
            content_type="text/plain",
        )
        assert res.content == b"OK: 1"
        enrolled = DeviceUser.objects.get(device=device, pin="202")
        assert enrolled.card == "0099887" and enrolled.school_id == school.id
