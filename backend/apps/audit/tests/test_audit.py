"""Audit trail: append-only enforcement and the admin-only read endpoint."""

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school


@pytest.fixture
def audit_setup(db):
    school = make_school("audit")
    event = AuditEvent.objects.create(
        school=school, action="create", object_table="billing_payment",
        object_id="x-1", changes={"total_paid": "100.00"},
    )
    return school, event


@pytest.mark.django_db(transaction=True)
class TestAppendOnly:
    def test_update_and_delete_are_rejected_by_the_database(self, audit_setup):
        school, event = audit_setup
        with pytest.raises(IntegrityError, match="append-only"):
            with transaction.atomic():
                AuditEvent.objects.filter(id=event.id).update(action="update")
        with pytest.raises(IntegrityError, match="append-only"):
            with transaction.atomic():
                event.delete()
        assert AuditEvent.objects.filter(id=event.id, action="create").exists()


@pytest.mark.django_db
class TestReadEndpoint:
    def test_admin_reads_own_school_only(self, audit_setup):
        school, event = audit_setup
        other_school = make_school("audit2")
        AuditEvent.objects.create(
            school=other_school, action="update", object_table="t", object_id="y",
        )
        api = APIClient()
        login(api, "admin_audit", "admin")
        res = api.get("/api/v1/audit/events/")
        assert res.status_code == 200
        assert [row["object_id"] for row in res.data["results"]] == ["x-1"]

    def test_staff_cannot_read_the_log(self, audit_setup):
        school, event = audit_setup
        make_staff(school, "audit_staff", ["reports.manage"])
        api = APIClient()
        login(api, "audit_staff", "staff")
        assert api.get("/api/v1/audit/events/").status_code == 403

    def test_endpoint_is_read_only(self, audit_setup):
        school, event = audit_setup
        api = APIClient()
        login(api, "admin_audit", "admin")
        res = api.post("/api/v1/audit/events/", {"action": "create"})
        assert res.status_code == 405
