from django.urls import path
from apps.core.routers import ApiRouter

from .views import (
    GuardianViewSet,
    PendingPhotoViewSet,
    StaffRoleListView,
    StaffViewSet,
    StudentViewSet,
)

router = ApiRouter()
router.register("students", StudentViewSet, basename="student")
router.register("pending-photos", PendingPhotoViewSet, basename="pending-photo")
router.register("guardians", GuardianViewSet, basename="guardian")
router.register("staff", StaffViewSet, basename="staff")

urlpatterns = [
    path("staff-roles/", StaffRoleListView.as_view(), name="staff-roles"),
    *router.urls,
]
