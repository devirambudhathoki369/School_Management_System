"""
Clean a botched billing run (legacy superadmin "Clean Student Ledger
posting") — soft-deletes a ChargeBatch and every charge it generated so
dues drop back to their pre-run values.

Guards: refuses when the batch's academic year is closed (year-end already
consumed those balances) and prints the money impact before touching
anything. Dry-run by default; --apply commits.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum

from apps.billing.models import Charge, ChargeBatch


class Command(BaseCommand):
    help = "Soft-delete a billing run and its charges (dry-run by default)."

    def add_arguments(self, parser):
        parser.add_argument("batch_id", help="ChargeBatch id (UUID)")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        batch = ChargeBatch.objects.filter(id=options["batch_id"]).first()
        if batch is None:
            raise CommandError("No such batch (or already cleaned).")
        if batch.academic_year.closed:
            raise CommandError(
                f"Academic year {batch.academic_year.name} is CLOSED — its "
                "balances were consumed by year-end; undo the close first."
            )
        charges = Charge.objects.filter(batch=batch)
        total = charges.aggregate(total=Sum("total"))["total"] or 0
        self.stdout.write(
            f"Batch {batch.date_bs} {batch.class_info} ({batch.school.name}): "
            f"{charges.count()} charges, NPR {total} charged."
        )
        if not options["apply"]:
            self.stdout.write(self.style.NOTICE("DRY-RUN — re-run with --apply."))
            return
        with transaction.atomic():
            count = 0
            for charge in charges:
                charge.soft_delete()
                count += 1
            batch.soft_delete()
        self.stdout.write(self.style.SUCCESS(f"Cleaned: batch + {count} charges."))
