"""Education Equality Fee (3% government levy): opt-in targeting + snapshot.

The fee is a pass-through collected ON TOP of a receipt — these tests pin
the two things that must never drift: total_paid/dues stay untouched, and
the fee only applies where the vendor enabled (school, education level).
"""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.billing.models import BillingYear, EducationFeeLevel, Payment
from apps.billing.services.education_fee import compute_fee, taxable_base
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


@pytest.fixture
def eef_setup(db):
    school = make_school("eef")
    student = make_student(school, "Samata")  # class_info education_level="school"
    billing_year = BillingYear.objects.create(
        name="EY 2083/84", start_date_bs="2083-04-01", end_date_bs="2084-03-30"
    )
    return school, student, student.academic_year, billing_year


def pay(api, student, year, billing_year, **overrides):
    payload = {
        "kind": "regular", "date_bs": "2083-05-01",
        "student": str(student.id), "academic_year": str(year.id),
        "billing_year": str(billing_year.id), "payment_month": 2, "mode": "cash",
        "lines": [
            {"line_type": "fee", "label": "Tuition", "amount": "1000.00",
             "discount": "100.00"},
            {"line_type": "old_dues", "label": "Old dues", "amount": "500.00"},
        ],
        **overrides,
    }
    return api.post("/api/v1/billing/payments/", payload, format="json")


class TestComputation:
    def test_base_nets_discounts_and_skips_discount_lines(self):
        lines = [
            {"line_type": "fee", "amount": Decimal("1000"), "discount": Decimal("100")},
            {"line_type": "old_dues", "amount": Decimal("500"), "discount": None},
            # receipt-level discount pseudo-line must not subtract twice
            {"line_type": "discount", "amount": Decimal("100"), "discount": None},
            # negative net (carry-forward shape) contributes nothing
            {"line_type": "fee", "amount": Decimal("50"), "discount": Decimal("80")},
        ]
        assert taxable_base(lines) == Decimal("1400")

    def test_rounding_half_up(self, eef_setup):
        school, student, *_ = eef_setup
        EducationFeeLevel.objects.create(school=school, education_level="school")
        fee = compute_fee(
            school, "school",
            [{"line_type": "fee", "amount": Decimal("33.55"), "discount": None}],
        )
        # 3% of 33.55 = 1.0065 → 1.01
        assert fee["amount"] == Decimal("1.01")

    def test_disabled_level_returns_none(self, eef_setup):
        school, *_ = eef_setup
        fee = compute_fee(
            school, "school",
            [{"line_type": "fee", "amount": Decimal("1000"), "discount": None}],
        )
        assert fee is None


@pytest.mark.django_db
class TestReceiptSnapshot:
    def test_enabled_level_snapshots_fee_outside_totals(self, eef_setup):
        school, student, year, billing_year = eef_setup
        EducationFeeLevel.objects.create(school=school, education_level="school")
        api = APIClient()
        login(api, "admin_eef", "admin")
        res = pay(api, student, year, billing_year)
        assert res.status_code == 201, res.content
        p = Payment.objects.get(id=res.data["id"])
        # base = (1000-100) + 500; fee = 3% = 42.00
        assert p.edu_fee_pct == Decimal("3.00")
        assert p.edu_fee_base == Decimal("1400.00")
        assert p.edu_fee_amount == Decimal("42.00")
        # M1 stays pure: the levy never enters the receipt's own money
        assert p.total_paid == Decimal("1500.00")
        assert p.total_discount == Decimal("100.00")
        assert res.data["edu_fee_amount"] == "42.00"

    def test_disabled_school_charges_nothing(self, eef_setup):
        school, student, year, billing_year = eef_setup
        api = APIClient()
        login(api, "admin_eef", "admin")
        res = pay(api, student, year, billing_year)
        assert res.status_code == 201, res.content
        p = Payment.objects.get(id=res.data["id"])
        assert p.edu_fee_amount is None and p.edu_fee_pct is None

    def test_other_levels_not_levied(self, eef_setup):
        school, student, year, billing_year = eef_setup
        # highschool enabled, but the student is education_level="school"
        EducationFeeLevel.objects.create(school=school, education_level="highschool")
        api = APIClient()
        login(api, "admin_eef", "admin")
        res = pay(api, student, year, billing_year)
        assert Payment.objects.get(id=res.data["id"]).edu_fee_amount is None

    def test_cash_receipts_exempt(self, eef_setup):
        school, student, year, billing_year = eef_setup
        EducationFeeLevel.objects.create(school=school, education_level="school")
        api = APIClient()
        login(api, "admin_eef", "admin")
        res = api.post("/api/v1/billing/payments/", {
            "kind": "cash_receipt", "date_bs": "2083-05-01",
            "academic_year": str(year.id), "billing_year": str(billing_year.id),
            "payment_month": 2, "mode": "cash", "payer_name": "Walk-in",
            "lines": [{"line_type": "other", "label": "Hall rent", "amount": "2000.00"}],
        }, format="json")
        assert res.status_code == 201, res.content
        assert Payment.objects.get(id=res.data["id"]).edu_fee_amount is None

    def test_client_cannot_set_fee_fields(self, eef_setup):
        school, student, year, billing_year = eef_setup
        api = APIClient()
        login(api, "admin_eef", "admin")
        res = pay(api, student, year, billing_year, edu_fee_amount="999.00")
        assert res.status_code == 201, res.content
        assert Payment.objects.get(id=res.data["id"]).edu_fee_amount is None


@pytest.mark.django_db
class TestLevelsEndpoint:
    def test_returns_enabled_levels(self, eef_setup):
        school, *_ = eef_setup
        EducationFeeLevel.objects.create(school=school, education_level="school")
        EducationFeeLevel.objects.create(school=school, education_level="highschool")
        api = APIClient()
        login(api, "admin_eef", "admin")
        res = api.get("/api/v1/billing/education-fee-levels/")
        assert res.status_code == 200
        assert res.data["enabled"] == ["highschool", "school"]
        assert res.data["percent"] == "3"

    def test_anonymous_refused(self, eef_setup):
        assert APIClient().get("/api/v1/billing/education-fee-levels/").status_code == 401
