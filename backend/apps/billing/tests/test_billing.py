"""Billing: money invariants (M1-M8, corrected D-rules) under real API flows."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassInfo, Section
from apps.billing.models import (
    BillingYear,
    Charge,
    FeeSchedule,
    FeeTitle,
    Payment,
    StandingDiscount,
)
from apps.billing.services import serials
from apps.billing.services.dues import student_dues
from apps.billing.services.fees import discount_amount, resolve_fees
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


@pytest.fixture
def billing_setup(db):
    school = make_school("bill")
    student = make_student(school, "Paisa")
    year = student.academic_year
    billing_year = BillingYear.objects.create(
        name="2082/83", start_date_bs="2082-04-01", end_date_bs="2083-03-30"
    )
    tuition = FeeTitle.objects.create(
        school=school, name="Tuition", months=[1, 2, 3], kind=FeeTitle.Kind.REGULAR
    )
    FeeSchedule.objects.create(
        school=school, class_info=student.class_info, fee_title=tuition, amount="1000.00"
    )
    return school, student, year, billing_year, tuition


@pytest.mark.django_db
class TestFeeResolution:
    def test_section_fee_overrides_generic(self, billing_setup):
        school, student, year, _, tuition = billing_setup
        generic = student.class_info  # has no section
        section = Section.objects.create(school=school, name="A")
        sectioned = ClassInfo.objects.create(
            school=school, education_level=generic.education_level,
            grade=generic.grade, academic_year=year, section=section,
        )
        FeeSchedule.objects.create(
            school=school, class_info=sectioned, fee_title=tuition, amount="1200.00"
        )
        assert resolve_fees(sectioned)[tuition.id][1] == Decimal("1200.00")  # M5
        assert resolve_fees(generic)[tuition.id][1] == Decimal("1000.00")

    def test_percentage_wins_over_flat(self, billing_setup):
        school, student, year, _, tuition = billing_setup
        both = StandingDiscount(
            school=school, student=student, fee_title=tuition,
            flat_amount=Decimal("999.00"), percentage=Decimal("10.00"),
        )
        # Production rule: 18,902 legacy rows set both; percentage wins.
        assert discount_amount(both, Decimal("1000.00")) == Decimal("100.00")
        flat_only = StandingDiscount(
            school=school, student=student, fee_title=tuition,
            flat_amount=Decimal("250.00"), percentage=None,
        )
        assert discount_amount(flat_only, Decimal("1000.00")) == Decimal("250.00")


@pytest.mark.django_db
class TestChargeGeneration:
    def test_batch_charges_months_and_discounts(self, billing_setup):
        school, student, year, billing_year, tuition = billing_setup
        StandingDiscount.objects.create(
            school=school, student=student, fee_title=tuition,
            percentage=Decimal("50.00"), academic_year=year,
        )
        api = APIClient()
        login(api, "admin_bill", "admin")
        res = api.post("/api/v1/billing/charge-batches/", {
            "date_bs": "2082-01-05", "months": [1, 2],
            "academic_year": str(year.id), "billing_year": str(billing_year.id),
            "class_info": str(student.class_info_id),
        }, format="json")
        assert res.status_code == 201, res.content
        charge = Charge.objects.get(student=student)
        # 2 applicable months x 1000 - 50% discount per month rate
        by_type = {line.line_type: line.amount for line in charge.lines.all()}
        assert by_type["fee"] == Decimal("2000.00")
        assert by_type["discount"] == Decimal("-500.00")
        assert charge.total == Decimal("1500.00")  # total == sum(lines)

    def test_discount_scoped_to_academic_year(self, billing_setup):
        school, student, year, billing_year, tuition = billing_setup
        other_year = AcademicYear.objects.create(
            school=school, name="2083", start_date_bs="2083-01-01", end_date_bs="2083-12-30"
        )
        StandingDiscount.objects.create(  # D2: different year -> must not apply
            school=school, student=student, fee_title=tuition,
            percentage=Decimal("50.00"), academic_year=other_year,
        )
        api = APIClient()
        login(api, "admin_bill", "admin")
        api.post("/api/v1/billing/charge-batches/", {
            "date_bs": "2082-01-05", "months": [1],
            "academic_year": str(year.id), "billing_year": str(billing_year.id),
            "class_info": str(student.class_info_id),
        }, format="json")
        charge = Charge.objects.get(student=student)
        assert charge.total == Decimal("1000.00")  # no discount line


@pytest.mark.django_db
class TestPayments:
    def make_payment(self, api, payer, year, billing_year, **overrides):
        payload = {
            "kind": "regular", "date_bs": "2082-02-01",
            "student": str(payer.id), "academic_year": str(year.id),
            "billing_year": str(billing_year.id), "payment_month": 2,
            "mode": "cash",
            "lines": [
                {"line_type": "fee", "label": "Tuition", "amount": "1000.00",
                 "discount": "100.00"},
            ],
            **overrides,
        }
        return api.post("/api/v1/billing/payments/", payload, format="json")

    def test_total_paid_is_pre_discount(self, billing_setup):
        school, student, year, billing_year, _ = billing_setup
        api = APIClient()
        login(api, "admin_bill", "admin")
        res = self.make_payment(api, student, year, billing_year)
        assert res.status_code == 201, res.content
        payment = Payment.objects.get()
        assert payment.total_paid == Decimal("1000.00")      # M1: NOT 900
        assert payment.total_discount == Decimal("100.00")
        assert payment.class_info_id == student.class_info_id  # M3 snapshot

    def test_serials_are_sequential_per_fiscal_year_and_kind(self, billing_setup):
        school, student, year, billing_year, _ = billing_setup
        api = APIClient()
        login(api, "admin_bill", "admin")
        first = self.make_payment(api, student, year, billing_year)
        second = self.make_payment(api, student, year, billing_year)
        assert [first.data["serial"], second.data["serial"]] == [1, 2]  # M2 fixed
        cash = self.make_payment(
            api, student, year, billing_year,
            kind="cash_receipt", student=None,
            payer_name="Walk-in", lines=[
                {"line_type": "other", "label": "Certificate fee", "amount": "500.00"},
            ],
        )
        assert cash.data["serial"] == 1  # separate series per kind

    def test_serials_survive_academic_year_close(self, billing_setup):
        """Numbering keys on the FISCAL year: a new academic year mid-
        fiscal-year must NOT restart the counter (the legacy AY-keyed
        counter minted duplicate receipt numbers)."""
        school, student, year, billing_year, _ = billing_setup
        api = APIClient()
        login(api, "admin_bill", "admin")
        first = self.make_payment(api, student, year, billing_year)
        next_ay = AcademicYear.objects.create(
            school=school, name="2083-serial",
            start_date_bs="2083-01-01", end_date_bs="2083-12-30",
        )
        second = self.make_payment(
            api, student, year, billing_year, academic_year=str(next_ay.id)
        )
        assert [first.data["serial"], second.data["serial"]] == [1, 2]
        next_fy = BillingYear.objects.create(
            name="2083/84-serial", start_date_bs="2083-04-01", end_date_bs="2084-03-30"
        )
        third = self.make_payment(
            api, student, year, next_fy, academic_year=str(next_ay.id)
        )
        assert third.data["serial"] == 1  # new fiscal year restarts numbering

    @pytest.mark.django_db(transaction=True)
    def test_serial_allocation_requires_transaction(self, billing_setup):
        school, student, year, billing_year, _ = billing_setup
        with pytest.raises(RuntimeError):
            serials.allocate(school, billing_year, "regular")

    def test_dues_respect_pre_discount_semantics(self, billing_setup):
        school, student, year, billing_year, tuition = billing_setup
        api = APIClient()
        login(api, "admin_bill", "admin")
        api.post("/api/v1/billing/charge-batches/", {
            "date_bs": "2082-01-05", "months": [1, 2, 3],
            "academic_year": str(year.id), "billing_year": str(billing_year.id),
            "class_info": str(student.class_info_id),
        }, format="json")  # charges 3000
        self.make_payment(api, student, year, billing_year)  # pays 1000 + 100 discount
        assert student_dues(student) == Decimal("1900.00")
        res = api.get(f"/api/v1/billing/payments/dues/?student={student.id}")
        assert res.status_code == 200
        assert Decimal(res.data["dues"]) == Decimal("1900.00")

    def test_regular_receipt_requires_student(self, billing_setup):
        school, student, year, billing_year, _ = billing_setup
        api = APIClient()
        login(api, "admin_bill", "admin")
        res = self.make_payment(api, student, year, billing_year, student=None)
        assert res.status_code == 400
