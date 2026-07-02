from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import GuardianViewSet, StaffRoleListView, StaffViewSet, StudentViewSet

router = DefaultRouter()
router.register("students", StudentViewSet, basename="student")
router.register("guardians", GuardianViewSet, basename="guardian")
router.register("staff", StaffViewSet, basename="staff")

urlpatterns = [
    path("staff-roles/", StaffRoleListView.as_view(), name="staff-roles"),
    *router.urls,
]
