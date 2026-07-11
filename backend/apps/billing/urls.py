from django.urls import path
from apps.core.routers import ApiRouter

from .views import (
    BillingYearListView,
    ChargeBatchViewSet,
    ChargeViewSet,
    FeeScheduleViewSet,
    FeeTitleViewSet,
    PaymentViewSet,
    StandingDiscountViewSet,
)

router = ApiRouter()
router.register("fee-titles", FeeTitleViewSet, basename="fee-title")
router.register("fees", FeeScheduleViewSet, basename="fee")
router.register("discounts", StandingDiscountViewSet, basename="discount")
router.register("charge-batches", ChargeBatchViewSet, basename="charge-batch")
router.register("charges", ChargeViewSet, basename="charge")
router.register("payments", PaymentViewSet, basename="payment")

urlpatterns = [
    path("years/", BillingYearListView.as_view(), name="billing-years"),
    *router.urls,
]
