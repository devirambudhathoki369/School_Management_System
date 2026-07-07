from rest_framework.routers import DefaultRouter

from .views import HomeworkStaffLookupViewSet, HomeworkViewSet, SubmissionViewSet

router = DefaultRouter()
router.register("assignments", HomeworkViewSet, basename="homework")
router.register("submissions", SubmissionViewSet, basename="homework-submission")
router.register("staff-lookup", HomeworkStaffLookupViewSet, basename="homework-staff")

urlpatterns = router.urls
