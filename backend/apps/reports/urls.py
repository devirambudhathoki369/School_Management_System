from django.urls import path

from .demographics import (
    ClassStatisticsReportView,
    StaffBirthdaysView,
    StudentBirthdaysView,
)
from .campus import (
    AdmissionsReportView,
    AttendanceSummaryReportView,
    HomeworkGivenReportView,
    StaffDetailsReportView,
    TransportHistoryReportView,
)
from .finance import (
    DuesReportView,
    IncomePlanReportView,
    IntegrityReportView,
    OpeningBalanceReportView,
    PaymentDiscountsReportView,
    PostingsReportView,
    StandingDiscountsReportView,
    StudentLedgersReportView,
    TransactionsReportView,
)

urlpatterns = [
    path("transactions/", TransactionsReportView.as_view(), name="report-transactions"),
    path("postings/", PostingsReportView.as_view(), name="report-postings"),
    path("opening-balances/", OpeningBalanceReportView.as_view(), name="report-opening-balances"),
    path("dues/", DuesReportView.as_view(), name="report-dues"),
    path("student-ledgers/", StudentLedgersReportView.as_view(), name="report-student-ledgers"),
    path("income-plan/", IncomePlanReportView.as_view(), name="report-income-plan"),
    path(
        "standing-discounts/",
        StandingDiscountsReportView.as_view(),
        name="report-standing-discounts",
    ),
    path(
        "payment-discounts/",
        PaymentDiscountsReportView.as_view(),
        name="report-payment-discounts",
    ),
    path("integrity/", IntegrityReportView.as_view(), name="report-integrity"),
    path("admissions/", AdmissionsReportView.as_view(), name="report-admissions"),
    path("staff-details/", StaffDetailsReportView.as_view(), name="report-staff-details"),
    path(
        "transport-history/",
        TransportHistoryReportView.as_view(),
        name="report-transport-history",
    ),
    path("homework-given/", HomeworkGivenReportView.as_view(), name="report-homework-given"),
    path(
        "attendance-summary/",
        AttendanceSummaryReportView.as_view(),
        name="report-attendance-summary",
    ),
    path(
        "class-statistics/",
        ClassStatisticsReportView.as_view(),
        name="report-class-statistics",
    ),
    path(
        "student-birthdays/",
        StudentBirthdaysView.as_view(),
        name="report-student-birthdays",
    ),
    path("staff-birthdays/", StaffBirthdaysView.as_view(), name="report-staff-birthdays"),
]
