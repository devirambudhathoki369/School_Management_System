"""Year-end (Y1-Y3): academic-year close/undo, promotion dues carry-forward,
and the accounting fiscal-year close/undo."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassInfo, CurrentYearPointer
from apps.accounting.models import (
    FiscalYear,
    LedgerAccount,
    OpeningBalance,
    Voucher,
)
from apps.billing.models import (
    BillingYear,
    Charge,
    ChargeLine,
    FeeTitle,
    LineType,
    Payment,
    PaymentLine,
)
from apps.people.tests.test_tenant_isolation import login, make_school, make_student

ZERO = Decimal("0")


def charge(school, student, year, billing_year, amount, line_type=LineType.FEE):
    row = Charge.objects.create(
        school=school, student=student, date_bs="2082-05-01",
        academic_year=year, billing_year=billing_year, total=amount,
    )
    ChargeLine.objects.create(charge=row, line_type=line_type, label="x", amount=amount)
    return row


def pay(school, student, year, billing_year, amount, discount=0):
    payment = Payment.objects.create(
        school=school, kind=FeeTitle.Kind.REGULAR, date_bs="2082-06-01",
        student=student, academic_year=year, billing_year=billing_year,
        total_paid=amount, total_discount=discount,
    )
    PaymentLine.objects.create(
        payment=payment, line_type=LineType.FEE, label="x",
        amount=amount, discount=discount,
    )
    return payment


@pytest.fixture
def year_end_setup(db):
    school = make_school("yend")
    student = make_student(school, "Rollover")
    year = student.academic_year
    pointer = CurrentYearPointer.objects.create(
        school=school, key="school", academic_year=year
    )
    billing_year = BillingYear.objects.create(
        name="2082/83-ye", start_date_bs="2082-04-01", end_date_bs="2083-03-30"
    )
    return school, student, year, pointer, billing_year


def close_payload(student, billing_year, name="2083-ye"):
    return {
        "classes": [str(student.class_info_id)],
        "billing_year": str(billing_year.id),
        "new_academic_year": {
            "name": name, "start_date_bs": "2083-01-01", "end_date_bs": "2083-12-30",
        },
    }


@pytest.mark.django_db
class TestAcademicYearClose:
    def test_close_writes_opening_balance_and_rolls_year(self, year_end_setup):
        school, student, year, pointer, billing_year = year_end_setup
        charge(school, student, year, billing_year, Decimal("5000.00"))
        pay(school, student, year, billing_year, Decimal("1500.00"), Decimal("500.00"))
        api = APIClient()
        login(api, "admin_yend", "admin")
        res = api.post(
            f"/api/v1/academics/year-pointers/{pointer.id}/close/",
            close_payload(student, billing_year), format="json",
        )
        assert res.status_code == 201, res.content
        # 5000 - 1500 paid - 500 discount = 3000 carried as ob (Y1)
        new_year = AcademicYear.objects.get(school=school, name="2083-ye")
        ob = Charge.objects.get(student=student, academic_year=new_year)
        assert ob.total == Decimal("3000.00")
        assert ob.lines.get().line_type == LineType.OPENING_BALANCE
        for obj in (year, pointer, student):
            obj.refresh_from_db()
        assert year.closed is True
        assert pointer.academic_year_id == new_year.id
        assert pointer.previous_academic_year_id == year.id
        assert student.class_info.academic_year_id == new_year.id  # class rolled

    def test_credit_balance_carries_negative(self, year_end_setup):
        school, student, year, pointer, billing_year = year_end_setup
        charge(school, student, year, billing_year, Decimal("1000.00"))
        pay(school, student, year, billing_year, Decimal("1800.00"))  # prepaid
        api = APIClient()
        login(api, "admin_yend", "admin")
        res = api.post(
            f"/api/v1/academics/year-pointers/{pointer.id}/close/",
            close_payload(student, billing_year), format="json",
        )
        assert res.status_code == 201, res.content
        ob = Charge.objects.get(student=student, academic_year__name="2083-ye")
        assert ob.total == Decimal("-800.00")  # prepaid money must not vanish

    def test_mismatched_year_rows_block_close(self, year_end_setup):
        school, student, year, pointer, billing_year = year_end_setup
        stray_year = AcademicYear.objects.create(
            school=school, name="stray", start_date_bs="2081-01-01",
            end_date_bs="2081-12-30",
        )
        charge(school, student, stray_year, billing_year, Decimal("100.00"))  # drift
        api = APIClient()
        login(api, "admin_yend", "admin")
        res = api.post(
            f"/api/v1/academics/year-pointers/{pointer.id}/close/",
            close_payload(student, billing_year), format="json",
        )
        assert res.status_code == 400  # Y2 guard
        year.refresh_from_db()
        assert year.closed is False

    def test_staff_cannot_close(self, year_end_setup):
        from apps.people.tests.test_module_permissions import make_staff

        school, student, year, pointer, billing_year = year_end_setup
        make_staff(school, "yend_staff", ["academics.manage"])
        api = APIClient()
        login(api, "yend_staff", "staff")
        res = api.post(
            f"/api/v1/academics/year-pointers/{pointer.id}/close/",
            close_payload(student, billing_year), format="json",
        )
        assert res.status_code == 403  # admin-only even with module manage

    def test_undo_restores_everything(self, year_end_setup):
        school, student, year, pointer, billing_year = year_end_setup
        charge(school, student, year, billing_year, Decimal("5000.00"))
        api = APIClient()
        login(api, "admin_yend", "admin")
        api.post(
            f"/api/v1/academics/year-pointers/{pointer.id}/close/",
            close_payload(student, billing_year), format="json",
        )
        res = api.post(f"/api/v1/academics/year-pointers/{pointer.id}/undo-close/")
        assert res.status_code == 200, res.content
        for obj in (year, pointer, student):
            obj.refresh_from_db()
        assert year.closed is False
        assert pointer.academic_year_id == year.id
        assert pointer.previous_academic_year_id is None
        assert student.class_info.academic_year_id == year.id
        assert not AcademicYear.all_objects.filter(name="2083-ye").exists()
        assert Charge.all_objects.filter(student=student).count() == 1  # only original

    def test_undo_blocked_after_new_year_activity(self, year_end_setup):
        school, student, year, pointer, billing_year = year_end_setup
        charge(school, student, year, billing_year, Decimal("5000.00"))
        api = APIClient()
        login(api, "admin_yend", "admin")
        api.post(
            f"/api/v1/academics/year-pointers/{pointer.id}/close/",
            close_payload(student, billing_year), format="json",
        )
        new_year = AcademicYear.objects.get(school=school, name="2083-ye")
        pay(school, student, new_year, billing_year, Decimal("100.00"))  # real activity
        res = api.post(f"/api/v1/academics/year-pointers/{pointer.id}/undo-close/")
        assert res.status_code == 400
        year.refresh_from_db()
        assert year.closed is True  # untouched


@pytest.mark.django_db
class TestPromotionCarryForward:
    def promote(self, api, student, source, target):
        return api.post("/api/v1/people/students/promote/", {
            "students": [str(student.id)],
            "source_class": str(source.id),
            "target_class": str(target.id),
        }, format="json")

    def make_target(self, school, name="2084-promo"):
        target_year = AcademicYear.objects.create(
            school=school, name=name, start_date_bs="2084-01-01", end_date_bs="2084-12-30"
        )
        target_class = ClassInfo.objects.create(
            school=school, education_level="school", grade="two",
            academic_year=target_year,
        )
        return target_year, target_class

    def test_cross_year_promotion_moves_dues(self, year_end_setup):
        school, student, year, pointer, billing_year = year_end_setup
        charge(school, student, year, billing_year, Decimal("4000.00"))
        pay(school, student, year, billing_year, Decimal("1000.00"))
        target_year, target_class = self.make_target(school)
        api = APIClient()
        login(api, "admin_yend", "admin")
        res = self.promote(api, student, student.class_info, target_class)
        assert res.status_code == 200, res.content
        assert res.data == {"promoted": 1, "dues_carried": 1}
        student.refresh_from_db()
        assert student.class_info_id == target_class.id
        ob = Charge.objects.get(student=student, academic_year=target_year)
        assert ob.total == Decimal("3000.00")
        assert ob.lines.get().line_type == LineType.OPENING_BALANCE
        cfo = Charge.objects.get(
            student=student, academic_year=year, lines__line_type=LineType.CARRY_FORWARD_OUT
        )
        assert cfo.total == Decimal("-3000.00")  # source year nets to zero (Y1)

    def test_carry_is_idempotent(self, year_end_setup):
        school, student, year, pointer, billing_year = year_end_setup
        charge(school, student, year, billing_year, Decimal("4000.00"))
        source_class = student.class_info
        target_year, target_class = self.make_target(school)
        api = APIClient()
        login(api, "admin_yend", "admin")
        self.promote(api, student, source_class, target_class)
        # move back, then promote again: the cfo line must not double-count
        student.refresh_from_db()
        student.class_info = source_class
        student.save(update_fields=["class_info"])
        res = self.promote(api, student, source_class, target_class)
        assert res.status_code == 200, res.content
        assert res.data["dues_carried"] == 0
        assert Charge.objects.filter(
            student=student, lines__line_type=LineType.CARRY_FORWARD_OUT
        ).count() == 1

    def test_same_year_promotion_is_plain_move(self, year_end_setup):
        school, student, year, pointer, billing_year = year_end_setup
        charge(school, student, year, billing_year, Decimal("4000.00"))
        section_class = ClassInfo.objects.create(
            school=school, education_level="school", grade="two", academic_year=year
        )
        api = APIClient()
        login(api, "admin_yend", "admin")
        res = self.promote(api, student, student.class_info, section_class)
        assert res.status_code == 200, res.content
        assert res.data["dues_carried"] == 0
        assert Charge.objects.filter(student=student).count() == 1  # untouched


@pytest.mark.django_db
class TestFiscalYearClose:
    @pytest.fixture
    def books(self, year_end_setup):
        school, *_ = year_end_setup
        fy = FiscalYear.objects.create(
            school=school, name="FY 2082/83", start_date_bs="2082-04-01",
            end_date_bs="2083-03-30",
        )
        cash = LedgerAccount.objects.create(school=school, name="Cash", group_id=7)
        income = LedgerAccount.objects.create(school=school, name="Fees", group_id=11)
        expense = LedgerAccount.objects.create(school=school, name="Rent", group_id=14)
        retained = LedgerAccount.objects.create(school=school, name="Retained", group_id=24)
        OpeningBalance.objects.create(
            school=school, ledger=cash, fiscal_year=fy, side="dr", amount="1000.00"
        )
        OpeningBalance.objects.create(  # legacy dropped this; we must not
            school=school, ledger=retained, fiscal_year=fy, side="cr", amount="1000.00"
        )
        return school, fy, cash, income, expense, retained

    def seed_vouchers(self, api, fy, cash, income, expense):
        api.post("/api/v1/accounting/vouchers/", {
            "voucher_type": "income", "mode": "cash", "date_bs": "2082-05-01",
            "fiscal_year": str(fy.id), "cash_ledger": str(cash.id),
            "lines": [{"ledger": str(income.id), "amount": "9000.00"}],
        }, format="json")
        api.post("/api/v1/accounting/vouchers/", {
            "voucher_type": "expense", "mode": "cash", "date_bs": "2082-06-01",
            "fiscal_year": str(fy.id), "cash_ledger": str(cash.id),
            "lines": [{"ledger": str(expense.id), "amount": "4000.00"}],
        }, format="json")

    def close(self, api, fy, retained):
        return api.post(f"/api/v1/accounting/fiscal-years/{fy.id}/close/", {
            "name": "FY 2083/84", "start_date_bs": "2083-04-01",
            "end_date_bs": "2084-03-30", "retained_ledger": str(retained.id),
        }, format="json")

    def test_close_signed_movement_and_retained(self, books):
        school, fy, cash, income, expense, retained = books
        api = APIClient()
        login(api, "admin_yend", "admin")
        self.seed_vouchers(api, fy, cash, income, expense)
        res = self.close(api, fy, retained)
        assert res.status_code == 201, res.content
        new_fy = FiscalYear.objects.get(school=school, name="FY 2083/84")
        assert new_fy.previous_id == fy.id
        obs = {
            ob.ledger_id: (ob.side, ob.amount)
            for ob in OpeningBalance.objects.filter(fiscal_year=new_fy)
        }
        # cash: 1000 dr opening + 9000 in - 4000 out = 6000 dr
        # (the legacy side-blind formula would say 1000 + 9000 + 4000 = 14000)
        assert obs[cash.id] == ("dr", Decimal("6000.00"))
        # retained: own 1000 cr (legacy dropped it) + P&L net 5000 cr
        assert obs[retained.id] == ("cr", Decimal("6000.00"))
        assert income.id not in obs and expense.id not in obs  # P&L reset
        fy.refresh_from_db()
        assert fy.closed is True

    def test_closed_year_rejects_vouchers_and_undo_restores(self, books):
        school, fy, cash, income, expense, retained = books
        api = APIClient()
        login(api, "admin_yend", "admin")
        self.seed_vouchers(api, fy, cash, income, expense)
        self.close(api, fy, retained)
        new_fy = FiscalYear.objects.get(school=school, name="FY 2083/84")
        blocked = api.post("/api/v1/accounting/vouchers/", {
            "voucher_type": "income", "mode": "cash", "date_bs": "2082-07-01",
            "fiscal_year": str(fy.id), "cash_ledger": str(cash.id),
            "lines": [{"ledger": str(income.id), "amount": "1.00"}],
        }, format="json")
        assert blocked.status_code == 400  # closed year locked
        res = api.post(f"/api/v1/accounting/fiscal-years/{fy.id}/undo-close/")
        assert res.status_code == 200, res.content
        fy.refresh_from_db()
        assert fy.closed is False
        assert not FiscalYear.all_objects.filter(id=new_fy.id).exists()
        assert not OpeningBalance.all_objects.filter(fiscal_year_id=new_fy.id).exists()

    def test_undo_blocked_once_new_year_has_vouchers(self, books):
        school, fy, cash, income, expense, retained = books
        api = APIClient()
        login(api, "admin_yend", "admin")
        self.close(api, fy, retained)
        new_fy = FiscalYear.objects.get(school=school, name="FY 2083/84")
        Voucher.objects.create(
            school=school, voucher_type="journal", serial=1,
            date_bs="2083-05-01", fiscal_year=new_fy, needs_review=True,
        )
        res = api.post(f"/api/v1/accounting/fiscal-years/{fy.id}/undo-close/")
        assert res.status_code == 400
