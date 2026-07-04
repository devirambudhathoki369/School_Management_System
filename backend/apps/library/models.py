"""Library: catalog, physical copies and circulation (legacy library app).

The legacy `preferences` JSON becomes typed columns (observed keys in all 6
production rows: fine_per_day, fine_on_damage, shared_to). Book/copy/loan
tables are schema-parity — zero production rows. The legacy copy PK doubled
as the accession number; here the accession number is a plain field, unique
per school."""

from django.db import models

from apps.academics.models import ClassInfo
from apps.core.models import TenantScopedModel
from apps.people.models import Staff, Student
from apps.tenants.models import School


class Library(TenantScopedModel):
    name = models.CharField(max_length=50)
    address = models.CharField(max_length=50, blank=True, default="")
    contacts = models.TextField(blank=True, default="")
    fine_per_day = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    fine_on_damage = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # legacy preferences.shared_to: one library serving a sibling school
    shared_with = models.ForeignKey(
        School, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Libraries"

    def __str__(self):
        return self.name


class Book(TenantScopedModel):
    library = models.ForeignKey(Library, on_delete=models.PROTECT, related_name="books")
    entry_date_bs = models.CharField(max_length=10, blank=True, default="")
    class_info = models.ForeignKey(
        ClassInfo, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    title = models.CharField(max_length=100)
    edition = models.CharField(max_length=10, blank=True, default="")
    place_and_publisher = models.CharField(max_length=50, blank=True, default="")
    isbn_no = models.CharField(max_length=20, blank=True, default="")
    source = models.CharField(max_length=50, blank=True, default="")
    pages = models.PositiveIntegerField(null=True, blank=True)
    quantity = models.PositiveIntegerField(default=1)
    # per-book price drives the damage/lost fine (varies per book)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    published_year = models.CharField(max_length=4, blank=True, default="")
    broad_subject = models.CharField(max_length=100, blank=True, default="")
    geographical_descriptions = models.TextField(blank=True, default="")
    keywords = models.TextField(blank=True, default="")
    note = models.TextField(blank=True, default="")
    vendor = models.CharField(max_length=50, blank=True, default="")
    vendor_contact = models.CharField(max_length=15, blank=True, default="")
    call_no = models.CharField(max_length=10, blank=True, default="")
    personal_author = models.CharField(max_length=50, blank=True, default="")
    corporate_author = models.CharField(max_length=50, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.title


class BookCopy(TenantScopedModel):
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="copies")
    accession_no = models.PositiveBigIntegerField()
    entry_date_bs = models.CharField(max_length=10, blank=True, default="")
    is_lost = models.BooleanField(default=False)
    is_damaged = models.BooleanField(default=False)
    remarks = models.TextField(blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Book copies"
        constraints = [
            models.UniqueConstraint(
                fields=["school", "accession_no"], name="uniq_accession_no"
            ),
        ]

    def __str__(self):
        return f"{self.book} [{self.accession_no}]"


class Loan(TenantScopedModel):
    copy = models.ForeignKey(BookCopy, on_delete=models.PROTECT, related_name="loans")
    student = models.ForeignKey(
        Student, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    staff = models.ForeignKey(
        Staff, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    issued_date_bs = models.CharField(max_length=10)
    due_date_bs = models.CharField(max_length=10)
    returned_date_bs = models.CharField(max_length=10, blank=True, default="")
    # total fine charged at return (late + damage/lost); kept book-linked so
    # the fine report and member history need no ledger parsing
    fine_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    remarks = models.TextField(blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.CheckConstraint(
                condition=models.Q(student__isnull=False) | models.Q(staff__isnull=False),
                name="loan_has_borrower",
            ),
        ]

    def __str__(self):
        return f"{self.copy} -> {self.student or self.staff}"
