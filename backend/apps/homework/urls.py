from apps.core.routers import ApiRouter

from .views import HomeworkStaffLookupViewSet, HomeworkViewSet, SubmissionViewSet

router = ApiRouter()
router.register("assignments", HomeworkViewSet, basename="homework")
router.register("submissions", SubmissionViewSet, basename="homework-submission")
router.register("staff-lookup", HomeworkStaffLookupViewSet, basename="homework-staff")

urlpatterns = router.urls
