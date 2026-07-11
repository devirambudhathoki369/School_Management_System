from apps.core.routers import ApiRouter

from .views import CategoryViewSet, ItemViewSet, StockTransactionViewSet

router = ApiRouter()
router.register("categories", CategoryViewSet, basename="inventory-category")
router.register("items", ItemViewSet, basename="inventory-item")
router.register("transactions", StockTransactionViewSet, basename="stock-transaction")

urlpatterns = router.urls
