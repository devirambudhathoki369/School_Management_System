"""
Vendor analysis (legacy superadmin Analysis → Statistics / Classwise old
dues) as an ops command until a vendor console exists: per-school running
students, staff, today's collection and total outstanding dues.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Count, Q, Sum

from apps.billing.models import Charge, Payment
from apps.core.dates import today_bs
from apps.people.models import Staff, Student
from apps.tenants.models import School


class Command(BaseCommand):
    help = "Per-school statistics: students, staff, today's collection, dues."

    def handle(self, *args, **options):
        today = today_bs()
        header = f"{'School':38} {'Students':>8} {'Staff':>6} {'Today':>14} {'Dues':>16}"
        self.stdout.write(self.style.MIGRATE_HEADING(header))
        for school in School.objects.filter(status="active").order_by("name"):
            students = Student.objects.filter(
                school=school, status=Student.Status.RUNNING
            ).count()
            staff = Staff.objects.filter(school=school).count()
            collected = (
                Payment.objects.filter(school=school, date_bs=today).aggregate(
                    s=Sum("total_paid")
                )["s"]
                or Decimal("0")
            )
            charged = (
                Charge.objects.filter(school=school).aggregate(s=Sum("total"))["s"]
                or Decimal("0")
            )
            paid = Payment.objects.filter(school=school, kind="regular").aggregate(
                p=Sum("total_paid"), d=Sum("total_discount")
            )
            credit = (paid["p"] or Decimal("0")) + (paid["d"] or Decimal("0"))
            self.stdout.write(
                f"{school.name[:38]:38} {students:>8} {staff:>6} "
                f"{collected:>14} {charged - credit:>16}"
            )
