"""Beat jobs: delivery dispatch/expiry, alert retention, token flush."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.communication.models import DeliveryLog
from apps.communication.providers import StaleTokenError
from apps.communication.tasks import dispatch_queued_deliveries, expire_stale_deliveries
from apps.identity.tasks import flush_expired_tokens
from apps.people.tests.test_tenant_isolation import make_school, make_student
from apps.transport.models import ProximityAlert
from apps.transport.tasks import trim_proximity_alerts

SENT: list[str] = []


class RecordingProvider:
    """Test gateway: records sends; title controls the outcome."""

    def send(self, log):
        if log.title == "boom":
            raise RuntimeError("gateway down")
        if log.title == "stale":
            raise StaleTokenError
        SENT.append(log.title)


def queue(school, title):
    return DeliveryLog.objects.create(school=school, title=title, body="b")


@pytest.mark.django_db
class TestDeliveryDispatch:
    def test_without_provider_queue_is_held(self, db, settings):
        settings.PUSH_PROVIDER = ""
        school = make_school("beat1")
        row = queue(school, "hello")
        assert dispatch_queued_deliveries() == 0
        row.refresh_from_db()
        assert row.status == DeliveryLog.Status.QUEUED

    def test_provider_outcomes_map_to_statuses(self, db, settings):
        settings.PUSH_PROVIDER = "apps.communication.tests.test_tasks.RecordingProvider"
        school = make_school("beat2")
        ok = queue(school, "hello")
        bad = queue(school, "boom")
        stale = queue(school, "stale")
        SENT.clear()
        assert dispatch_queued_deliveries() == 3
        ok.refresh_from_db()
        bad.refresh_from_db()
        stale.refresh_from_db()
        assert ok.status == DeliveryLog.Status.SENT
        assert bad.status == DeliveryLog.Status.FAILED
        assert stale.status == DeliveryLog.Status.STALE_TOKEN
        assert SENT == ["hello"]
        # nothing left queued; a second run is a no-op
        assert dispatch_queued_deliveries() == 0

    def test_expiry_fails_only_old_queued_rows(self, db):
        school = make_school("beat3")
        old = queue(school, "old")
        fresh = queue(school, "fresh")
        DeliveryLog.objects.filter(id=old.id).update(
            created_at=timezone.now() - timedelta(days=45)
        )
        assert expire_stale_deliveries(days=30) == 1
        old.refresh_from_db()
        fresh.refresh_from_db()
        assert old.status == DeliveryLog.Status.FAILED
        assert fresh.status == DeliveryLog.Status.QUEUED


@pytest.mark.django_db
class TestRetentionJobs:
    def test_trim_keeps_live_subscriptions(self, db):
        school = make_school("beat4")
        student = make_student(school, "Rider")
        stale_date = timezone.localdate() - timedelta(days=120)
        ProximityAlert.objects.create(
            school=school, bus_number=1, student=student, alerted_date=stale_date
        )
        ProximityAlert.objects.create(
            school=school, bus_number=1, student=student,
            alerted_date=timezone.localdate(),
        )
        never_fired = ProximityAlert.objects.create(
            school=school, bus_number=2, student=student
        )
        assert trim_proximity_alerts(days=90) == 1
        remaining = set(ProximityAlert.objects.values_list("id", flat=True))
        assert never_fired.id in remaining and len(remaining) == 2

    def test_flush_expired_tokens_runs(self, db):
        flush_expired_tokens()  # empty tables: must simply succeed
