from apps.core.routers import ApiRouter

from .views import (
    AcademicYearViewSet,
    BatchViewSet,
    ClassInfoViewSet,
    CourseViewSet,
    CurrentYearPointerViewSet,
    SectionViewSet,
    SubjectViewSet,
)

router = ApiRouter()
router.register("years", AcademicYearViewSet, basename="academic-year")
router.register("year-pointers", CurrentYearPointerViewSet, basename="year-pointer")
router.register("courses", CourseViewSet, basename="course")
router.register("batches", BatchViewSet, basename="batch")
router.register("sections", SectionViewSet, basename="section")
router.register("classes", ClassInfoViewSet, basename="class-info")
router.register("subjects", SubjectViewSet, basename="subject")

urlpatterns = router.urls
