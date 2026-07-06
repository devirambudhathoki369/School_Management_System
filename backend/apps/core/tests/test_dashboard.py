"""Dashboard endpoint: cross-module snapshot, permission-gated per block."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.billing.models import BillingYear, Charge, FeeTitle, Payment
from apps.core.dates import today_bs
from apps.core.reports import _last_bs_months
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


def make_payment(school, student, amount, discount="0", date_bs=None):
    return Payment.objects.create(
        school=school,
        kind=FeeTitle.Kind.REGULAR,
        date_bs=date_bs or today_bs(),
        student=student,
        academic_year=student.academic_year,
        billing_year=BillingYear.objects.get_or_create(
            name="TY", defaults={"start_date_bs": "2080-04-01", "end_date_bs": "2099-03-30"}
        )[0],
        total_paid=Decimal(amount),
        total_discount=Decimal(discount),
    )


@pytest.fixture
def school_with_activity(db):
    school = make_school("dash")
    student = make_student(school, "Dashee")
    Charge.objects.create(
        school=school, student=student, date_bs=today_bs(),
        academic_year=student.academic_year,
        billing_year=BillingYear.objects.get_or_create(
            name="TY", defaults={"start_date_bs": "2080-04-01", "end_date_bs": "2099-03-30"}
        )[0],
        total=Decimal("1000"),
    )
    make_payment(school, student, "300", "100")
    return school, student


@pytest.mark.django_db
class TestDashboard:
    def test_admin_gets_every_block_with_correct_numbers(self, school_with_activity):
        api = APIClient()
        login(api, "admin_dash", "admin")
        res = api.get("/api/v1/reports/dashboard/")
        assert res.status_code == 200
        data = res.data
        assert data["students"]["running"] == 1
        assert data["students"]["male"] == 1
        # dues = 1000 charged - (300 paid + 100 discount)
        assert data["finance"]["dues_outstanding"] == Decimal("600")
        assert data["finance"]["collected_today"] == Decimal("300")
        assert data["finance"]["receipts_today"] == 1
        assert len(data["finance"]["trend"]) == 6
        assert data["finance"]["trend"][-1]["collected"] == Decimal("300")
        assert data["recent_receipts"][0]["total_paid"] == Decimal("300.00")
        assert "attendance" in data and "staff" in data

    def test_staff_only_receives_granted_blocks(self, school_with_activity):
        school, _ = school_with_activity
        make_staff(school, "dash_staff", ["students.view"])
        api = APIClient()
        login(api, "dash_staff", "staff")
        data = api.get("/api/v1/reports/dashboard/").data
        assert "students" in data
        assert "finance" not in data and "recent_receipts" not in data

    def test_tenant_isolation(self, school_with_activity):
        other = make_school("dashother")
        api = APIClient()
        login(api, "admin_dashother", "admin")
        data = api.get("/api/v1/reports/dashboard/").data
        assert data["school"] == other.name
        assert data["students"]["running"] == 0
        assert data["finance"]["dues_outstanding"] == Decimal("0")

    def test_students_and_guardians_are_denied(self, school_with_activity):
        assert APIClient().get("/api/v1/reports/dashboard/").status_code == 401


def test_bs_month_walk_wraps_the_year():
    months = _last_bs_months("2083-02-15", 6)
    assert [m for _, m in months] == [9, 10, 11, 12, 1, 2]
    assert months[0][0] == "2082-09"
    assert months[-1][0] == "2083-02"
