"""
Double-entry accounting (legacy Cent-New `accounting` app, DOCUMENTATION.md
§10), rebuilt around ONE voucher table:

- The four legacy entry tables (income/expense/journal/contra) unify into
  Voucher(voucher_type=...) with per-(school, fiscal year, type) serials —
  legacy numbering (INV-n/EXV-n/JRV-n/CNV-n) is preserved; production
  serials verified duplicate-free, so counters continue from the imported
  maximum.
- Every VoucherLine stores an explicit Dr/Cr side. Legacy derived the side
  at REPORT time (journal particulars carried it; income/expense sides came
  from the ledger group's category via IE_TYPES). Deriving once at write
  time makes every report a plain aggregate.
- The legacy income/expense header ledger (the cash/bank account money
  moved through) is kept as `cash_ledger` AND as the balancing line, which
  is exactly how legacy stored it (a particular with amount = sum of the
  others).
- A deferred constraint trigger (migration 0002) enforces that every
  voucher balances at commit. The 4 unbalanced legacy journal vouchers and
  16 soft-deleted entries missing their balancing line import with
  needs_review=True, which the trigger exempts (finding #2).

Fiscal years here are PER SCHOOL (legacy AccountingEconomicYear), distinct
from the deployment-wide billing.BillingYear; the `previous` chain drives
year-end closing (a later phase).
"""

from django.db import models

from apps.core.models import BaseModel, TenantScopedModel
from apps.tenants.models import School


class FiscalYear(TenantScopedModel):
    name = models.CharField(max_length=20)
    start_date_bs = models.CharField(max_length=10)
    end_date_bs = models.CharField(max_length=10)
    closed = models.BooleanField(default=False)
    previous = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="next_years"
    )
    remarks = models.CharField(max_length=50, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uniq_fiscal_year_name"),
        ]

    def __str__(self):
        return self.name


class BalanceSide(models.TextChoices):
    DEBIT = "dr", "Dr."
    CREDIT = "cr", "Cr."


class LedgerGroup(models.Model):
    """Seeded reference table of the 34 legacy ledger groups (see groups.py).
    `code` keeps the stable legacy id."""

    class Category(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expense"
        ASSET = "asset", "Asset"
        LIABILITY = "liability", "Liability"
        EQUITY = "equity", "Equity"

    class CashFlow(models.TextChoices):
        OPERATING = "operating", "Operating"
        INVESTING = "investing", "Investing"
        FINANCING = "financing", "Financing"

    code = models.PositiveSmallIntegerField(primary_key=True)
    name = models.CharField(max_length=40)
    natural_side = models.CharField(max_length=2, choices=BalanceSide.choices)
    category = models.CharField(max_length=10, choices=Category.choices)
    cash_flow = models.CharField(
        max_length=10, choices=CashFlow.choices, blank=True, default=""
    )

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return self.name


class LedgerAccount(TenantScopedModel):
    name = models.CharField(max_length=60)
    group = models.ForeignKey(LedgerGroup, on_delete=models.PROTECT, related_name="+")
    address = models.CharField(max_length=50, blank=True, default="")
    contact = models.CharField(max_length=15, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [models.Index(fields=["school", "group"])]

    def __str__(self):
        return self.name


class OpeningBalance(TenantScopedModel):
    """A ledger's opening balance for one fiscal year; year-end closing
    writes the next year's rows."""

    ledger = models.ForeignKey(LedgerAccount, on_delete=models.CASCADE, related_name="balances")
    fiscal_year = models.ForeignKey(FiscalYear, on_delete=models.CASCADE, related_name="+")
    side = models.CharField(max_length=2, choices=BalanceSide.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["ledger", "fiscal_year"], name="uniq_opening_balance"
            ),
        ]

    def __str__(self):
        return f"{self.ledger}: {self.amount} {self.side} ({self.fiscal_year})"


class VoucherType(models.TextChoices):
    INCOME = "income", "Income"
    EXPENSE = "expense", "Expense"
    JOURNAL = "journal", "Journal"
    CONTRA = "contra", "Contra"


VOUCHER_PREFIX = {
    VoucherType.INCOME: "INV",
    VoucherType.EXPENSE: "EXV",
    VoucherType.JOURNAL: "JRV",
    VoucherType.CONTRA: "CNV",
}


class VoucherSerialCounter(models.Model):
    """Per (school, fiscal year, voucher type) numbering, locked FOR UPDATE
    inside the voucher transaction. Seeded from the imported legacy maxima
    so new vouchers continue the sequence."""

    id = models.BigAutoField(primary_key=True)
    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name="+")
    fiscal_year = models.ForeignKey(FiscalYear, on_delete=models.CASCADE, related_name="+")
    voucher_type = models.CharField(max_length=8, choices=VoucherType.choices)
    last_serial = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["school", "fiscal_year", "voucher_type"],
                name="uniq_voucher_serial_counter",
            ),
        ]

    def __str__(self):
        return f"{self.school} {self.fiscal_year} {self.voucher_type}: {self.last_serial}"


class Voucher(TenantScopedModel):
    class Mode(models.TextChoices):
        CASH = "cash", "Cash"
        BANK = "bank", "Bank"

    voucher_type = models.CharField(max_length=8, choices=VoucherType.choices, db_index=True)
    serial = models.PositiveIntegerField()
    date_bs = models.CharField(max_length=10)
    fiscal_year = models.ForeignKey(FiscalYear, on_delete=models.PROTECT, related_name="+")
    # income/expense/contra only: the cash/bank account money moved through
    # (the legacy entry header ledger). Its balancing line is also stored.
    cash_ledger = models.ForeignKey(
        LedgerAccount, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    mode = models.CharField(max_length=4, choices=Mode.choices, blank=True, default="")
    remarks = models.CharField(max_length=250, blank=True, default="")
    # legacy data quirks (unbalanced/patched vouchers): exempt from the
    # balance trigger and surfaced to the accountant
    needs_review = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # unique per TYPE: the four legacy entry tables had independent id
    # sequences, so income #1 and journal #1 are different vouchers
    legacy_id = models.BigIntegerField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["school", "fiscal_year", "voucher_type", "serial"],
                name="uniq_voucher_serial",
            ),
            models.UniqueConstraint(
                fields=["voucher_type", "legacy_id"],
                condition=models.Q(legacy_id__isnull=False),
                name="uniq_voucher_legacy_id",
            ),
        ]
        indexes = [models.Index(fields=["school", "fiscal_year", "date_bs"])]

    def __str__(self):
        return self.number

    @property
    def number(self) -> str:
        return f"{VOUCHER_PREFIX[VoucherType(self.voucher_type)]}-{self.serial}"


class VoucherLine(BaseModel):
    """One ledger movement. `side` is explicit — stored at write time using
    the legacy report-time derivation (groups.py) for income/expense, the
    client's Dr/Cr for journal/contra."""

    voucher = models.ForeignKey(Voucher, on_delete=models.CASCADE, related_name="lines")
    ledger = models.ForeignKey(LedgerAccount, on_delete=models.PROTECT, related_name="lines")
    side = models.CharField(max_length=2, choices=BalanceSide.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    remarks = models.CharField(max_length=250, blank=True, default="")

    def __str__(self):
        return f"{self.ledger} {self.side} {self.amount}"
