"""Long-tail modules: homework, library, transport, communication and
inventory — permission contracts, delete guards, derived stock, and the
attendance -> parent-push bridge."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.attendance.services import students_checked_in
from apps.communication.models import DeliveryLog
from apps.identity.models import Account, Role
from apps.inventory.models import Category, Item, StockTransaction
from apps.library.models import Book, BookCopy, Library
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school, make_student
from apps.transport.models import BusStation, RiderSubscription


@pytest.fixture
def longtail_setup(db):
    school = make_school("tail")
    student = make_student(school, "Chameli")
    return school, student


@pytest.mark.django_db
class TestTransport:
    def test_station_with_riders_cannot_be_deleted(self, longtail_setup):
        school, student = longtail_setup
        station = BusStation.objects.create(school=school, name="Chowk", fee="700.00")
        RiderSubscription.objects.create(school=school, student=student, bus_station=station)
        api = APIClient()
        login(api, "admin_tail", "admin")
        res = api.delete(f"/api/v1/transport/stations/{station.id}/")
        assert res.status_code == 400  # X2 delete guard
        assert BusStation.objects.filter(id=station.id).exists()
        RiderSubscription.objects.all().delete()
        assert api.delete(f"/api/v1/transport/stations/{station.id}/").status_code == 204

    def test_transport_permission_contract(self, longtail_setup):
        school, student = longtail_setup
        make_staff(school, "tail_viewer", ["transport.view"])
        api = APIClient()
        login(api, "tail_viewer", "staff")
        assert api.get("/api/v1/transport/stations/").status_code == 200
        res = api.post("/api/v1/transport/stations/", {"name": "New", "fee": "100.00"})
        assert res.status_code == 403  # view != manage


@pytest.mark.django_db
class TestHomework:
    def test_homework_crud_scoped_and_gated(self, longtail_setup):
        from apps.academics.models import Subject

        school, student = longtail_setup
        teacher = make_staff(school, "tail_teacher", ["homework.manage"])
        subject = Subject.objects.create(
            school=school, class_info=student.class_info, name="Science", code="SCI", credit_hours=4
        )
        api = APIClient()
        login(api, "tail_teacher", "staff")
        res = api.post("/api/v1/homework/assignments/", {
            "title": "Chapter 4 exercises", "description": "Q1-Q10",
            "due_date_bs": "2082-06-15", "class_info": str(student.class_info_id),
            "subject": str(subject.id), "staff": str(teacher.id),
        }, format="json")
        assert res.status_code == 201, res.content
        listing = api.get(f"/api/v1/homework/assignments/?class_info={student.class_info_id}")
        assert listing.data["count"] == 1
        # another school sees nothing
        make_school("tail2")
        other = APIClient()
        login(other, "admin_tail2", "admin")
        assert other.get("/api/v1/homework/assignments/").data["results"] == []

    def test_duplicate_submission_rejected(self, longtail_setup):
        from apps.academics.models import Subject
        from apps.homework.models import Homework, Submission

        school, student = longtail_setup
        teacher = make_staff(school, "tail_teacher2", [])
        subject = Subject.objects.create(
            school=school, class_info=student.class_info, name="Maths", code="MTH", credit_hours=4
        )
        homework = Homework.objects.create(
            school=school, title="HW", due_date_bs="2082-06-15",
            class_info=student.class_info, subject=subject, staff=teacher,
        )
        Submission.objects.create(
            school=school, homework=homework, student=student, submitted_date_bs="2082-06-14"
        )
        api = APIClient()
        login(api, "admin_tail", "admin")
        res = api.post("/api/v1/homework/submissions/", {
            "homework": str(homework.id), "student": str(student.id),
            "submitted_date_bs": "2082-06-14",
        }, format="json")
        assert res.status_code == 400  # unique (homework, student)


@pytest.mark.django_db
class TestLibrary:
    def test_accession_numbers_unique_per_school(self, longtail_setup):
        school, student = longtail_setup
        library = Library.objects.create(school=school, name="Main", fine_per_day=1)
        book = Book.objects.create(school=school, library=library, title="Muna Madan")
        api = APIClient()
        login(api, "admin_tail", "admin")
        first = api.post("/api/v1/library/copies/", {
            "book": str(book.id), "accession_no": 1001,
        }, format="json")
        assert first.status_code == 201, first.content
        duplicate = api.post("/api/v1/library/copies/", {
            "book": str(book.id), "accession_no": 1001,
        }, format="json")
        assert duplicate.status_code == 400

    def test_loan_needs_borrower(self, longtail_setup):
        school, student = longtail_setup
        library = Library.objects.create(school=school, name="Main2", fine_per_day=1)
        book = Book.objects.create(school=school, library=library, title="Shirishko Phool")
        copy = BookCopy.objects.create(school=school, book=book, accession_no=7)
        api = APIClient()
        login(api, "admin_tail", "admin")
        res = api.post("/api/v1/library/loans/", {
            "copy": str(copy.id), "issued_date_bs": "2082-06-01",
            "due_date_bs": "2082-06-15",
        }, format="json")
        assert res.status_code == 400
        res = api.post("/api/v1/library/loans/", {
            "copy": str(copy.id), "student": str(student.id),
            "issued_date_bs": "2082-06-01", "due_date_bs": "2082-06-15",
        }, format="json")
        assert res.status_code == 201, res.content


@pytest.mark.django_db
class TestInventory:
    def test_stock_is_signed_sum_of_transactions(self, longtail_setup):
        school, student = longtail_setup
        year = student.academic_year
        category = Category.objects.create(school=school, name="Stationery")
        item = Item.objects.create(school=school, name="Marker", category=category)
        for txn_type, quantity in (
            ("purchase", "200.00"), ("issue", "30.00"),
            ("wastage", "5.00"), ("adjustment", "-15.00"),
        ):
            StockTransaction.objects.create(
                school=school, item=item, txn_type=txn_type, quantity=quantity,
                date_bs="2082-06-01", academic_year=year,
            )
        api = APIClient()
        login(api, "admin_tail", "admin")
        row = api.get("/api/v1/inventory/items/").data["results"][0]
        assert Decimal(row["stock"]) == Decimal("150.00")  # 200 - 30 - 5 - 15

    def test_negative_quantity_only_for_adjustments(self, longtail_setup):
        school, student = longtail_setup
        item = Item.objects.create(school=school, name="Chalk")
        api = APIClient()
        login(api, "admin_tail", "admin")
        res = api.post("/api/v1/inventory/transactions/", {
            "item": str(item.id), "txn_type": "issue", "quantity": "-5.00",
            "date_bs": "2082-06-01", "academic_year": str(student.academic_year_id),
        }, format="json")
        assert res.status_code == 400


@pytest.mark.django_db
class TestCommunication:
    def test_checkin_signal_queues_parent_push(self, longtail_setup):
        school, student = longtail_setup
        account = Account.objects.create_user(
            "tail_student", Role.STUDENT, "s3cure-pass-99", verified=True
        )
        student.account = account
        student.save(update_fields=["account"])
        students_checked_in.send(
            sender=None, school_id=school.id, student_ids=[student.id]
        )
        log = DeliveryLog.objects.get(school=school)
        assert log.status == DeliveryLog.Status.QUEUED
        assert log.recipient_id == account.id
        assert log.data["kind"] == "attendance.check_in"

    def test_delivery_log_is_read_only(self, longtail_setup):
        school, student = longtail_setup
        api = APIClient()
        login(api, "admin_tail", "admin")
        res = api.post("/api/v1/communication/delivery-log/", {
            "title": "forged", "body": "x",
        }, format="json")
        assert res.status_code == 405  # append-only, written by senders

    def test_calendar_range_filter(self, longtail_setup):
        from apps.communication.models import CalendarEvent

        school, student = longtail_setup
        for start in ("2082-01-10", "2082-05-10", "2082-09-10"):
            CalendarEvent.objects.create(
                school=school, start_date_bs=start, end_date_bs=start,
                event_type="holiday",
            )
        api = APIClient()
        login(api, "admin_tail", "admin")
        res = api.get("/api/v1/communication/calendar/?from=2082-04-01&to=2082-08-30")
        assert res.data["count"] == 1
