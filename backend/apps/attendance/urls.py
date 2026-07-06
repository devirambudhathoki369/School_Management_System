from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ClassAttendanceSessionViewSet,
    RosterView,
    StaffAttendanceRecordViewSet,
)

router = DefaultRouter()
router.register("sessions", ClassAttendanceSessionViewSet, basename="attendance-session")
router.register("staff", StaffAttendanceRecordViewSet, basename="staff-attendance")

urlpatterns = [
    path("roster/", RosterView.as_view(), name="attendance-roster"),
    *router.urls,
]
