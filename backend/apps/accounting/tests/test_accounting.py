"""Accounting: unified vouchers, derived Dr/Cr sides, the balance trigger,
per-type fiscal-year serials, reports, tenant isolation and permissions."""

from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.accounting.models import (
    FiscalYear,
    LedgerAccount,
    LedgerGroup,
    OpeningBalance,
    Voucher,
    VoucherLine,
)
from apps.accounting.services.reports import (
    balance_sheet,
    income_statement,
    ledger_statement,
    trial_balance,
)
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school

ZERO = Decimal("0")


@pytest.fixture
def accounting_setup(db):
    school = make_school("acct")
    fiscal_year = FiscalYear.objects.create(
        school=school, name="2082/83", start_date_bs="2082-04-01", end_date_bs="2083-03-30"
    )
    cash = LedgerAccount.objects.create(school=school, name="Cash", group_id=7)
    bank = LedgerAccount.objects.create(school=school, name="Bank", group_id=3)
    tuition = LedgerAccount.objects.create(school=school, name="Tuition income", group_id=11)
    rent = LedgerAccount.objects.create(school=school, name="Rent expense", group_id=14)
    return school, fiscal_year, cash, bank, tuition, rent


def post_voucher(api, fiscal_year, payload_overrides):
    payload = {
        "date_bs": "2082-05-10",
        "fiscal_year": str(fiscal_year.id),
        **payload_overrides,
    }
    return api.post("/api/v1/accounting/vouchers/", payload, format="json")


def income_payload(cash, tuition, amount="5000.00"):
    return {
        "voucher_type": "income",
        "mode": "cash",
        "cash_ledger": str(cash.id),
        "lines": [{"ledger": str(tuition.id), "amount": amount, "remarks": "Bhadra fees"}],
    }


@pytest.mark.django_db
class TestReferenceData:
    def test_groups_seeded_with_legacy_codes(self, db):
        assert LedgerGroup.objects.count() == 34
        cash = LedgerGroup.objects.get(code=7)
        assert (cash.name, cash.natural_side, cash.category) == ("Cash in Hand", "dr", "asset")
        assert LedgerGroup.objects.get(code=24).name == "Retained Earning"


@pytest.mark.django_db
class TestVoucherPosting:
    def test_income_voucher_gets_balancing_cash_line(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        res = post_voucher(api, fy, income_payload(cash, tuition))
        assert res.status_code == 201, res.content
        voucher = Voucher.objects.get()
        sides = {(line.ledger_id, line.side): line.amount for line in voucher.lines.all()}
        assert sides[(cash.id, "dr")] == Decimal("5000.00")   # auto balancing line
        assert sides[(tuition.id, "cr")] == Decimal("5000.00")  # derived from group
        assert voucher.number == "INV-1"

    def test_expense_voucher_sides(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        res = post_voucher(api, fy, {
            "voucher_type": "expense", "mode": "bank", "cash_ledger": str(bank.id),
            "lines": [{"ledger": str(rent.id), "amount": "12000.00"}],
        })
        assert res.status_code == 201, res.content
        voucher = Voucher.objects.get()
        sides = {(line.ledger_id, line.side): line.amount for line in voucher.lines.all()}
        assert sides[(bank.id, "cr")] == Decimal("12000.00")  # money out
        assert sides[(rent.id, "dr")] == Decimal("12000.00")
        assert voucher.number == "EXV-1"

    def test_wrong_side_ledger_rejected_on_income(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        # an asset ledger as an income particular would land on the cash
        # side and unbalance the voucher (legacy's year-close "bad entry")
        res = post_voucher(api, fy, income_payload(cash, bank))
        assert res.status_code == 400

    def test_journal_must_balance(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        unbalanced = post_voucher(api, fy, {
            "voucher_type": "journal",
            "lines": [
                {"ledger": str(cash.id), "amount": "100.00", "side": "dr"},
                {"ledger": str(tuition.id), "amount": "90.00", "side": "cr"},
            ],
        })
        assert unbalanced.status_code == 400
        balanced = post_voucher(api, fy, {
            "voucher_type": "journal",
            "lines": [
                {"ledger": str(cash.id), "amount": "100.00", "side": "dr"},
                {"ledger": str(tuition.id), "amount": "100.00", "side": "cr"},
            ],
        })
        assert balanced.status_code == 201, balanced.content
        assert Voucher.objects.get().number == "JRV-1"

    def test_serials_per_type_within_fiscal_year(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        first = post_voucher(api, fy, income_payload(cash, tuition))
        second = post_voucher(api, fy, income_payload(cash, tuition))
        expense = post_voucher(api, fy, {
            "voucher_type": "expense", "mode": "cash", "cash_ledger": str(cash.id),
            "lines": [{"ledger": str(rent.id), "amount": "1.00"}],
        })
        assert first.data["number"] == "INV-1"
        assert second.data["number"] == "INV-2"
        assert expense.data["number"] == "EXV-1"  # own series per type

    def test_closed_fiscal_year_rejects_vouchers(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        fy.closed = True
        fy.save(update_fields=["closed"])
        api = APIClient()
        login(api, "admin_acct", "admin")
        res = post_voucher(api, fy, income_payload(cash, tuition))
        assert res.status_code == 400


@pytest.mark.django_db(transaction=True)
class TestBalanceTrigger:
    def make_voucher(self, school, fy, **kwargs):
        return Voucher.objects.create(
            school=school, voucher_type="journal", serial=99,
            date_bs="2082-05-10", fiscal_year=fy, **kwargs,
        )

    def test_db_rejects_unbalanced_voucher_at_commit(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        with pytest.raises(IntegrityError, match="does not balance"):
            with transaction.atomic():
                voucher = self.make_voucher(school, fy)
                VoucherLine.objects.create(
                    voucher=voucher, ledger=cash, side="dr", amount="100.00"
                )
        assert Voucher.objects.filter(serial=99).count() == 0  # rolled back

    def test_needs_review_exempts_legacy_quirks(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        with transaction.atomic():
            voucher = self.make_voucher(school, fy, needs_review=True)
            VoucherLine.objects.create(
                voucher=voucher, ledger=cash, side="dr", amount="100.00"
            )
        assert Voucher.objects.filter(serial=99).exists()


@pytest.mark.django_db
class TestReports:
    def seed_books(self, api, school, fy, cash, tuition, rent):
        OpeningBalance.objects.create(
            school=school, ledger=cash, fiscal_year=fy, side="dr", amount="1000.00"
        )
        post_voucher(api, fy, income_payload(cash, tuition, "5000.00"))
        post_voucher(api, fy, {
            "voucher_type": "expense", "mode": "cash", "cash_ledger": str(cash.id),
            "lines": [{"ledger": str(rent.id), "amount": "2000.00"}],
        })

    def test_trial_balance_balances_and_includes_openings(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        self.seed_books(api, school, fy, cash, tuition, rent)
        tb = trial_balance(school, fy, "2082-04-01", "2083-03-30")
        assert tb["total_debit"] == tb["total_credit"] == Decimal("7000.00")
        # opening 1000 dr appears even though vouchers also touched cash
        assert tb["total_opening_debit"] == Decimal("1000.00")
        assert tb["total_closing_debit"] == Decimal("8000.00")
        cash_group = next(g for g in tb["data"] if g["group"] == "Cash in Hand")
        cash_row = cash_group["ledgers"][0]
        assert cash_row["debit"] == Decimal("5000.00")
        assert cash_row["credit"] == Decimal("2000.00")

    def test_opening_only_ledger_included(self, accounting_setup):
        """Correction over legacy: opening balances survive with no movement."""
        school, fy, cash, bank, tuition, rent = accounting_setup
        OpeningBalance.objects.create(
            school=school, ledger=bank, fiscal_year=fy, side="dr", amount="999.00"
        )
        tb = trial_balance(school, fy, "2082-04-01", "2083-03-30")
        assert tb["total_opening_debit"] == Decimal("999.00")
        assert tb["total_closing_debit"] == Decimal("999.00")

    def test_ledger_statement_shows_counterparties(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        self.seed_books(api, school, fy, cash, tuition, rent)
        entries = ledger_statement(school, fy, cash, "2082-04-01", "2083-03-30")
        assert entries[0]["kind"] == "opening"
        assert entries[0]["amount"] == Decimal("1000.00")
        # cash is the lone dr on the income voucher -> counterparty rows shown
        vouchers = [e for e in entries if e["kind"] == "voucher"]
        assert {(e["ledger"], e["side"]) for e in vouchers} == {
            ("Tuition income", "cr"),  # INV: cash's counterparty
            ("Rent expense", "dr"),    # EXV: cash's counterparty
        }

    def test_income_statement_signs_contra_entries(self, accounting_setup):
        """Correction over legacy: a refund (Dr on an income ledger) reduces
        income; legacy summed side-blind and would have raised it."""
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        self.seed_books(api, school, fy, cash, tuition, rent)
        post_voucher(api, fy, {  # 500 fee refund, posted as a journal
            "voucher_type": "journal",
            "lines": [
                {"ledger": str(tuition.id), "amount": "500.00", "side": "dr"},
                {"ledger": str(cash.id), "amount": "500.00", "side": "cr"},
            ],
        })
        pl = income_statement(school, fy, fy.end_date_bs)
        assert pl["total_income"] == Decimal("4500.00")  # 5000 - 500 refund
        assert pl["total_expense"] == Decimal("2000.00")
        assert pl["net"] == Decimal("2500.00")
        income_rows = [l for g in pl["income"] for l in g["ledgers"]]
        assert income_rows == [
            {"id": str(tuition.id), "ledger": "Tuition income", "amount": Decimal("4500.00")}
        ]

    def test_balance_sheet_balances_with_net_profit(self, accounting_setup):
        """Correction over legacy: net profit lands in equity (legacy left it
        a TODO at 0, so the sheet could never balance)."""
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        capital = LedgerAccount.objects.create(school=school, name="Capital", group_id=6)
        OpeningBalance.objects.create(  # matches the cash opening in seed_books
            school=school, ledger=capital, fiscal_year=fy, side="cr", amount="1000.00"
        )
        self.seed_books(api, school, fy, cash, tuition, rent)
        sheet = balance_sheet(school, fy, fy.end_date_bs)
        # cash = 1000 opening + 5000 income - 2000 expense
        assert sheet["total_assets"] == Decimal("4000.00")
        assert sheet["net_profit"] == Decimal("3000.00")
        assert sheet["total_equity"] == Decimal("4000.00")  # 1000 capital + 3000 net
        assert sheet["total_liabilities"] == ZERO
        assert sheet["balanced"] is True
        cash_group = next(g for g in sheet["assets"] if g["group"] == "Cash in Hand")
        assert cash_group["total"] == Decimal("4000.00")

    def test_statement_endpoints(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        self.seed_books(api, school, fy, cash, tuition, rent)
        pl = api.get(f"/api/v1/accounting/vouchers/income-statement/?fiscal_year={fy.id}")
        assert pl.status_code == 200, pl.content
        assert pl.data["net"] == Decimal("3000.00")
        bs = api.get(f"/api/v1/accounting/vouchers/balance-sheet/?fiscal_year={fy.id}")
        assert bs.status_code == 200, bs.content
        assert bs.data["net_profit"] == Decimal("3000.00")
        assert api.get("/api/v1/accounting/vouchers/balance-sheet/").status_code == 400

    def test_report_endpoint_requires_scope(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        res = api.get("/api/v1/accounting/vouchers/trial-balance/")
        assert res.status_code == 400
        res = api.get(
            f"/api/v1/accounting/vouchers/trial-balance/?fiscal_year={fy.id}"
            f"&start_date_bs=2082-04-01&end_date_bs=2083-03-30"
        )
        assert res.status_code == 200


@pytest.mark.django_db
class TestTenantIsolationAndPermissions:
    def test_cross_school_ledger_rejected(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        make_school("acct2")
        api = APIClient()
        login(api, "admin_acct2", "admin")
        res = post_voucher(api, fy, income_payload(cash, tuition))
        assert res.status_code == 400

    def test_other_school_sees_no_vouchers(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        api = APIClient()
        login(api, "admin_acct", "admin")
        post_voucher(api, fy, income_payload(cash, tuition))
        make_school("peek2")
        other = APIClient()
        login(other, "admin_peek2", "admin")
        assert other.get("/api/v1/accounting/vouchers/").data["results"] == []

    def test_staff_permission_contract(self, accounting_setup):
        school, fy, cash, bank, tuition, rent = accounting_setup
        make_staff(school, "acct_viewer", ["accounting.view"])
        api = APIClient()
        login(api, "acct_viewer", "staff")
        assert api.get("/api/v1/accounting/ledgers/").status_code == 200
        assert post_voucher(api, fy, income_payload(cash, tuition)).status_code == 403
        make_staff(school, "acct_none", [])
        denied = APIClient()
        login(denied, "acct_none", "staff")
        assert denied.get("/api/v1/accounting/ledgers/").status_code == 403
