"""Payroll: the M1 fix (explicit gross/deductions/net), fiscal-year serials,
tenant isolation and permission contracts under real API flows."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.billing.models import BillingYear
from apps.payroll.models import SalaryAccrual, SalaryPayment
from apps.payroll.services.statements import head_balances, salary_sheet, statement
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school, make_student

ZERO = Decimal("0")


@pytest.fixture
def payroll_setup(db):
    school = make_school("pay")
    staff = make_staff(school, "staff_pay", ["payroll.manage"])
    # any student fixture creates the school's academic year
    year = make_student(school, "Chhori").academic_year
    billing_year = BillingYear.objects.create(
        name="2082/83-p", start_date_bs="2082-04-01", end_date_bs="2083-03-30"
    )
    return school, staff, year, billing_year


def post_accrual(api, staff, year, billing_year, months=(1,), lines=None):
    return api.post("/api/v1/payroll/accruals/", {
        "staff": str(staff.id), "date_bs": "2082-05-01", "months": list(months),
        "academic_year": str(year.id), "billing_year": str(billing_year.id),
        "lines": lines or [
            {"earning_type": "salary", "amount": "30000.00"},
            {"earning_type": "allowance", "amount": "5000.00"},
        ],
    }, format="json")


def post_payment(api, staff, year, billing_year, **overrides):
    payload = {
        "staff": str(staff.id), "date_bs": "2082-06-01",
        "academic_year": str(year.id), "billing_year": str(billing_year.id),
        "payment_month": 5, "mode": "cash",
        "lines": [
            {"earning_type": "salary", "amount": "30000.00",
             "tds_pct": "1.00", "tds_amount": "300.00"},
            {"earning_type": "allowance", "amount": "5000.00"},
        ],
    }
    payload.update(overrides)
    return api.post("/api/v1/payroll/payments/", payload, format="json")


@pytest.mark.django_db
class TestNetIdentity:
    """The M1 asymmetry dies here: gross, deductions and net are explicit."""

    def test_payment_computes_gross_tds_and_net(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        res = post_payment(api, staff, year, billing_year)
        assert res.status_code == 201, res.content
        payment = SalaryPayment.objects.get(staff=staff)
        assert payment.gross == Decimal("35000.00")      # sum of line gross
        assert payment.tds_amount == Decimal("300.00")   # sum of line tdsa
        assert payment.net_paid == Decimal("34700.00")   # gross - deductions
        assert payment.serial == 1

    def test_header_deductions_reduce_net(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        res = post_payment(
            api, staff, year, billing_year,
            pf_amount="1000.00", insurance_amount="500.00",
        )
        assert res.status_code == 201, res.content
        payment = SalaryPayment.objects.get(staff=staff)
        assert payment.net_paid == Decimal("33200.00")  # 35000 - 300 - 1000 - 500

    def test_client_cannot_set_money_totals(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        res = post_payment(
            api, staff, year, billing_year,
            gross="1.00", net_paid="999999.00", tds_amount="0.00",
        )
        assert res.status_code == 201, res.content
        payment = SalaryPayment.objects.get(staff=staff)
        assert payment.gross == Decimal("35000.00")  # server-computed, input ignored
        assert payment.net_paid == Decimal("34700.00")


@pytest.mark.django_db
class TestSerials:
    def test_serials_increment_within_fiscal_year(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        first = post_payment(api, staff, year, billing_year)
        second = post_payment(api, staff, year, billing_year)
        assert (first.data["serial"], second.data["serial"]) == (1, 2)

    def test_serials_restart_per_fiscal_year_not_academic_year(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        next_fy = BillingYear.objects.create(
            name="2083/84-p", start_date_bs="2083-04-01", end_date_bs="2084-03-30"
        )
        api = APIClient()
        login(api, "admin_pay", "admin")
        post_payment(api, staff, year, billing_year)
        res = post_payment(api, staff, year, next_fy)
        assert res.data["serial"] == 1  # new fiscal year restarts numbering


@pytest.mark.django_db
class TestAccruals:
    def test_total_is_sum_of_lines(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        res = post_accrual(api, staff, year, billing_year)
        assert res.status_code == 201, res.content
        assert Decimal(res.data["total"]) == Decimal("35000.00")

    def test_bulk_posting_creates_one_accrual_per_staff(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        other = make_staff(school, "staff_pay2", [])
        api = APIClient()
        login(api, "admin_pay", "admin")
        res = api.post("/api/v1/payroll/accruals/bulk/", {
            "date_bs": "2082-05-01", "months": [1, 2],
            "academic_year": str(year.id), "billing_year": str(billing_year.id),
            "rows": [
                {"staff": str(staff.id),
                 "lines": [{"earning_type": "salary", "amount": "30000.00"}]},
                {"staff": str(other.id),
                 "lines": [{"earning_type": "salary", "amount": "20000.00"},
                           {"earning_type": "grade", "amount": "2000.00"}]},
            ],
        }, format="json")
        assert res.status_code == 201, res.content
        assert res.data["created"] == 2
        assert SalaryAccrual.objects.get(staff=other).total == Decimal("22000.00")

    def test_posted_months_endpoint(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        post_accrual(api, staff, year, billing_year, months=(1, 2))
        post_accrual(api, staff, year, billing_year, months=(2, 3))
        res = api.get(
            f"/api/v1/payroll/accruals/months/?staff={staff.id}"
            f"&academic_year={year.id}&billing_year={billing_year.id}"
        )
        assert res.data["months"] == [1, 2, 3]

    def test_soft_delete_keeps_row_and_reason(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        accrual_id = post_accrual(api, staff, year, billing_year).data["id"]
        res = api.delete(
            f"/api/v1/payroll/accruals/{accrual_id}/",
            {"remarks": "posted twice"}, format="json",
        )
        assert res.status_code == 204
        deleted = SalaryAccrual.all_objects.get(id=accrual_id)
        assert deleted.is_active is False
        assert deleted.remarks == "posted twice"
        assert SalaryAccrual.objects.filter(id=accrual_id).count() == 0


@pytest.mark.django_db
class TestReporting:
    def test_head_balances_accrued_minus_settled(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        post_accrual(api, staff, year, billing_year)  # 30000 salary + 5000 allowance
        post_payment(api, staff, year, billing_year)  # settles 30000 + 5000 gross
        balances = head_balances(staff)
        assert balances["salary"] == ZERO   # gross settled, despite 300 TDS withheld
        assert balances["allowance"] == ZERO
        assert balances["total"] == ZERO

    def test_balance_endpoint_scopes_by_fiscal_year(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        post_accrual(api, staff, year, billing_year)
        next_fy = BillingYear.objects.create(
            name="2083/84-b", start_date_bs="2083-04-01", end_date_bs="2084-03-30"
        )
        res = api.get(
            f"/api/v1/payroll/payments/balance/?staff={staff.id}&billing_year={next_fy.id}"
        )
        assert Decimal(res.data["total"]) == ZERO  # other fiscal year: nothing accrued

    def test_statement_shows_deduction_entries(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        post_accrual(api, staff, year, billing_year)
        post_payment(api, staff, year, billing_year)
        entries = statement(staff)
        kinds = [entry["kind"] for entry in entries]
        assert kinds == ["accrual", "payment", "deduction"]  # TDS row is explicit
        payment_entry = entries[1]
        assert payment_entry["credit"] == Decimal("34700.00")
        # statement particulars are net per head (amt - tdsa), like legacy
        assert ["salary", Decimal("29700.00")] in payment_entry["particulars"]
        assert entries[2]["deduction"] == Decimal("300.00")

    def test_salary_sheet_math(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        post_accrual(api, staff, year, billing_year)
        post_payment(api, staff, year, billing_year)
        rows = salary_sheet(school, "2082-01-01", "2083-01-01")
        row = next(r for r in rows if r["staff"] == str(staff.id))
        assert row["total"] == Decimal("35000.00")      # gross accrued
        assert row["deduction"] == Decimal("300.00")
        assert row["net"] == Decimal("34700.00")        # gross - deductions
        assert row["paid"] == Decimal("34700.00")       # net cash out
        assert row["balance"] == ZERO


@pytest.mark.django_db
class TestTenantIsolationAndPermissions:
    def test_cannot_pay_other_schools_staff(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        make_school("intruder")
        api = APIClient()
        login(api, "admin_intruder", "admin")
        res = post_payment(api, staff, year, billing_year)
        assert res.status_code == 400  # cross-tenant staff/year rejected

    def test_other_school_sees_no_payroll(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "admin_pay", "admin")
        post_accrual(api, staff, year, billing_year)
        make_school("peeker")
        other = APIClient()
        login(other, "admin_peeker", "admin")
        assert other.get("/api/v1/payroll/accruals/").data["results"] == []

    def test_staff_without_grant_denied(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        make_staff(school, "staff_nogrant", [])
        api = APIClient()
        login(api, "staff_nogrant", "staff")
        assert api.get("/api/v1/payroll/accruals/").status_code == 403

    def test_staff_with_view_cannot_write(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        make_staff(school, "staff_viewer", ["payroll.view"])
        api = APIClient()
        login(api, "staff_viewer", "staff")
        assert api.get("/api/v1/payroll/payments/").status_code == 200
        assert post_payment(api, staff, year, billing_year).status_code == 403

    def test_staff_with_manage_can_post(self, payroll_setup):
        school, staff, year, billing_year = payroll_setup
        api = APIClient()
        login(api, "staff_pay", "staff")  # fixture staff holds payroll.manage
        assert post_accrual(api, staff, year, billing_year).status_code == 201
