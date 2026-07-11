from apps.core.routers import ApiRouter

from .views import (
    SalaryAccrualViewSet,
    SalaryPaymentViewSet,
    SalaryStructureViewSet,
    StaffLookupViewSet,
)

router = ApiRouter()
router.register("structures", SalaryStructureViewSet, basename="salary-structure")
router.register("accruals", SalaryAccrualViewSet, basename="salary-accrual")
router.register("payments", SalaryPaymentViewSet, basename="salary-payment")
router.register("staff-lookup", StaffLookupViewSet, basename="payroll-staff-lookup")

urlpatterns = router.urls
