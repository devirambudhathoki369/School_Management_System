from rest_framework.routers import DefaultRouter

from .views import ClassAttendanceSessionViewSet, StaffAttendanceRecordViewSet

router = DefaultRouter()
router.register("sessions", ClassAttendanceSessionViewSet, basename="attendance-session")
router.register("staff", StaffAttendanceRecordViewSet, basename="staff-attendance")

urlpatterns = router.urls
