"""
People / campus reports — the non-finance half of the legacy Reports menu.

Ports (legacy leaf → endpoint):
- Recent enrollments / New admissions / Enrollments history → AdmissionsReportView
- Staff details            → StaffDetailsReportView
- Transportation history   → TransportHistoryReportView
- Homework report          → HomeworkGivenReportView
- Student attendance report / overall report → AttendanceSummaryReportView

Students-profile-print reuses the existing students API on the frontend; it
needs no bespoke endpoint here.
"""

from django.db.models import Count, Prefetch, Q
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.academics.models import AcademicYear, ClassInfo
from apps.attendance.models import StudentAttendanceRecord
from apps.core.dates import bs_day_utc_range
from apps.homework.models import Homework
from apps.identity.models import Role
from apps.people.models import Staff, Student, StudentGuardian
from apps.transport.models import BusStation, RiderSubscription

from .base import ROW_CAP, ReportView


def _primary_guardian(student):
    links = list(student.guardian_links.all())
    primary = next((l for l in links if l.is_primary_contact), links[0] if links else None)
    return primary.guardian if primary else None


class AdmissionsReportView(ReportView):
    """Enrollment register. With academic_year it is the legacy "new
    admissions" sheet (students admitted IN that year); without it, the
    recent-enrollments feed ordered by enrollment time."""

    permission_code = "students"

    def get(self, request):
        school = self.school(request)
        ay_id = request.query_params.get("academic_year")
        class_id = request.query_params.get("class_info")
        status = request.query_params.get("status")

        qs = Student.objects.filter(school=school)
        year = None
        if ay_id:
            year = AcademicYear.objects.filter(school=school, id=ay_id).first()
            if year is None:
                raise ValidationError({"academic_year": "Unknown academic year."})
            qs = qs.filter(academic_year=year)  # admission year, not class year
        if class_id:
            qs = qs.filter(class_info_id=class_id)
        if status:
            qs = qs.filter(status=status)

        total = qs.count()
        by_gender = dict(qs.values_list("gender").annotate(n=Count("id")))
        rows = []
        for s in (
            qs.select_related("class_info", "academic_year")
            .prefetch_related(
                Prefetch(
                    "guardian_links",
                    queryset=StudentGuardian.objects.select_related("guardian"),
                )
            )
            .order_by("-created_at")[:ROW_CAP]
        ):
            guardian = _primary_guardian(s)
            rows.append({
                "id": str(s.id),
                "name": s.full_name,
                "gender": s.gender,
                "class_label": str(s.class_info),
                "roll_no": s.roll_no,
                "regd_no": s.regd_no,
                "contact": s.contact,
                "address": s.address,
                "birth_date_bs": s.birth_date_bs,
                "guardian_name": guardian.name if guardian else "",
                "guardian_contact": guardian.contact if guardian else "",
                "previous_school": s.previous_school,
                "admission_year": s.academic_year.name if s.academic_year_id else "",
                "status": s.status,
                "enrolled_at": s.created_at.date().isoformat(),
            })
        return Response({
            "rows": rows,
            "summary": {
                "count": total,
                "male": by_gender.get("male", 0),
                "female": by_gender.get("female", 0),
                "academic_year": year.name if year else "",
            },
            "truncated": total > len(rows),
        })


class StaffDetailsReportView(ReportView):
    """Printable staff directory with full employment details."""

    permission_code = "staff"

    def get(self, request):
        school = self.school(request)
        status = request.query_params.get("status") or Staff.Status.EMPLOYED

        qs = Staff.objects.filter(school=school)
        if status != "all":
            qs = qs.filter(status=status)

        total = qs.count()
        rows = [
            {
                "id": str(s.id),
                "name": s.full_name,
                "role": s.role.name,
                "gender": s.gender,
                "primary_contact": s.primary_contact,
                "secondary_contact": s.secondary_contact,
                "email": s.email,
                "address": s.address,
                "qualification": s.qualification,
                "joined_date_bs": s.joined_date_bs,
                "birth_date_bs": s.birth_date_bs,
                "primary_subject": s.primary_subject.name if s.primary_subject_id else "",
                "secondary_subject": s.secondary_subject.name if s.secondary_subject_id else "",
                "status": s.status,
                "has_login": s.account_id is not None,
            }
            for s in qs.select_related("role", "primary_subject", "secondary_subject")
            .order_by("first_name", "last_name")[:ROW_CAP]
        ]
        return Response({
            "rows": rows,
            "summary": {"count": total},
            "truncated": total > len(rows),
        })


class TransportHistoryReportView(ReportView):
    """Riders by station/class with contacts — the transportation report."""

    permission_code = "transport"

    def get(self, request):
        school = self.school(request)
        station_id = request.query_params.get("bus_station")
        class_id = request.query_params.get("class_info")
        include_inactive = (
            request.query_params.get("include_inactive") == "true"
            and request.user.role == Role.ADMIN
        )
        manager = RiderSubscription.all_objects if include_inactive else RiderSubscription.objects

        qs = manager.filter(school=school)
        if station_id:
            if not BusStation.objects.filter(school=school, id=station_id).exists():
                raise ValidationError({"bus_station": "Unknown station."})
            qs = qs.filter(bus_station_id=station_id)
        if class_id:
            qs = qs.filter(student__class_info_id=class_id)

        total = qs.count()
        rows = []
        for r in (
            qs.select_related("student", "student__class_info", "bus_station")
            .prefetch_related(
                Prefetch(
                    "student__guardian_links",
                    queryset=StudentGuardian.objects.select_related("guardian"),
                )
            )
            .order_by("bus_station__name", "student__first_name")[:ROW_CAP]
        ):
            guardian = _primary_guardian(r.student)
            rows.append({
                "id": str(r.id),
                "name": r.student.full_name,
                "class_label": str(r.student.class_info),
                "station": r.bus_station.name if r.bus_station_id else "",
                "fee": r.bus_station.fee if r.bus_station_id else None,
                "start_date_bs": r.start_date_bs,
                "contact": r.student.contact or (guardian.contact if guardian else ""),
                "guardian_name": guardian.name if guardian else "",
                "is_active": r.is_active,
            })
        return Response({
            "rows": rows,
            "summary": {"count": total},
            "truncated": total > len(rows),
        })


class HomeworkGivenReportView(ReportView):
    """Homework assigned on one BS day: teacher, class, subject, due date.

    Legacy rule kept: NOT scoped to is_active — homework given that day and
    later withdrawn was still given that day."""

    permission_code = "homework"

    def get(self, request):
        school = self.school(request)
        date_bs = self.bs_date(request, "date_bs", required=True)
        try:
            day_start, day_end = bs_day_utc_range(date_bs)
        except Exception:
            raise ValidationError({"date_bs": "Not a valid BS date."})

        rows = [
            {
                "id": str(h.id),
                "teacher": h.staff.full_name,
                "class_label": str(h.class_info),
                "subject": h.subject.name,
                "title": h.title,
                "description": h.description,
                "due_date_bs": h.due_date_bs,
                "attachments": h.attachments.count(),
                "is_active": h.is_active,
            }
            for h in Homework.all_objects.filter(
                school=school, created_at__gte=day_start, created_at__lt=day_end
            )
            .select_related("staff", "class_info", "subject")
            .prefetch_related("attachments")
            .order_by("staff__first_name", "class_info__display_name")[:ROW_CAP]
        ]
        return Response({"rows": rows, "summary": {"count": len(rows), "date_bs": date_bs}})


class AttendanceSummaryReportView(ReportView):
    """Attendance over a BS date range.

    scope=class (default, needs class_info): one row per student on the
    roster — days marked / present / absent and the rate. scope=school:
    one row per class — sessions held and present/absent totals."""

    permission_code = "attendance"

    def get(self, request):
        school = self.school(request)
        from_bs = self.bs_date(request, "from_bs", required=True)
        to_bs = self.bs_date(request, "to_bs", required=True)
        if from_bs > to_bs:
            raise ValidationError({"from_bs": "from_bs must not be after to_bs."})
        scope = request.query_params.get("scope") or "class"
        in_range = Q(session__date_bs__gte=from_bs, session__date_bs__lte=to_bs)

        if scope == "school":
            per_class: dict = {}
            for row in (
                StudentAttendanceRecord.objects.filter(in_range, session__school=school)
                .values_list("session__class_info")
                .annotate(
                    marked=Count("id"),
                    present=Count("id", filter=Q(present=True)),
                    days=Count("session__date_bs", distinct=True),
                )
            ):
                per_class[row[0]] = row[1:]
            labels = {
                c.id: str(c)
                for c in ClassInfo.objects.filter(school=school, id__in=per_class.keys())
            }
            rows = [
                {
                    "class_info": str(class_id),
                    "class_label": labels.get(class_id, ""),
                    "days_marked": days,
                    "marked": marked,
                    "present": present,
                    "absent": marked - present,
                }
                for class_id, (marked, present, days) in per_class.items()
            ]
            rows.sort(key=lambda r: r["class_label"])
            return Response({
                "rows": rows,
                "summary": {
                    "classes": len(rows),
                    "present": sum(r["present"] for r in rows),
                    "absent": sum(r["absent"] for r in rows),
                },
            })

        class_id = request.query_params.get("class_info")
        class_info = ClassInfo.objects.filter(school=school, id=class_id).first()
        if class_info is None:
            raise ValidationError({"class_info": "Pick a class for the class scope."})

        stats = {
            row[0]: row[1:]
            for row in StudentAttendanceRecord.objects.filter(
                in_range, session__school=school, session__class_info=class_info
            )
            .values_list("student")
            .annotate(marked=Count("id"), present=Count("id", filter=Q(present=True)))
        }
        days_held = (
            StudentAttendanceRecord.objects.filter(
                in_range, session__school=school, session__class_info=class_info
            )
            .values("session__date_bs")
            .distinct()
            .count()
        )
        # Roster ∪ marked students: historical members who since left/moved
        # still belong on the sheet for the days they were marked.
        roster = {
            s.id: s
            for s in Student.objects.filter(
                school=school, class_info=class_info, status=Student.Status.RUNNING
            )
        }
        extra_ids = set(stats) - set(roster)
        if extra_ids:
            for s in Student.objects.filter(school=school, id__in=extra_ids):
                roster[s.id] = s

        rows = []
        for sid, student in roster.items():
            marked, present = stats.get(sid, (0, 0))
            rows.append({
                "student_id": str(sid),
                "name": student.full_name,
                "roll_no": student.roll_no,
                "marked": marked,
                "present": present,
                "absent": marked - present,
                "rate": round(present * 100 / marked, 1) if marked else None,
            })
        rows.sort(key=lambda r: (r["roll_no"], r["name"]))
        return Response({
            "rows": rows,
            "summary": {
                "class_label": str(class_info),
                "days_marked": days_held,
                "students": len(rows),
            },
        })
