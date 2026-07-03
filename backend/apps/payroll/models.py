"""
Staff payroll: salary structures, accruals (legacy StaffLedger) and payments
(legacy StaffInvoice), rewritten with explicit line rows.

The legacy M1 asymmetry — student invoice total_paid is pre-discount while
staff invoice total_paid is post-deduction — dies here: a SalaryPayment
stores gross, each deduction, and net_paid explicitly, with a DB check
enforcing net_paid = gross - tds - pf - insurance. Verified against all 543
production staff invoices (sum(amt) - sum(tdsa) == total_paid on every row).

Serial numbers: legacy staff invoice_id was max+1 per (school, economic
year) at read time and production holds 112 duplicate groups. New payments
take serials from a FOR-UPDATE counter per (school, billing_year) — the
fiscal year, matching the legacy fix that moved student receipts off the
academic year; historical serials import as display-only legacy_serial.
"""

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.academics.models import AcademicYear
from apps.billing.models import BillingYear
from apps.core.models import BaseModel, TenantScopedModel
from apps.people.models import Staff
from apps.tenants.models import School


class EarningType(models.TextChoices):
    """The four legacy salary heads (ALL_TITLES in LedgerViewsStaff)."""

    SALARY = "salary", "Basic salary"
    GRADE = "grade", "Grade"
    ALLOWANCE = "allowance", "Allowance"
    EXTRA = "extra", "Extra"


class SalaryStructure(TenantScopedModel):
    """A staff member's agreed salary terms (legacy StaffOtherInfo finance
    fields). Versionable: one row per effective date; the latest active row
    is the current structure."""

    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name="salary_structures")
    effective_from_bs = models.CharField(max_length=10, blank=True, default="")
    basic_salary = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    grade = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    allowance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    extra = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    insurance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    pf_contribution = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    pan_no = models.CharField(max_length=20, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["staff", "effective_from_bs"], name="uniq_salary_structure_version"
            ),
        ]

    def __str__(self):
        return f"{self.staff}: {self.basic_salary}"

    @property
    def monthly_gross(self):
        return self.basic_salary + self.grade + self.allowance + self.extra


class SalaryAccrual(TenantScopedModel):
    """Salary earned by one staff member for a set of months (legacy
    StaffLedger). total is the GROSS amount and always equals the sum of
    its lines (verified: 0 mismatches across 736 production rows)."""

    staff = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="salary_accruals")
    date_bs = models.CharField(max_length=10)
    months = ArrayField(models.PositiveSmallIntegerField(), default=list, blank=True)
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="+")
    billing_year = models.ForeignKey(BillingYear, on_delete=models.PROTECT, related_name="+")
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    remarks = models.CharField(max_length=100, blank=True, default="")
    created_by = models.ForeignKey(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [models.Index(fields=["school", "staff"])]

    def __str__(self):
        return f"{self.staff}: {self.total} on {self.date_bs}"


class SalaryAccrualLine(BaseModel):
    accrual = models.ForeignKey(SalaryAccrual, on_delete=models.CASCADE, related_name="lines")
    earning_type = models.CharField(max_length=10, choices=EarningType.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)

    def __str__(self):
        return f"{self.earning_type}: {self.amount}"


class PayrollSerialCounter(models.Model):
    """Per (school, fiscal year) salary-payment numbering. Rows are locked
    (SELECT ... FOR UPDATE) inside the payment transaction."""

    id = models.BigAutoField(primary_key=True)
    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name="+")
    billing_year = models.ForeignKey(BillingYear, on_delete=models.CASCADE, related_name="+")
    last_serial = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["school", "billing_year"], name="uniq_payroll_serial_counter"
            ),
        ]

    def __str__(self):
        return f"{self.school} {self.billing_year}: {self.last_serial}"


class SalaryPayment(TenantScopedModel):
    """A salary disbursement (legacy StaffInvoice), normalized so every
    amount is explicit:

        gross    — salary liability settled (sum of line amounts)
        net_paid — cash actually handed over (legacy total_paid)
        gross = net_paid + tds + pf + insurance   (DB-enforced)
    """

    class Mode(models.TextChoices):
        CASH = "cash", "Cash"
        BANK = "bank", "Bank"
        CHEQUE = "cheque", "Cheque"
        WALLET = "wallet", "Wallet"

    staff = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="salary_payments")
    serial = models.PositiveIntegerField(null=True, blank=True)  # new payments only
    legacy_serial = models.PositiveIntegerField(null=True, blank=True)  # display-only
    date_bs = models.CharField(max_length=10)
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="+")
    billing_year = models.ForeignKey(BillingYear, on_delete=models.PROTECT, related_name="+")
    payment_month = models.PositiveSmallIntegerField(default=0)
    mode = models.CharField(max_length=8, choices=Mode.choices, default=Mode.CASH)

    gross = models.DecimalField(max_digits=12, decimal_places=2)
    tds_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pf_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    insurance_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_paid = models.DecimalField(max_digits=12, decimal_places=2)
    tds_percent = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    total_due = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    remarks = models.CharField(max_length=250, blank=True, default="")
    created_by = models.ForeignKey(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [models.Index(fields=["school", "staff"])]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "billing_year", "serial"],
                condition=models.Q(serial__isnull=False),
                name="uniq_salary_payment_serial",
            ),
            # The M1 fix: the gross/net relationship is a schema fact, not
            # a reporting convention.
            models.CheckConstraint(
                condition=models.Q(
                    net_paid=models.F("gross")
                    - models.F("tds_amount")
                    - models.F("pf_amount")
                    - models.F("insurance_amount")
                ),
                name="salary_payment_net_identity",
            ),
        ]

    def __str__(self):
        serial = self.serial or self.legacy_serial
        return f"Salary payment {serial}: {self.net_paid}"


class SalaryPaymentLine(BaseModel):
    """One earning head on a payment (legacy details {amt, due, tdsp, tdsa}).
    amount is the GROSS portion settled for the head; tds_amount is what was
    withheld from it."""

    payment = models.ForeignKey(SalaryPayment, on_delete=models.CASCADE, related_name="lines")
    earning_type = models.CharField(max_length=10, choices=EarningType.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)                    # amt
    due_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)  # due
    tds_pct = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)     # tdsp
    tds_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)  # tdsa

    def __str__(self):
        return f"{self.earning_type}: {self.amount}"
