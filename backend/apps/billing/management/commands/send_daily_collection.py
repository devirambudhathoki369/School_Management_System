"""
Daily collection SMS to shareholders (legacy send_daily_collection cron).

Per school with active shareholders: today's collected total, and — for
schools collecting the Education Equality Fee — the 3% payable to the IRO
from today's receipts. Message shape kept exactly:

    Today's Collection Point: <total>
    Today's Collection Point: <total>, Equity Fee Payable: <fee>

Run daily after close of business (cron/Celery beat); --date resends a
missed day.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Sum

from apps.billing.models import EducationFeeLevel, Payment
from apps.communication.providers import send_sms
from apps.core.dates import today_bs
from apps.tenants.models import Shareholder


class Command(BaseCommand):
    help = "SMS each school's shareholders today's collection (+EEF payable)."

    def add_arguments(self, parser):
        parser.add_argument("--date", help="BS date YYYY-MM-DD (default today)")
        parser.add_argument(
            "--dry-run", action="store_true", help="Print messages, send nothing."
        )

    def handle(self, *args, **options):
        date = options["date"] or today_bs()
        by_school: dict = {}
        for sh in Shareholder.objects.select_related("school").filter(
            school__status="active"
        ):
            if sh.contact:
                by_school.setdefault(sh.school, []).append(sh.contact)

        eef_schools = set(
            EducationFeeLevel.objects.values_list("school_id", flat=True)
        )
        sent = 0
        for school, contacts in by_school.items():
            totals = Payment.objects.filter(school=school, date_bs=date).aggregate(
                collected=Sum("total_paid"), eef=Sum("edu_fee_amount")
            )
            collected = totals["collected"] or Decimal("0")
            message = f"Today's Collection Point: {collected}"
            if school.id in eef_schools:
                message += f", Equity Fee Payable: {totals['eef'] or Decimal('0')}"
            if options["dry_run"]:
                self.stdout.write(f"{school.name} -> {contacts}: {message}")
                continue
            sent += send_sms(contacts, message)
        self.stdout.write(self.style.SUCCESS(f"{date}: {sent} SMS handed to provider."))
