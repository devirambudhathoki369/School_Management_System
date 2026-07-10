from django.urls import path

from .views import (
    ChildAttendanceView,
    ChildFeesView,
    ChildHomeworkView,
    ChildResultsView,
    ChildrenView,
    NoticesView,
    PortalCalendarView,
)

urlpatterns = [
    path("children/", ChildrenView.as_view(), name="portal-children"),
    path(
        "children/<uuid:student_id>/attendance/",
        ChildAttendanceView.as_view(),
        name="portal-child-attendance",
    ),
    path(
        "children/<uuid:student_id>/fees/",
        ChildFeesView.as_view(),
        name="portal-child-fees",
    ),
    path(
        "children/<uuid:student_id>/results/",
        ChildResultsView.as_view(),
        name="portal-child-results",
    ),
    path(
        "children/<uuid:student_id>/homework/",
        ChildHomeworkView.as_view(),
        name="portal-child-homework",
    ),
    path("notices/", NoticesView.as_view(), name="portal-notices"),
    path("calendar/", PortalCalendarView.as_view(), name="portal-calendar"),
]
