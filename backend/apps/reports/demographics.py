"""
Demographic reports — the legacy dashboard's statistics widgets, promoted
to first-class report sheets.

- ClasswiseStudentStatisticsView → ClassStatisticsReportView
- UpcomingBirthdaysView (student/staff) → StudentBirthdaysView / StaffBirthdaysView

Birth dates are BS strings (YYYY-MM-DD), so month/day arithmetic is plain
substring work — the legacy AD-date extraction has no equivalent here.
"""

from django.db.models import Count, Q
from rest_framework.response import Response

from apps.academics.models import ClassInfo
from apps.core.dates import today_bs
from apps.people.models import Staff, Student

from .base import ReportView


class ClassStatisticsReportView(ReportView):
    """Running students per class, split by gender."""

    permission_code = "students"

    def get(self, request):
        school = self.school(request)
        stats = (
            Student.objects.filter(school=school, status=Student.Status.RUNNING)
            .values_list("class_info")
            .annotate(
                male=Count("id", filter=Q(gender="male")),
                female=Count("id", filter=Q(gender="female")),
                other=Count("id", filter=~Q(gender__in=("male", "female"))),
            )
        )
        labels = {
            c.id: str(c)
            for c in ClassInfo.objects.filter(school=school, id__in=[s[0] for s in stats])
        }
        rows = [
            {
                "class_info": str(class_id),
                "class_label": labels.get(class_id, ""),
                "male": male,
                "female": female,
                "other": other,
                "total": male + female + other,
            }
            for class_id, male, female, other in stats
        ]
        rows.sort(key=lambda r: r["class_label"])
        return Response({
            "rows": rows,
            "summary": {
                "classes": len(rows),
                "male": sum(r["male"] for r in rows),
                "female": sum(r["female"] for r in rows),
                "other": sum(r["other"] for r in rows),
                "total": sum(r["total"] for r in rows),
            },
        })


def _birthday_rows(queryset, name_of, extra_of, today: str):
    """People whose BS birth month is the current month, remaining days
    first — the legacy upcoming-birthdays contract, on BS dates."""
    month, day = today[5:7], today[8:10]
    rows = []
    for person in queryset.filter(birth_date_bs__regex=r"^\d{4}-\d{2}-\d{2}$"):
        b_month, b_day = person.birth_date_bs[5:7], person.birth_date_bs[8:10]
        if b_month != month or b_day < day:
            continue
        rows.append({
            "id": str(person.id),
            "name": name_of(person),
            "birth_date_bs": person.birth_date_bs,
            "is_today": b_day == day,
            **extra_of(person),
        })
    rows.sort(key=lambda r: (not r["is_today"], r["birth_date_bs"][8:10]))
    return rows


class StudentBirthdaysView(ReportView):
    permission_code = "students"

    def get(self, request):
        school = self.school(request)
        today = today_bs()
        rows = _birthday_rows(
            Student.objects.filter(school=school, status=Student.Status.RUNNING)
            .select_related("class_info"),
            lambda s: s.full_name,
            lambda s: {"class_label": str(s.class_info)},
            today,
        )
        return Response({"rows": rows, "summary": {"count": len(rows), "date_bs": today}})


class StaffBirthdaysView(ReportView):
    permission_code = "staff"

    def get(self, request):
        school = self.school(request)
        today = today_bs()
        rows = _birthday_rows(
            Staff.objects.filter(school=school, status=Staff.Status.EMPLOYED)
            .select_related("role"),
            lambda s: s.full_name,
            lambda s: {"role": s.role.name},
            today,
        )
        return Response({"rows": rows, "summary": {"count": len(rows), "date_bs": today}})
