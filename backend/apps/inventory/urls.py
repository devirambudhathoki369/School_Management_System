from rest_framework.routers import DefaultRouter

from .views import CategoryViewSet, ItemViewSet, StockTransactionViewSet

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="inventory-category")
router.register("items", ItemViewSet, basename="inventory-item")
router.register("transactions", StockTransactionViewSet, basename="stock-transaction")

urlpatterns = router.urls
