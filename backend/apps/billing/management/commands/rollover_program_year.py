"""
Shared-clock program roll (legacy rollover_academic_year): every level of a
higher-ed course maps to ONE academic year — close it, open the next, carry
balances per fee title where clean (see services.year_end.rollover_program_year).
Dry-run by default. Run promote_program AFTER this, never before.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.academics.models import Course
from apps.billing.models import BillingYear
from apps.billing.services.year_end import rollover_program_year
from apps.tenants.models import School


class Command(BaseCommand):
    help = "Roll a program's single academic year forward (dry-run by default)."

    def add_arguments(self, parser):
        parser.add_argument("--school", required=True, help="School id or slug")
        parser.add_argument("--course", required=True, help="Course id or name")
        parser.add_argument("--new-ay", required=True, help="New academic year name")
        parser.add_argument("--start", required=True, help="New AY start (BS)")
        parser.add_argument("--end", required=True, help="New AY end (BS)")
        parser.add_argument("--billing-year", help="Billing year name (default: open one)")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        school = (
            School.objects.filter(slug=options["school"]).first()
            or School.objects.filter(id__iexact=options["school"]).first()
        )
        if school is None:
            raise CommandError("Unknown school.")
        course = (
            Course.objects.filter(school=school, id__iexact=options["course"]).first()
            or Course.objects.filter(school=school, name__iexact=options["course"]).first()
        )
        if course is None:
            raise CommandError("Unknown course for that school.")
        if options["billing_year"]:
            billing_year = BillingYear.objects.filter(
                name=options["billing_year"]
            ).first()
        else:
            billing_year = BillingYear.objects.filter(closed=False).order_by(
                "-start_date_bs"
            ).first()
        if billing_year is None:
            raise CommandError("No billing year found.")

        result = rollover_program_year(
            school, course,
            {
                "name": options["new_ay"],
                "start_date_bs": options["start"],
                "end_date_bs": options["end"],
            },
            billing_year, actor=None, apply=options["apply"],
        )
        self.stdout.write(
            f"{result['old_year']}: {result['students']} students carry "
            f"NPR {result['total']} ({result['per_title_students']} per-title)."
        )
        if result["applied"]:
            self.stdout.write(self.style.SUCCESS(f"Rolled into {result['new_year']}."))
        else:
            self.stdout.write(self.style.NOTICE("DRY-RUN — re-run with --apply."))
