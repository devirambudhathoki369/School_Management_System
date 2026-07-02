"""
Student billing: fee structure, charges (ledgers) and payments (receipts).

This is the rewrite of the legacy JSON-blob billing (DOCUMENTATION.md §18.3):
every money movement is an explicit LINE row, so balances are verifiable SQL,
not JSON spelunking. Money invariants preserved (§19):

- M1: Payment.total_paid does NOT have discount pre-subtracted; the discount
  is its own column (and DISCOUNT lines). Any report must respect this.
- M2 (fixed): receipt serials are per (school, academic-year, kind) counters
  allocated inside the payment transaction — the legacy max+1 raced and left
  25,627 duplicate serials; historical serials import as display-only.
- M3: a payment snapshots the student's class at payment time.
- M4: line labels snapshot the fee-title name at write time.
- M5/M6: one fee per (class, title); a section-specific fee overrides the
  generic one (resolution in services.fees).
- M7: reserved legacy titles are typed lines; CARRY_FORWARD_OUT is a
  negative balancing entry and never collectable.
- D-rules (corrected by production data): a standing discount stores flat
  and/or percentage — PERCENTAGE WINS when set (18,902 rows have both; the
  flat amount is a cached derivation). fee_title None = transport discount.
"""

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.academics.models import AcademicYear, ClassInfo
from apps.core.models import BaseModel, TenantScopedModel
from apps.people.models import Student
from apps.tenants.models import School


class BillingYear(BaseModel):
    """Deployment-wide billing (economic) year — global, like legacy."""

    name = models.CharField(max_length=20, unique=True)
    start_date_bs = models.CharField(max_length=10)
    end_date_bs = models.CharField(max_length=10)
    closed = models.BooleanField(default=False)
    remarks = models.CharField(max_length=100, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class FeeTitle(TenantScopedModel):
    class Kind(models.TextChoices):
        REGULAR = "regular", "Regular fee"
        CASH_RECEIPT = "cash_receipt", "Cash receipt"

    name = models.CharField(max_length=60)
    months = ArrayField(models.PositiveSmallIntegerField(), default=list, blank=True)
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.REGULAR)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class FeeSchedule(TenantScopedModel):
    """Amount of one fee title for one class (M6)."""

    class_info = models.ForeignKey(ClassInfo, on_delete=models.CASCADE, related_name="fees")
    fee_title = models.ForeignKey(FeeTitle, on_delete=models.PROTECT, related_name="schedules")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["class_info", "fee_title"], name="uniq_fee"),
        ]

    def __str__(self):
        return f"{self.fee_title}: {self.amount} ({self.class_info})"


class StandingDiscount(TenantScopedModel):
    """Per-student recurring discount, academic-year-scoped (D2)."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="discounts")
    # None = transport discount (applies to the bus-station fee)
    fee_title = models.ForeignKey(
        FeeTitle, null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    flat_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    percentage = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    academic_year = models.ForeignKey(
        AcademicYear, null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    remarks = models.CharField(max_length=100, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.CheckConstraint(
                condition=models.Q(flat_amount__isnull=False)
                | models.Q(percentage__isnull=False),
                name="discount_has_amount_or_pct",
            ),
        ]

    def __str__(self):
        return f"{self.student}: {self.fee_title or 'transport'}"


class LineType(models.TextChoices):
    """Typed replacements for the legacy reserved JSON keys (M7)."""

    FEE = "fee", "Fee"
    TRANSPORT = "transport", "Transportation"          # legacy 'tn'
    OLD_DUES = "old_dues", "Old dues"                  # legacy 'od'
    OPENING_BALANCE = "opening_balance", "Opening balance"  # legacy 'ob'
    DISCOUNT = "discount", "Discount"                  # legacy 'discounts'
    LIBRARY_FINE = "library_fine", "Library fine"      # legacy 'lib_fine'
    CARRY_FORWARD_OUT = "carry_forward_out", "Carry forward out"  # legacy 'cfo'
    OTHER = "other", "Other"


class ChargeBatch(TenantScopedModel):
    """One billing run charging a class for months (legacy LedgerPosting)."""

    date_bs = models.CharField(max_length=10)
    months = ArrayField(models.PositiveSmallIntegerField(), default=list, blank=True)
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="+")
    billing_year = models.ForeignKey(BillingYear, on_delete=models.PROTECT, related_name="+")
    class_info = models.ForeignKey(ClassInfo, on_delete=models.PROTECT, related_name="+")
    remarks = models.CharField(max_length=100, blank=True, default="")
    created_by = models.ForeignKey(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Charge batches"

    def __str__(self):
        return f"Batch {self.date_bs} {self.class_info}"


class Charge(TenantScopedModel):
    """What one student owes from one billing run (legacy StudentLedger)."""

    batch = models.ForeignKey(
        ChargeBatch, null=True, blank=True, on_delete=models.PROTECT, related_name="charges"
    )
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="charges")
    date_bs = models.CharField(max_length=10)
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="+")
    billing_year = models.ForeignKey(BillingYear, on_delete=models.PROTECT, related_name="+")
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    remarks = models.CharField(max_length=100, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [models.Index(fields=["school", "student"])]

    def __str__(self):
        return f"{self.student}: {self.total} on {self.date_bs}"


class ChargeLine(BaseModel):
    charge = models.ForeignKey(Charge, on_delete=models.CASCADE, related_name="lines")
    line_type = models.CharField(max_length=20, choices=LineType.choices)
    fee_title = models.ForeignKey(
        FeeTitle, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    label = models.CharField(max_length=60)  # M4: title-name snapshot at write time
    amount = models.DecimalField(max_digits=12, decimal_places=2)  # cfo lines are negative

    def __str__(self):
        return f"{self.label}: {self.amount}"


class ReceiptSerialCounter(models.Model):
    """Per (school, AY, kind) receipt numbering — the M2 fix. Rows are locked
    (SELECT ... FOR UPDATE) inside the payment transaction."""

    id = models.BigAutoField(primary_key=True)
    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name="+")
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=12, choices=FeeTitle.Kind.choices)
    last_serial = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["school", "academic_year", "kind"], name="uniq_serial_counter"
            ),
        ]


class Payment(TenantScopedModel):
    """A receipt (legacy StudentInvoice; kind=cash_receipt for standalone ones)."""

    class Mode(models.TextChoices):
        CASH = "cash", "Cash"
        BANK = "bank", "Bank"
        CHEQUE = "cheque", "Cheque"
        WALLET = "wallet", "Wallet"

    kind = models.CharField(
        max_length=12, choices=FeeTitle.Kind.choices, default=FeeTitle.Kind.REGULAR,
        db_index=True,
    )
    serial = models.PositiveIntegerField(null=True, blank=True)  # new receipts only
    legacy_serial = models.PositiveIntegerField(null=True, blank=True)  # display-only (M2)
    date_bs = models.CharField(max_length=10)
    student = models.ForeignKey(
        Student, null=True, blank=True, on_delete=models.PROTECT, related_name="payments"
    )
    class_info = models.ForeignKey(  # M3: snapshot at payment time
        ClassInfo, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="+")
    billing_year = models.ForeignKey(BillingYear, on_delete=models.PROTECT, related_name="+")
    payment_month = models.PositiveSmallIntegerField(default=0)
    mode = models.CharField(max_length=8, choices=Mode.choices, default=Mode.CASH)
    total_paid = models.DecimalField(max_digits=12, decimal_places=2)  # M1: pre-discount
    total_discount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total_due = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    remarks = models.CharField(max_length=250, blank=True, default="")
    payer_name = models.CharField(max_length=100, blank=True, default="")
    payer_address = models.CharField(max_length=150, blank=True, default="")
    created_by = models.ForeignKey(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [models.Index(fields=["school", "student"])]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "academic_year", "kind", "serial"],
                condition=models.Q(serial__isnull=False),
                name="uniq_receipt_serial",
            ),
        ]

    def __str__(self):
        serial = self.serial or self.legacy_serial
        return f"Receipt {serial}: {self.total_paid}"


class PaymentLine(BaseModel):
    """One title on a receipt (legacy details {amt, dis, due, tdsp, tdsa})."""

    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="lines")
    line_type = models.CharField(max_length=20, choices=LineType.choices)
    fee_title = models.ForeignKey(
        FeeTitle, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    label = models.CharField(max_length=150)  # M4 snapshot / cash-receipt particular
    amount = models.DecimalField(max_digits=12, decimal_places=2)          # amt
    discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)  # dis
    due_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)  # due
    tax_pct = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)  # tdsp
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)  # tdsa

    def __str__(self):
        return f"{self.label}: {self.amount}"
