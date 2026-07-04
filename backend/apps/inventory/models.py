"""Inventory (the undocumented-but-live legacy production module):
categories, items and stock transactions. Stock level is derived, never
stored: sum of quantity x direction. Directions verified against Cent-New:
purchase +, issue -, wastage -, adjustment carries a signed quantity."""

from django.db import models

from apps.academics.models import AcademicYear
from apps.billing.models import BillingYear
from apps.core.models import TenantScopedModel


class Category(TenantScopedModel):
    name = models.CharField(max_length=60)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "Categories"

    def __str__(self):
        return self.name


class Item(TenantScopedModel):
    name = models.CharField(max_length=100)
    category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="items"
    )
    unit = models.CharField(max_length=20, blank=True, default="")  # pcs/kg/ltr
    # low-stock threshold; reports flag items at/below this
    reorder_level = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class StockTransaction(TenantScopedModel):
    class TxnType(models.TextChoices):
        PURCHASE = "purchase", "Purchase"      # stock in
        ISSUE = "issue", "Issue"               # stock out to a party/purpose
        ADJUSTMENT = "adjustment", "Adjustment"  # signed correction
        WASTAGE = "wastage", "Wastage"         # written off

    DIRECTION = {
        TxnType.PURCHASE: 1,
        TxnType.ISSUE: -1,
        TxnType.ADJUSTMENT: 1,  # adjustment quantity is already signed
        TxnType.WASTAGE: -1,
    }

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="transactions")
    txn_type = models.CharField(max_length=10, choices=TxnType.choices)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    date_bs = models.CharField(max_length=10)
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="+")
    billing_year = models.ForeignKey(
        BillingYear, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    supplier = models.CharField(max_length=100, blank=True, default="")
    party_or_purpose = models.CharField(max_length=150, blank=True, default="")
    remarks = models.CharField(max_length=250, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return f"{self.get_txn_type_display()} {self.quantity} {self.item}"

    @property
    def signed_quantity(self):
        return self.quantity * self.DIRECTION[self.TxnType(self.txn_type)]
