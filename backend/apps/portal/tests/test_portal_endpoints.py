"""
Guardian portal read surface — scoping is the whole contract here:
children only through StudentGuardian links, results only when published (E1),
school always from the principal (I1), staff/admin tokens rejected outright.
"""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.billing.models import BillingYear, Charge, Payment
from apps.communication.models import CalendarEvent, Notice
from apps.core.dates import today_bs
from apps.examinations.models import Exam, StudentSubjectResult, SubjectResultSheet
from apps.people import services
from apps.people.models import Guardian, StudentGuardian
from apps.people.tests.test_tenant_isolation import (
    PASSWORD,
    login,
    make_school,
    make_student,
)


def guardian_client(guardian: Guardian) -> APIClient:
    account, temp_password, _ = services.provision_portal_access(guardian)
    api = APIClient()
    res = api.post(
        "/api/v1/auth/login/",
        {"username": account.username, "password": temp_password, "role": "guardian"},
    )
    assert res.status_code == 200, res.content
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
    return api


def link(student, guardian, relation="father", primary=True) -> StudentGuardian:
    return StudentGuardian.objects.create(
        student=student, guardian=guardian, relation=relation,
        is_primary_contact=primary,
    )


@pytest.fixture
def family(db):
    """One school, one guardian with two linked children plus one stranger."""
    school = make_school("fam")
    guardian = Guardian.objects.create(
        school=school, name="Hari Prasad", contact="9811111111"
    )
    mine = make_student(school, "Mero")
    sibling = make_student(school, "Bhai")
    stranger = make_student(school, "Aru")
    link(mine, guardian)
    link(sibling, guardian, relation="mother", primary=False)
    return school, guardian, mine, sibling, stranger


@pytest.mark.django_db
class TestPortalScoping:
    def test_children_lists_only_linked_students(self, family):
        _, guardian, mine, sibling, _ = family
        api = guardian_client(guardian)
        res = api.get("/api/v1/portal/children/")
        assert res.status_code == 200, res.content
        ids = {c["id"] for c in res.data["children"]}
        assert ids == {str(mine.id), str(sibling.id)}
        assert res.data["guardian"]["name"] == "Hari Prasad"
        by_id = {c["id"]: c for c in res.data["children"]}
        assert by_id[str(mine.id)]["relation"] == "father"
        assert by_id[str(mine.id)]["dues"] == "0"

    def test_unlinked_student_is_404_on_every_child_endpoint(self, family):
        _, guardian, _, _, stranger = family
        api = guardian_client(guardian)
        for leaf in ("attendance", "fees", "results", "homework"):
            res = api.get(f"/api/v1/portal/children/{stranger.id}/{leaf}/")
            assert res.status_code == 404, leaf

    def test_staff_and_admin_tokens_are_rejected(self, family):
        api = APIClient()
        login(api, "admin_fam", "admin")
        assert api.get("/api/v1/portal/children/").status_code == 403

    def test_anonymous_rejected(self, family):
        assert APIClient().get("/api/v1/portal/children/").status_code == 401

    def test_guardian_cannot_reach_staff_surface(self, family):
        _, guardian, *_ = family
        api = guardian_client(guardian)
        assert api.get("/api/v1/people/students/").status_code == 403

    def test_notices_and_calendar_are_school_scoped(self, family):
        school, guardian, *_ = family
        other = make_school("famother")
        today = today_bs()
        Notice.objects.create(school=school, title="Ours", date_bs=today)
        Notice.objects.create(school=other, title="Theirs", date_bs=today)
        CalendarEvent.objects.create(
            school=school, event_type="holiday",
            start_date_bs=today, end_date_bs=today, description="Dashain",
        )
        CalendarEvent.objects.create(
            school=other, event_type="exam",
            start_date_bs=today, end_date_bs=today, description="Elsewhere",
        )
        api = guardian_client(guardian)
        notices = api.get("/api/v1/portal/notices/")
        assert [n["title"] for n in notices.data["notices"]] == ["Ours"]
        events = api.get("/api/v1/portal/calendar/")
        assert [e["description"] for e in events.data["events"]] == ["Dashain"]


@pytest.mark.django_db
class TestStudentPrincipal:
    """Students are the other documented family principal: they see exactly
    themselves — never a sibling, never another student."""

    def student_client(self, student) -> APIClient:
        from apps.identity.models import Account, Role

        account = Account.objects.create_user(
            f"stud_{student.first_name.lower()}", Role.STUDENT, PASSWORD, verified=True
        )
        student.account = account
        student.save(update_fields=["account"])
        api = APIClient()
        res = api.post(
            "/api/v1/auth/login/",
            {"username": account.username, "password": PASSWORD, "role": "student"},
        )
        assert res.status_code == 200, res.content
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return api

    def test_student_sees_exactly_themself(self, family):
        _, _, mine, sibling, _ = family
        api = self.student_client(mine)
        res = api.get("/api/v1/portal/children/")
        assert res.status_code == 200, res.content
        assert [c["id"] for c in res.data["children"]] == [str(mine.id)]
        assert res.data["children"][0]["relation"] == "self"
        assert res.data["role"] == "student"
        assert res.data["guardian"]["name"] == mine.full_name
        # Own child endpoints resolve; a sibling's are 404.
        assert (
            api.get(f"/api/v1/portal/children/{mine.id}/results/").status_code == 200
        )
        assert (
            api.get(f"/api/v1/portal/children/{sibling.id}/results/").status_code == 404
        )

    def test_student_cannot_reach_staff_surface(self, family):
        _, _, mine, *_ = family
        api = self.student_client(mine)
        assert api.get("/api/v1/people/students/").status_code == 403


@pytest.mark.django_db
class TestPortalData:
    def test_attendance_month_summary(self, family):
        school, guardian, mine, *_ = family
        from apps.attendance.models import ClassAttendanceSession, StudentAttendanceRecord

        month = today_bs()[:7]
        for day, present in (("01", True), ("02", False), ("03", True)):
            session = ClassAttendanceSession.objects.create(
                school=school, class_info=mine.class_info, date_bs=f"{month}-{day}"
            )
            StudentAttendanceRecord.objects.create(
                session=session, student=mine, present=present,
                reason="" if present else "sick",
            )
        api = guardian_client(guardian)
        res = api.get(f"/api/v1/portal/children/{mine.id}/attendance/")
        assert res.status_code == 200, res.content
        assert res.data["summary"] == {"marked": 3, "present": 2, "absent": 1}
        assert res.data["days"][1]["reason"] == "sick"
        empty = api.get(
            f"/api/v1/portal/children/{mine.id}/attendance/?month_bs=2001-01"
        )
        assert empty.data["summary"]["marked"] == 0
        bad = api.get(f"/api/v1/portal/children/{mine.id}/attendance/?month_bs=nope")
        assert bad.status_code == 400

    def test_results_show_only_published_sheets(self, family):
        school, guardian, mine, *_ = family
        from apps.academics.models import Subject

        subject_pub = Subject.objects.create(
            school=school, class_info=mine.class_info, name="Maths",
            credit_hours="4.00",
        )
        subject_unpub = Subject.objects.create(
            school=school, class_info=mine.class_info, name="Science",
            credit_hours="4.00",
        )
        exam = Exam.objects.create(
            school=school, academic_year=mine.academic_year, name="First Term"
        )
        published = SubjectResultSheet.objects.create(
            school=school, exam=exam, class_info=mine.class_info,
            subject=subject_pub, full_marks=100, pass_marks=40,
            published_date_bs=today_bs(),
        )
        unpublished = SubjectResultSheet.objects.create(
            school=school, exam=exam, class_info=mine.class_info,
            subject=subject_unpub, full_marks=100, pass_marks=40,
        )
        StudentSubjectResult.objects.create(
            school=school, sheet=published, student=mine,
            theory=Decimal("72"), total=Decimal("72"), passed=True,
            position_in_section=2,
        )
        StudentSubjectResult.objects.create(
            school=school, sheet=unpublished, student=mine,
            theory=Decimal("15"), total=Decimal("15"), passed=False,
        )
        api = guardian_client(guardian)
        res = api.get(f"/api/v1/portal/children/{mine.id}/results/")
        assert res.status_code == 200, res.content
        assert len(res.data["exams"]) == 1
        bucket = res.data["exams"][0]
        assert [s["subject"] for s in bucket["subjects"]] == ["Maths"]
        assert bucket["total"] == "72.00"
        assert bucket["percentage"] == "72.00"
        assert bucket["position_in_section"] == 2
        assert bucket["all_passed"] is True

    def test_fees_statement_and_dues(self, family):
        school, guardian, mine, *_ = family
        billing_year = BillingYear.objects.create(
            name="EY-portal", start_date_bs="2082-04-01", end_date_bs="2083-03-31"
        )
        Charge.objects.create(
            school=school, student=mine, date_bs="2082-05-01",
            academic_year=mine.academic_year, billing_year=billing_year,
            total=Decimal("1500.00"),
        )
        Payment.objects.create(
            school=school, student=mine, date_bs="2082-05-10",
            academic_year=mine.academic_year, billing_year=billing_year,
            total_paid=Decimal("900.00"), total_discount=Decimal("100.00"),
        )
        api = guardian_client(guardian)
        res = api.get(f"/api/v1/portal/children/{mine.id}/fees/")
        assert res.status_code == 200, res.content
        assert res.data["dues_total"] == "500.00"
        assert res.data["year_charged"] == "1500.00"
        assert res.data["year_paid"] == "1000.00"  # M1: paid + discount settle debt
        assert len(res.data["charges"]) == 1
        assert len(res.data["payments"]) == 1
        bad = api.get(f"/api/v1/portal/children/{mine.id}/fees/?year=not-a-year")
        assert bad.status_code == 400

    def test_homework_lists_class_feed(self, family):
        school, guardian, mine, *_ = family
        from apps.academics.models import Subject
        from apps.homework.models import Homework
        from apps.people.models import Staff, StaffRole

        subject = Subject.objects.create(
            school=school, class_info=mine.class_info, name="English",
            credit_hours="4.00",
        )
        role = StaffRole.objects.create(name="Teacher-portal")
        teacher = Staff.objects.create(
            school=school, role=role, first_name="Tara", last_name="Sharma",
            primary_contact="9800000001",
        )
        Homework.objects.create(
            school=school, class_info=mine.class_info, subject=subject,
            staff=teacher, title="Essay", due_date_bs=today_bs(),
        )
        api = guardian_client(guardian)
        res = api.get(f"/api/v1/portal/children/{mine.id}/homework/")
        assert res.status_code == 200, res.content
        assert [h["title"] for h in res.data["homework"]] == ["Essay"]
        assert res.data["homework"][0]["teacher"] == "Tara Sharma"
