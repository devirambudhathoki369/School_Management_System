from rest_framework.routers import DefaultRouter

from .views import HomeworkViewSet, SubmissionViewSet

router = DefaultRouter()
router.register("assignments", HomeworkViewSet, basename="homework")
router.register("submissions", SubmissionViewSet, basename="homework-submission")

urlpatterns = router.urls
