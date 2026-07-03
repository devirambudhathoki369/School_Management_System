from rest_framework.routers import DefaultRouter

from .views import SalaryAccrualViewSet, SalaryPaymentViewSet, SalaryStructureViewSet

router = DefaultRouter()
router.register("structures", SalaryStructureViewSet, basename="salary-structure")
router.register("accruals", SalaryAccrualViewSet, basename="salary-accrual")
router.register("payments", SalaryPaymentViewSet, basename="salary-payment")

urlpatterns = router.urls
