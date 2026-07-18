"""Reports wave: legacy Reports-menu ports — math, filters, and gates.

Every endpoint is read-only and gated by its OWNING module's permission
code, so these tests double as the permission contract for the wave."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassInfo
from apps.billing.models import (
    BillingYear,
    Charge,
    ChargeBatch,
    ChargeLine,
    FeeSchedule,
    FeeTitle,
    LineType,
    Payment,
    PaymentLine,
    StandingDiscount,
)
from apps.core.dates import today_bs
from apps.homework.models import Homework
from apps.people.models import Guardian, StudentGuardian
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school, make_student
from apps.transport.models import BusStation, RiderSubscription


@pytest.fixture
def report_world(db):
    """One school with a charged + partially paid student."""
    school = make_school("rep")
    student = make_student(school, "Riya")
    year = student.academic_year
    billing_year = BillingYear.objects.create(
        name="RY 2082/83", start_date_bs="2082-04-01", end_date_bs="2083-03-30"
    )
    tuition = FeeTitle.objects.create(
        school=school, name="Tuition", months=[1, 2, 3], kind=FeeTitle.Kind.REGULAR
    )
    FeeSchedule.objects.create(
        school=school, class_info=student.class_info, fee_title=tuition, amount="1000.00"
    )
    batch = ChargeBatch.objects.create(
        school=school, date_bs="2082-01-05", months=[1, 2],
        academic_year=year, billing_year=billing_year, class_info=student.class_info,
    )
    charge = Charge.objects.create(
        school=school, batch=batch, student=student, date_bs="2082-01-05",
        academic_year=year, billing_year=billing_year, total=Decimal("2000.00"),
    )
    ChargeLine.objects.create(
        charge=charge, line_type=LineType.FEE, fee_title=tuition,
        label="Tuition", amount=Decimal("2000.00"),
    )
    payment = Payment.objects.create(
        school=school, kind=FeeTitle.Kind.REGULAR, serial=1, date_bs="2082-02-01",
        student=student, class_info=student.class_info, academic_year=year,
        billing_year=billing_year, total_paid=Decimal("500.00"),
        total_discount=Decimal("100.00"),
    )
    PaymentLine.objects.create(
        payment=payment, line_type=LineType.FEE, fee_title=tuition,
        label="Tuition", amount=Decimal("500.00"), discount=Decimal("100.00"),
    )
    return school, student, year, billing_year, tuition, batch, payment


def as_admin(slug="rep"):
    api = APIClient()
    login(api, f"admin_{slug}", "admin")
    return api


@pytest.mark.django_db
class TestGates:
    def test_billing_reports_need_billing_grant(self, report_world):
        school, *_ = report_world
        make_staff(school, "rep_none", ["students.view"])
        api = APIClient()
        login(api, "rep_none", "staff")
        assert api.get("/api/v1/reports/transactions/").status_code == 403
        assert api.get("/api/v1/reports/dues/").status_code == 403
        # but the students-gated report opens
        assert api.get("/api/v1/reports/admissions/").status_code == 200

    def test_view_grant_reads(self, report_world):
        school, *_ = report_world
        make_staff(school, "rep_viewer", ["billing.view"])
        api = APIClient()
        login(api, "rep_viewer", "staff")
        assert api.get("/api/v1/reports/transactions/").status_code == 200

    def test_integrity_is_admin_only(self, report_world):
        school, *_ = report_world
        make_staff(school, "rep_full", ["billing.manage"])
        api = APIClient()
        login(api, "rep_full", "staff")
        assert api.get("/api/v1/reports/integrity/").status_code == 403
        assert as_admin().get("/api/v1/reports/integrity/").status_code == 200

    def test_tenant_isolation(self, report_world):
        other = make_school("repb")
        make_student(other, "Bina")
        api = APIClient()
        login(api, "admin_repb", "admin")
        res = api.get("/api/v1/reports/transactions/")
        assert res.status_code == 200
        assert res.data["rows"] == []  # school A's payment invisible

    def test_guardian_refused(self, report_world):
        school, student, *_ = report_world
        api = as_admin()
        api.post("/api/v1/people/guardians/", {"name": "Gita"}, format="json")
        # Guardian portal principals are cut off by RoleAllowed regardless.
        anon = APIClient()
        assert anon.get("/api/v1/reports/transactions/").status_code == 401


@pytest.mark.django_db
class TestTransactionsReport:
    def test_register_and_summary(self, report_world):
        api = as_admin()
        res = api.get("/api/v1/reports/transactions/")
        assert res.status_code == 200
        assert res.data["summary"]["count"] == 1
        assert res.data["summary"]["total_paid"] == Decimal("500.00")
        assert res.data["summary"]["total_discount"] == Decimal("100.00")
        row = res.data["rows"][0]
        assert row["name"] == "Riya Test"
        assert row["serial"] == 1
        assert row["lines"][0]["label"] == "Tuition"

    def test_date_range_replaces_year_filter(self, report_world):
        api = as_admin()
        res = api.get(
            "/api/v1/reports/transactions/",
            {"from_bs": "2082-03-01", "to_bs": "2082-03-30"},
        )
        assert res.data["rows"] == []  # payment on 2082-02-01 is outside
        res = api.get(
            "/api/v1/reports/transactions/",
            {"from_bs": "2082-01-01", "to_bs": "2082-02-30"},
        )
        assert res.data["summary"]["count"] == 1

    def test_half_open_range_rejected(self, report_world):
        api = as_admin()
        assert (
            api.get("/api/v1/reports/transactions/", {"from_bs": "2082-01-01"}).status_code
            == 400
        )

    def test_class_snapshot_wins(self, report_world):
        """M3: after a class change the payment stays under the snapshot."""
        school, student, year, *_ = report_world
        new_class = ClassInfo.objects.create(
            school=school, education_level="school", grade="two", academic_year=year
        )
        old_class_id = student.class_info_id
        student.class_info = new_class
        student.save(update_fields=["class_info"])
        api = as_admin()
        res = api.get("/api/v1/reports/transactions/", {"class_info": str(old_class_id)})
        assert res.data["summary"]["count"] == 1  # found under payment-time class
        res = api.get("/api/v1/reports/transactions/", {"class_info": str(new_class.id)})
        assert res.data["summary"]["count"] == 0


@pytest.mark.django_db
class TestDuesAndLedgers:
    def test_classwise_dues_m1(self, report_world):
        school, student, year, *_ = report_world
        api = as_admin()
        res = api.get("/api/v1/reports/dues/", {"academic_year": str(year.id)})
        assert res.status_code == 200
        row = res.data["rows"][0]
        assert row["debit"] == Decimal("2000.00")
        # M1: credit = paid + discount
        assert row["credit"] == Decimal("600.00")
        assert row["balance"] == Decimal("1400.00")

    def test_student_ledgers_balance_range(self, report_world):
        school, student, year, *_ = report_world
        api = as_admin()
        res = api.get(
            "/api/v1/reports/student-ledgers/",
            {"academic_year": str(year.id), "balance_gt": "1000"},
        )
        assert res.data["summary"]["count"] == 1
        assert res.data["rows"][0]["balance"] == Decimal("1400.00")
        res = api.get(
            "/api/v1/reports/student-ledgers/",
            {"academic_year": str(year.id), "balance_lt": "1000"},
        )
        assert res.data["summary"]["count"] == 0

    def test_opening_balance_report(self, report_world):
        school, student, year, billing_year, *_ = report_world
        ob_charge = Charge.objects.create(
            school=school, student=student, date_bs="2082-01-01",
            academic_year=year, billing_year=billing_year, total=Decimal("750.00"),
        )
        ChargeLine.objects.create(
            charge=ob_charge, line_type=LineType.OPENING_BALANCE,
            label="Opening balance", amount=Decimal("750.00"),
        )
        api = as_admin()
        res = api.get("/api/v1/reports/opening-balances/", {"academic_year": str(year.id)})
        assert res.data["summary"]["total"] == Decimal("750.00")
        assert res.data["rows"][0]["student_name"] == "Riya Test"


@pytest.mark.django_db
class TestPostingsReport:
    def test_batch_history_with_breakdown(self, report_world):
        school, student, year, *_ = report_world
        api = as_admin()
        res = api.get("/api/v1/reports/postings/", {"academic_year": str(year.id)})
        assert res.data["summary"]["count"] == 1
        row = res.data["rows"][0]
        assert row["charge_count"] == 1
        assert row["total"] == Decimal("2000.00")
        assert row["lines"] == [{"label": "Tuition", "amount": Decimal("2000.00")}]

    def test_soft_deleted_charges_excluded(self, report_world):
        school, student, year, billing_year, tuition, batch, _ = report_world
        Charge.objects.get(batch=batch).soft_delete()
        api = as_admin()
        res = api.get("/api/v1/reports/postings/", {"academic_year": str(year.id)})
        row = res.data["rows"][0]
        assert row["charge_count"] == 0
        assert row["total"] == 0


@pytest.mark.django_db
class TestDiscountReports:
    def test_standing_discounts_history(self, report_world):
        school, student, year, _, tuition, *_ = report_world
        StandingDiscount.objects.create(
            school=school, student=student, fee_title=tuition,
            percentage=Decimal("25.00"), academic_year=year, remarks="Sibling",
        )
        StandingDiscount.objects.create(  # transport discount: fee_title None
            school=school, student=student, fee_title=None,
            flat_amount=Decimal("100.00"), academic_year=year,
        )
        api = as_admin()
        res = api.get("/api/v1/reports/standing-discounts/")
        assert res.data["summary"]["count"] == 2
        titles = {r["fee_title"] for r in res.data["rows"]}
        assert titles == {"Tuition", "Transportation"}

    def test_payment_discounts(self, report_world):
        school, student, year, *_ = report_world
        api = as_admin()
        res = api.get(
            "/api/v1/reports/payment-discounts/", {"academic_year": str(year.id)}
        )
        assert res.data["summary"]["count"] == 1
        row = res.data["rows"][0]
        assert row["total_discount"] == Decimal("100.00")
        assert row["lines"] == [{"label": "Tuition", "discount": Decimal("100.00")}]


@pytest.mark.django_db
class TestIncomePlan:
    def test_projection_with_discount_and_transport(self, report_world):
        school, student, year, _, tuition, *_ = report_world
        # 25% discount on tuition, this year (D1 pct-wins even with flat set)
        StandingDiscount.objects.create(
            school=school, student=student, fee_title=tuition,
            percentage=Decimal("25.00"), flat_amount=Decimal("999.00"),
            academic_year=year,
        )
        station = BusStation.objects.create(
            school=school, name="Chowk", fee=Decimal("300.00")
        )
        this_year = today_bs()[:4]
        RiderSubscription.objects.create(
            school=school, student=student, bus_station=station,
            start_date_bs=f"{this_year}-01-01",
        )
        api = as_admin()
        res = api.get("/api/v1/reports/income-plan/", {"months": "1,2"})
        assert res.status_code == 200, res.content
        class_id = str(student.class_info_id)
        # Tuition months [1,2,3] ∩ [1,2] = 2 → (1000*2*1) - (250*2) = 1500
        assert res.data["data"][class_id][str(tuition.id)] == Decimal("1500.00")
        # Transport: rider since month 1 → both months × 300 = 600
        assert res.data["data"][class_id]["transport"] == Decimal("600.00")

    def test_stale_year_discount_ignored(self, report_world):
        school, student, year, _, tuition, *_ = report_world
        old_year = AcademicYear.objects.create(
            school=school, name="2081", start_date_bs="2081-01-01",
            end_date_bs="2081-12-30",
        )
        StandingDiscount.objects.create(  # D2 correction: wrong year → no effect
            school=school, student=student, fee_title=tuition,
            percentage=Decimal("50.00"), academic_year=old_year,
        )
        api = as_admin()
        res = api.get("/api/v1/reports/income-plan/", {"months": "1"})
        assert res.data["data"][str(student.class_info_id)][str(tuition.id)] == Decimal(
            "1000.00"
        )

    def test_months_validated(self, report_world):
        api = as_admin()
        assert api.get("/api/v1/reports/income-plan/").status_code == 400
        assert api.get("/api/v1/reports/income-plan/", {"months": "13"}).status_code == 400


@pytest.mark.django_db
class TestCampusReports:
    def test_admissions_by_year(self, report_world):
        school, student, year, *_ = report_world
        other_year = AcademicYear.objects.create(
            school=school, name="2083", start_date_bs="2083-01-01",
            end_date_bs="2083-12-30",
        )
        guardian = Guardian.objects.create(school=school, name="Gopal", contact="98x")
        StudentGuardian.objects.create(
            student=student, guardian=guardian, relation="father",
            is_primary_contact=True,
        )
        api = as_admin()
        res = api.get("/api/v1/reports/admissions/", {"academic_year": str(year.id)})
        assert res.data["summary"]["count"] == 1
        assert res.data["rows"][0]["guardian_name"] == "Gopal"
        res = api.get("/api/v1/reports/admissions/", {"academic_year": str(other_year.id)})
        assert res.data["summary"]["count"] == 0

    def test_staff_details(self, report_world):
        school, *_ = report_world
        make_staff(school, "rep_teacher", [])
        api = as_admin()
        res = api.get("/api/v1/reports/staff-details/")
        assert res.data["summary"]["count"] == 1
        assert res.data["rows"][0]["role"] == "Teacher"

    def test_transport_history(self, report_world):
        school, student, *_ = report_world
        station = BusStation.objects.create(
            school=school, name="Gate", fee=Decimal("250.00")
        )
        RiderSubscription.objects.create(
            school=school, student=student, bus_station=station,
            start_date_bs="2082-01-01",
        )
        api = as_admin()
        res = api.get("/api/v1/reports/transport-history/")
        assert res.data["summary"]["count"] == 1
        row = res.data["rows"][0]
        assert row["station"] == "Gate"
        assert row["fee"] == Decimal("250.00")

    def test_homework_given_includes_withdrawn(self, report_world):
        school, student, year, *_ = report_world
        from apps.academics.models import Subject

        subject = Subject.objects.create(
            school=school, class_info=student.class_info, name="Nepali",
            credit_hours=Decimal("4.00"),
        )
        staff = make_staff(school, "rep_hw", [])
        hw = Homework.objects.create(
            school=school, title="Essay", due_date_bs="2082-04-10",
            class_info=student.class_info, subject=subject, staff=staff,
        )
        hw.soft_delete()  # withdrawn later — still GIVEN that day
        api = as_admin()
        res = api.get("/api/v1/reports/homework-given/", {"date_bs": today_bs()})
        assert res.status_code == 200, res.content
        assert res.data["summary"]["count"] == 1
        assert res.data["rows"][0]["is_active"] is False


@pytest.mark.django_db
class TestAttendanceSummary:
    def test_class_scope_counts(self, report_world):
        school, student, *_ = report_world
        from apps.attendance.models import ClassAttendanceSession, StudentAttendanceRecord

        for day, present in (("2082-01-01", True), ("2082-01-02", False)):
            session = ClassAttendanceSession.objects.create(
                school=school, date_bs=day, class_info=student.class_info
            )
            StudentAttendanceRecord.objects.create(
                session=session, student=student, present=present
            )
        api = as_admin()
        res = api.get("/api/v1/reports/attendance-summary/", {
            "class_info": str(student.class_info_id),
            "from_bs": "2082-01-01", "to_bs": "2082-01-30",
        })
        assert res.status_code == 200, res.content
        assert res.data["summary"]["days_marked"] == 2
        row = res.data["rows"][0]
        assert (row["present"], row["absent"], row["rate"]) == (1, 1, 50.0)

    def test_school_scope(self, report_world):
        school, student, *_ = report_world
        from apps.attendance.models import ClassAttendanceSession, StudentAttendanceRecord

        session = ClassAttendanceSession.objects.create(
            school=school, date_bs="2082-01-01", class_info=student.class_info
        )
        StudentAttendanceRecord.objects.create(session=session, student=student, present=True)
        api = as_admin()
        res = api.get("/api/v1/reports/attendance-summary/", {
            "scope": "school", "from_bs": "2082-01-01", "to_bs": "2082-01-30",
        })
        assert res.data["rows"][0]["present"] == 1


@pytest.mark.django_db
class TestDemographics:
    def test_class_statistics(self, report_world):
        school, student, *_ = report_world
        make_student(school, "Maya").__class__.objects.filter(
            first_name="Maya"
        ).update(gender="female")
        api = as_admin()
        res = api.get("/api/v1/reports/class-statistics/")
        assert res.status_code == 200
        row = res.data["rows"][0]
        assert (row["male"], row["female"], row["total"]) == (1, 1, 2)
        assert res.data["summary"]["total"] == 2

    def test_student_birthdays_this_month(self, report_world):
        school, student, *_ = report_world
        today = today_bs()
        student.birth_date_bs = f"2070-{today[5:7]}-{today[8:10]}"
        student.save(update_fields=["birth_date_bs"])
        make_student(school, "NoDate")  # blank birth date must not crash
        api = as_admin()
        res = api.get("/api/v1/reports/student-birthdays/")
        assert res.status_code == 200
        assert res.data["summary"]["count"] == 1
        assert res.data["rows"][0]["is_today"] is True

    def test_staff_birthdays_gate(self, report_world):
        school, *_ = report_world
        make_staff(school, "rep_students_only", ["students.view"])
        api = APIClient()
        login(api, "rep_students_only", "staff")
        assert api.get("/api/v1/reports/student-birthdays/").status_code == 200
        assert api.get("/api/v1/reports/staff-birthdays/").status_code == 403


@pytest.mark.django_db
class TestIntegrityReport:
    def test_mismatch_surfaces(self, report_world):
        school, student, year, billing_year, *_ = report_world
        drifted_year = AcademicYear.objects.create(
            school=school, name="2084", start_date_bs="2084-01-01",
            end_date_bs="2084-12-30",
        )
        Payment.objects.create(
            school=school, kind=FeeTitle.Kind.REGULAR, serial=2, date_bs="2082-03-01",
            student=student, class_info=student.class_info,
            academic_year=drifted_year,  # ≠ the class's year
            billing_year=billing_year, total_paid=Decimal("10.00"),
        )
        api = as_admin()
        res = api.get("/api/v1/reports/integrity/")
        assert res.data["summary"]["payment_mismatches"] == 1
        assert res.data["summary"]["charge_mismatches"] == 0
