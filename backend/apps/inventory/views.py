from django.db.models import Case, DecimalField, F, Sum, When

from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import Category, Item, StockTransaction
from .serializers import CategorySerializer, ItemSerializer, StockTransactionSerializer

MANAGERS = (Role.ADMIN, Role.STAFF)


class CategoryViewSet(TenantScopedViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    allowed_roles = MANAGERS
    permission_code = "inventory"


class ItemViewSet(TenantScopedViewSet):
    queryset = Item.objects.select_related("category")
    serializer_class = ItemSerializer
    allowed_roles = MANAGERS
    permission_code = "inventory"

    def get_queryset(self):
        signed = Case(
            *[
                When(
                    transactions__txn_type=txn_type,
                    then=F("transactions__quantity") * direction,
                )
                for txn_type, direction in StockTransaction.DIRECTION.items()
            ],
            output_field=DecimalField(max_digits=14, decimal_places=2),
        )
        return (
            super()
            .get_queryset()
            .annotate(stock=Sum(signed, filter=None))
            .order_by("name")
        )


class StockTransactionViewSet(TenantScopedViewSet):
    queryset = StockTransaction.objects.select_related("item")
    serializer_class = StockTransactionSerializer
    allowed_roles = MANAGERS
    permission_code = "inventory"
    http_method_names = ["get", "post", "delete", "head", "options"]  # movements, not edits

    def get_queryset(self):
        qs = super().get_queryset()
        item = self.request.query_params.get("item")
        if item:
            qs = qs.filter(item=item)
        return qs.order_by("-date_bs")
