"""Shared-clock program roll: per-title carry with the legacy money guard."""

from decimal import Decimal

import pytest

from apps.academics.models import AcademicYear, ClassInfo, Course
from apps.billing.models import (
    BillingYear, Charge, ChargeBatch, ChargeLine, FeeTitle, LineType, Payment,
    PaymentLine,
)
from apps.billing.services.year_end import rollover_program_year
from apps.people.models import Student
from apps.people.tests.test_tenant_isolation import make_school


@pytest.fixture
def program_books(db):
    school = make_school("roll")
    year = AcademicYear.objects.create(
        school=school, name="EDU 2082", start_date_bs="2082-01-01",
        end_date_bs="2082-12-30",
    )
    billing_year = BillingYear.objects.create(
        name="EY 2082/83", start_date_bs="2082-04-01", end_date_bs="2083-03-30"
    )
    course = Course.objects.create(
        school=school, name="BBS", education_level="bachelor", total_years=4
    )
    classes = [
        ClassInfo.objects.create(
            school=school, education_level="bachelor", course=course,
            year=level, academic_year=year,
        )
        for level in (1, 2)
    ]
    tuition = FeeTitle.objects.create(school=school, name="Tuition")
    exam = FeeTitle.objects.create(school=school, name="Exam Fee")
    return school, year, billing_year, course, classes, tuition, exam


def charge(school, year, by, student, lines):
    total = sum((amount for _, amount in lines), Decimal("0"))
    row = Charge.objects.create(
        school=school, student=student, date_bs="2082-05-01",
        academic_year=year, billing_year=by, total=total,
    )
    for title, amount in lines:
        ChargeLine.objects.create(
            charge=row, line_type=LineType.FEE, fee_title=title,
            label=title.name, amount=amount,
        )
    return row


def pay(school, year, by, student, lines):
    total = sum((amount for _, amount in lines), Decimal("0"))
    payment = Payment.objects.create(
        school=school, student=student, date_bs="2082-06-01",
        academic_year=year, billing_year=by, total_paid=total, mode="cash",
    )
    for title, amount in lines:
        PaymentLine.objects.create(
            payment=payment, line_type=LineType.FEE, fee_title=title,
            label=title.name if title else "Misc", amount=amount, discount=0,
        )
    return payment


@pytest.mark.django_db
class TestProgramRollover:
    def test_per_title_when_clean_ob_when_not(self, program_books):
        school, year, by, course, classes, tuition, exam = program_books
        junior = Student.objects.create(
            school=school, first_name="Junior", last_name="Roll", gender="male",
            class_info=classes[0], academic_year=year,
        )
        messy = Student.objects.create(
            school=school, first_name="Messy", last_name="Roll", gender="male",
            class_info=classes[1], academic_year=year,
        )
        # junior: 5000 tuition + 1000 exam charged, 2000 tuition paid
        # -> clean per-title carry: tuition 3000 + exam 1000
        charge(school, year, by, junior, [(tuition, Decimal("5000")), (exam, Decimal("1000"))])
        pay(school, year, by, junior, [(tuition, Decimal("2000"))])
        # messy: 4000 tuition charged; paid via an untitled line (no fee_title)
        # -> per-title sum (4000) != net (2500): falls back to one OB row
        charge(school, year, by, messy, [(tuition, Decimal("4000"))])
        untitled = pay(school, year, by, messy, [])
        untitled.total_paid = Decimal("1500")
        untitled.save(update_fields=["total_paid"])
        PaymentLine.objects.create(
            payment=untitled, line_type=LineType.OTHER, fee_title=None,
            label="19", amount=Decimal("1500"), discount=0,
        )

        plan = rollover_program_year(
            school, course,
            {"name": "EDU 2083", "start_date_bs": "2083-01-01",
             "end_date_bs": "2083-12-30"},
            by, actor=None,
        )
        assert plan["applied"] is False
        assert plan["students"] == 2
        assert plan["per_title_students"] == 1
        assert plan["total"] == "6500.00"  # 4000 + 2500 — nothing invented

        result = rollover_program_year(
            school, course,
            {"name": "EDU 2083", "start_date_bs": "2083-01-01",
             "end_date_bs": "2083-12-30"},
            by, actor=None, apply=True,
        )
        assert result["applied"] is True
        year.refresh_from_db()
        assert year.closed is True
        for cls in classes:
            cls.refresh_from_db()
            assert cls.academic_year.name == "EDU 2083"

        carried = Charge.objects.filter(student=junior).exclude(academic_year=year)
        assert carried.count() == 1
        labels = {
            (line.line_type, line.label, line.amount)
            for line in carried.first().lines.all()
        }
        assert labels == {
            (LineType.FEE, "Tuition", Decimal("3000.00")),
            (LineType.FEE, "Exam Fee", Decimal("1000.00")),
        }
        messy_carry = Charge.objects.filter(student=messy).exclude(academic_year=year).first()
        assert [line.line_type for line in messy_carry.lines.all()] == [
            LineType.OPENING_BALANCE
        ]
        assert messy_carry.total == Decimal("2500.00")

    def test_multi_year_course_refused(self, program_books):
        school, year, by, course, classes, *_ = program_books
        other = AcademicYear.objects.create(
            school=school, name="Split 2082", start_date_bs="2082-01-01",
            end_date_bs="2082-12-30",
        )
        classes[1].academic_year = other
        classes[1].save(update_fields=["academic_year"])
        from rest_framework.exceptions import ValidationError
        with pytest.raises(ValidationError, match="one academic year"):
            rollover_program_year(
                school, course,
                {"name": "X", "start_date_bs": "2083-01-01",
                 "end_date_bs": "2083-12-30"},
                by, actor=None,
            )
