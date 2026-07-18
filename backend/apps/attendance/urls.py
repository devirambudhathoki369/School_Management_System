from django.urls import path

from apps.core.routers import ApiRouter

from .views import (
    ClassAttendanceSessionViewSet,
    RosterView,
    StaffAttendanceRecordViewSet,
)

router = ApiRouter()
router.register("sessions", ClassAttendanceSessionViewSet, basename="attendance-session")
router.register("staff", StaffAttendanceRecordViewSet, basename="staff-attendance")

urlpatterns = [
    path("roster/", RosterView.as_view(), name="attendance-roster"),
    *router.urls,
]
