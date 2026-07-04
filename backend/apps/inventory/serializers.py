from rest_framework import serializers

from apps.billing.serializers import TenantChildValidationMixin

from .models import Category, Item, StockTransaction


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name"]
        read_only_fields = ["id"]


class ItemSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("category",)
    category_name = serializers.CharField(source="category.name", read_only=True)
    stock = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True, default=None
    )

    class Meta:
        model = Item
        fields = ["id", "name", "category", "category_name", "unit", "reorder_level", "stock"]
        read_only_fields = ["id"]


class StockTransactionSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("item", "academic_year")
    item_name = serializers.CharField(source="item.name", read_only=True)

    class Meta:
        model = StockTransaction
        fields = [
            "id", "item", "item_name", "txn_type", "quantity", "unit_price",
            "total", "date_bs", "academic_year", "billing_year", "supplier",
            "party_or_purpose", "remarks",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs["txn_type"] != StockTransaction.TxnType.ADJUSTMENT and attrs["quantity"] <= 0:
            raise serializers.ValidationError(
                {"quantity": "Must be positive (adjustments carry the sign)."}
            )
        return attrs
