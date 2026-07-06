"""
Dashboard: the cross-module snapshot a school opens the day with.

One endpoint, one round trip. Sections are permission-gated the same way
the modules themselves are — a staff account only receives the blocks its
permission codes unlock (admins get everything), so the dashboard can never
leak numbers its viewer could not reach through the module APIs.
"""

from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import Substr
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.dates import today_bs
from apps.core.permissions import RoleAllowed, permission_codes
from apps.identity.models import Role
from apps.tenants.services import resolve_school_for

ZERO = Decimal("0")


def _granted(account) -> set[str]:
    if account.role == Role.ADMIN:
        return set(permission_codes())
    if account.role == Role.STAFF:
        profile = getattr(account, "staff_profile", None)
        return set(profile.permissions or []) if profile else set()
    return set()


def _last_bs_months(today: str, count: int) -> list[tuple[str, int]]:
    """The trailing `count` BS year-months ending at today, oldest first,
    as ("YYYY-MM", month_number) pairs — BS months wrap 12 -> 1 like AD."""
    year, month = int(today[:4]), int(today[5:7])
    months: list[tuple[str, int]] = []
    for _ in range(count):
        months.append((f"{year:04d}-{month:02d}", month))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(months))


def _students_block(school):
    from apps.people.models import Student

    by_gender = dict(
        Student.objects.filter(school=school, status=Student.Status.RUNNING)
        .values_list("gender")
        .annotate(n=Count("id"))
    )
    return {
        "running": sum(by_gender.values()),
        "male": by_gender.get("male", 0),
        "female": by_gender.get("female", 0),
    }


def _staff_block(school):
    from apps.people.models import Staff

    return {"employed": Staff.objects.filter(school=school, status=Staff.Status.EMPLOYED).count()}


def _finance_block(school, today: str):
    from apps.billing.models import Charge, FeeTitle, Payment

    charged = (
        Charge.objects.filter(school=school).aggregate(total=Sum("total"))["total"] or ZERO
    )
    settled = Payment.objects.filter(school=school, kind=FeeTitle.Kind.REGULAR).aggregate(
        paid=Sum("total_paid"), discount=Sum("total_discount")
    )
    dues = charged - (settled["paid"] or ZERO) - (settled["discount"] or ZERO)

    today_row = Payment.objects.filter(school=school, date_bs=today).aggregate(
        collected=Sum("total_paid"), receipts=Count("id")
    )

    months = _last_bs_months(today, 6)
    collected_by_month = dict(
        Payment.objects.filter(school=school, date_bs__gte=f"{months[0][0]}-01")
        .annotate(ym=Substr("date_bs", 1, 7))
        .values_list("ym")
        .annotate(total=Sum("total_paid"))
    )
    return {
        "dues_outstanding": dues,
        "collected_today": today_row["collected"] or ZERO,
        "receipts_today": today_row["receipts"],
        "collected_this_month": collected_by_month.get(months[-1][0], ZERO),
        "trend": [
            {"year_month": ym, "month": month, "collected": collected_by_month.get(ym, ZERO)}
            for ym, month in months
        ],
    }


def _attendance_block(school, today: str):
    from apps.attendance.models import StudentAttendanceRecord

    marked = StudentAttendanceRecord.objects.filter(
        session__school=school, session__date_bs=today
    ).aggregate(total=Count("id"), present=Count("id", filter=Q(present=True)))
    return {
        "marked": marked["total"],
        "present": marked["present"],
        "absent": marked["total"] - marked["present"],
    }


def _recent_receipts(school):
    from apps.billing.models import Payment

    rows = (
        Payment.objects.filter(school=school)
        .select_related("student")
        .order_by("-created_at")[:6]
    )
    return [
        {
            "id": str(p.id),
            "receipt_no": p.serial or p.legacy_serial,
            "name": p.student.full_name if p.student_id else (p.payer_name or "Cash receipt"),
            "date_bs": p.date_bs,
            "mode": p.mode,
            "total_paid": p.total_paid,
        }
        for p in rows
    ]


class DashboardView(APIView):
    permission_classes = [IsAuthenticated, RoleAllowed]
    allowed_roles = (Role.ADMIN, Role.STAFF)

    def get(self, request):
        school = resolve_school_for(request.user)
        if school is None:
            raise PermissionDenied("No school is associated with this account.")
        granted = _granted(request.user)
        today = today_bs()

        payload: dict = {"date_bs": today, "school": school.name}
        if granted & {"students.view", "students.manage"}:
            payload["students"] = _students_block(school)
        if granted & {"staff.view", "staff.manage"}:
            payload["staff"] = _staff_block(school)
        if granted & {"billing.view", "billing.manage"}:
            payload["finance"] = _finance_block(school, today)
            payload["recent_receipts"] = _recent_receipts(school)
        if granted & {"attendance.view", "attendance.manage"}:
            payload["attendance"] = _attendance_block(school, today)
        return Response(payload)
