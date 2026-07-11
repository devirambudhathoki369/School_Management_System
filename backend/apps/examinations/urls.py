from apps.core.routers import ApiRouter

from .views import (
    ActivityDefinitionViewSet,
    ActivityGradeViewSet,
    CharacterCertificateViewSet,
    ExamScheduleEntryViewSet,
    ExamViewSet,
    GradingSchemeViewSet,
    SeatPlanRoomViewSet,
    SubjectResultSheetViewSet,
)

router = ApiRouter()
router.register("exams", ExamViewSet, basename="exam")
router.register("schedule", ExamScheduleEntryViewSet, basename="exam-schedule")
router.register("grading-schemes", GradingSchemeViewSet, basename="grading-scheme")
router.register("sheets", SubjectResultSheetViewSet, basename="result-sheet")
router.register("activities", ActivityDefinitionViewSet, basename="activity")
router.register("activity-grades", ActivityGradeViewSet, basename="activity-grade")
router.register("certificates", CharacterCertificateViewSet, basename="certificate")
router.register("seat-plan-rooms", SeatPlanRoomViewSet, basename="seat-plan-room")

urlpatterns = router.urls
