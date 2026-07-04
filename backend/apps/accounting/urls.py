from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    FiscalYearViewSet,
    LedgerAccountViewSet,
    LedgerGroupListView,
    OpeningBalanceViewSet,
    VoucherViewSet,
)

router = DefaultRouter()
router.register("fiscal-years", FiscalYearViewSet, basename="fiscal-year")
router.register("ledgers", LedgerAccountViewSet, basename="ledger-account")
router.register("opening-balances", OpeningBalanceViewSet, basename="opening-balance")
router.register("vouchers", VoucherViewSet, basename="voucher")

urlpatterns = [
    path("groups/", LedgerGroupListView.as_view(), name="ledger-groups"),
    *router.urls,
]
