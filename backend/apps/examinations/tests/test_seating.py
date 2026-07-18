"""Seat plans (E3), certificate serials, and the entry-card class roster."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.billing.models import BillingYear, Charge, FeeTitle, Payment
from apps.examinations.models import CharacterCertificate, SeatAllocation, SeatPlanRoom
from apps.examinations.services import certificates
from apps.people.models import Student
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school

from .test_examinations import exam_setup  # noqa: F401 — fixture


def seed_class(school, class_info, year, names, **extra):
    return [
        Student.objects.create(
            school=school, first_name=name, last_name="Delta", gender="female",
            class_info=class_info, academic_year=year, roll_no=str(i + 1), **extra,
        )
        for i, name in enumerate(names)
    ]


@pytest.mark.django_db
class TestSeatPlanApi:
    def make_room(self, api, exam, class_a, class_b, benches=5):
        return api.post(
            "/api/v1/examinations/seat-plan-rooms/",
            {
                "exam": str(exam.id),
                "name": "Room 101",
                "benches": benches,
                "seats_per_bench": 2,
                "order_by": "roll",
                "classes": [
                    {"class_info": str(class_a.id), "column": 1},
                    {"class_info": str(class_b.id), "column": 2},
                ],
            },
            format="json",
        )

    def test_room_crud_and_column_validation(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        api = APIClient()
        login(api, "admin_delta", "admin")
        res = self.make_room(api, exam, class_a, class_b)
        assert res.status_code == 201, res.content
        room_id = res.data["id"]
        assert res.data["capacity"] == 10
        assert [c["column"] for c in res.data["classes"]] == [1, 2]

        # duplicate column rejected — one class per bench side is what E3 rests on
        bad = api.post(
            "/api/v1/examinations/seat-plan-rooms/",
            {
                "exam": str(exam.id), "name": "Bad", "benches": 2, "seats_per_bench": 2,
                "classes": [
                    {"class_info": str(class_a.id), "column": 1},
                    {"class_info": str(class_b.id), "column": 1},
                ],
            },
            format="json",
        )
        assert bad.status_code == 400
        # column outside the bench rejected
        bad = api.post(
            "/api/v1/examinations/seat-plan-rooms/",
            {
                "exam": str(exam.id), "name": "Bad", "benches": 2, "seats_per_bench": 2,
                "classes": [{"class_info": str(class_a.id), "column": 3}],
            },
            format="json",
        )
        assert bad.status_code == 400

        # delete is a hard cascade (rooms are working documents)
        assert api.delete(f"/api/v1/examinations/seat-plan-rooms/{room_id}/").status_code == 204
        assert not SeatPlanRoom.all_objects.filter(id=room_id).exists()

    def test_generate_alternates_classes_on_benches(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        year = exam.academic_year
        seed_class(school, class_b, year, ("Dila", "Esha", "Fulmati"))
        api = APIClient()
        login(api, "admin_delta", "admin")
        room_id = self.make_room(api, exam, class_a, class_b).data["id"]

        res = api.post(
            "/api/v1/examinations/seat-plan-rooms/generate/",
            {"exam": str(exam.id)},
            format="json",
        )
        assert res.status_code == 200, res.content
        assert res.data["seated"] == 6
        assert res.data["unseated"] == 0

        allocations = SeatAllocation.objects.filter(room_id=room_id)
        # E3: column 1 holds only class A students, column 2 only class B
        for allocation in allocations:
            expected = class_a.id if allocation.column == 1 else class_b.id
            assert allocation.class_info_id == expected
        # regenerate replaces, never duplicates (idempotent)
        api.post(
            "/api/v1/examinations/seat-plan-rooms/generate/",
            {"exam": str(exam.id)}, format="json",
        )
        assert SeatAllocation.objects.filter(room_id=room_id).count() == 6

    def test_overflow_flows_to_next_room_and_reports_unseated(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        api = APIClient()
        login(api, "admin_delta", "admin")
        # 3 students in class A, one column: 2 benches seat 2, third flows on
        first = api.post(
            "/api/v1/examinations/seat-plan-rooms/",
            {
                "exam": str(exam.id), "name": "R1", "benches": 2, "seats_per_bench": 1,
                "classes": [{"class_info": str(class_a.id), "column": 1}],
            },
            format="json",
        ).data
        second = api.post(
            "/api/v1/examinations/seat-plan-rooms/",
            {
                "exam": str(exam.id), "name": "R2", "benches": 1, "seats_per_bench": 1,
                "classes": [{"class_info": str(class_a.id), "column": 1}],
            },
            format="json",
        ).data
        res = api.post(
            "/api/v1/examinations/seat-plan-rooms/generate/",
            {"exam": str(exam.id)}, format="json",
        )
        assert res.data["seated"] == 3
        assert res.data["unseated"] == 0
        assert res.data["per_room"] == {first["id"]: 2, second["id"]: 1}
        # no student seated twice across rooms
        seated = SeatAllocation.objects.values_list("student_id", flat=True)
        assert len(seated) == len(set(seated)) == 3

        # shrink to a single 1-seat room: 2 students have nowhere to sit
        api.delete(f"/api/v1/examinations/seat-plan-rooms/{second['id']}/")
        api.patch(
            f"/api/v1/examinations/seat-plan-rooms/{first['id']}/",
            {"benches": 1}, format="json",
        )
        res = api.post(
            "/api/v1/examinations/seat-plan-rooms/generate/",
            {"exam": str(exam.id)}, format="json",
        )
        assert res.data["seated"] == 1
        assert res.data["unseated"] == 2

    def test_eligible_classes_follow_exam_education_level(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        api = APIClient()
        login(api, "admin_delta", "admin")
        res = api.get(
            f"/api/v1/examinations/seat-plan-rooms/eligible-classes/?exam={exam.id}"
        )
        assert res.status_code == 200
        # the sheet ties the exam to class A's level; both sections qualify
        assert set(res.data["eligible_classes"]) == {str(class_a.id), str(class_b.id)}

    def test_seat_plan_is_tenant_scoped(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        make_school("omega")
        api = APIClient()
        login(api, "admin_omega", "admin")
        assert api.get("/api/v1/examinations/seat-plan-rooms/").data["count"] == 0
        res = api.post(
            "/api/v1/examinations/seat-plan-rooms/",
            {
                "exam": str(exam.id), "name": "X", "benches": 1, "seats_per_bench": 1,
                "classes": [],
            },
            format="json",
        )
        assert res.status_code == 400  # another school's exam is invisible


@pytest.mark.django_db
class TestCertificateSerials:
    def make_year(self, name="EY 2082/083", start="2082-04-01", end="2083-03-31"):
        return BillingYear.objects.create(
            name=name, start_date_bs=start, end_date_bs=end
        )

    def test_serials_increment_in_legacy_shape(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        year = self.make_year()
        api = APIClient()
        login(api, "admin_delta", "admin")
        first = api.post(
            "/api/v1/examinations/certificates/",
            {"student": str(students[0].id), "data": {"name": "Amina Delta"}},
            format="json",
        )
        assert first.status_code == 201, first.content
        assert first.data["serial_no"] == f"1/{year.name}"
        second = api.post(
            "/api/v1/examinations/certificates/",
            {"data": {"name": "Walk-in"}},
            format="json",
        )
        assert second.data["serial_no"] == f"2/{year.name}"
        # client-supplied serials are ignored (legacy accepted them; that is
        # how malformed serials got into production)
        forged = api.post(
            "/api/v1/examinations/certificates/",
            {"data": {"name": "Forged"}, "serial_no": "999/HACK"},
            format="json",
        )
        assert forged.data["serial_no"] == f"3/{year.name}"

    def test_seeds_from_imported_legacy_serials(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        year = self.make_year()
        CharacterCertificate.objects.create(
            school=school, serial_no=f"45/{year.name}", data={"name": "Legacy"},
            legacy_id=999,
        )
        cert = certificates.issue(school=school, student=None, data={"name": "Next"})
        assert cert.serial_no == f"46/{year.name}"

    def test_counter_resets_on_new_billing_year(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        old = self.make_year("EY 2081/082", "2081-04-01", "2082-03-31")
        certificates.issue(school=school, student=None, data={}, billing_year=old)
        current = self.make_year()
        cert = certificates.issue(school=school, student=None, data={})
        assert cert.serial_no == f"1/{current.name}"

    def test_search_matches_serial_and_name(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        self.make_year()
        api = APIClient()
        login(api, "admin_delta", "admin")
        api.post(
            "/api/v1/examinations/certificates/",
            {"data": {"name": "Amina Delta", "class": "10"}},
            format="json",
        )
        res = api.get("/api/v1/examinations/certificates/?search=amina")
        assert res.data["count"] == 1
        assert res.data["results"][0]["data"]["name"] == "Amina Delta"
        res = api.get("/api/v1/examinations/certificates/?search=nobody")
        assert res.data["count"] == 0


@pytest.mark.django_db
class TestClassRoster:
    def test_roster_carries_identities_and_dues(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        year = BillingYear.objects.create(
            name="EY 2082/083", start_date_bs="2082-04-01", end_date_bs="2083-03-31"
        )
        Charge.objects.create(
            school=school, student=students[0], date_bs="2082-05-01",
            academic_year=exam.academic_year, billing_year=year, total=Decimal("5000"),
        )
        Payment.objects.create(
            school=school, student=students[0], class_info=class_a, date_bs="2082-06-01",
            academic_year=exam.academic_year, billing_year=year,
            kind=FeeTitle.Kind.REGULAR, serial=1,
            total_paid=Decimal("2000"), total_discount=Decimal("500"),
        )
        make_staff(school, "exam_clerk", ["examinations.manage"])
        api = APIClient()
        login(api, "exam_clerk", "staff")
        res = api.get(
            f"/api/v1/examinations/exams/class-roster/?class_info={class_a.id}&include_dues=1"
        )
        assert res.status_code == 200, res.content
        row = next(r for r in res.data if r["full_name"] == "Amina Delta")
        # M1: the 500 discount settles debt alongside the 2000 payment
        assert Decimal(row["dues"]) == Decimal("2500")
        assert {"id", "full_name", "roll_no", "symbol_no", "regd_no", "dues"} <= set(row)
        # the students module itself stays closed to the clerk
        assert api.get("/api/v1/people/students/").status_code == 403
