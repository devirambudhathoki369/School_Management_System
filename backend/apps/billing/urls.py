from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    BillingYearListView,
    ChargeBatchViewSet,
    ChargeViewSet,
    FeeScheduleViewSet,
    FeeTitleViewSet,
    PaymentViewSet,
    StandingDiscountViewSet,
)

router = DefaultRouter()
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
