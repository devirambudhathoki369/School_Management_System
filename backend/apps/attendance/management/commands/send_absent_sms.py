"""
Absent-student SMS (legacy SendAbsentSMSView + cron): after morning
attendance, text each absent student's guardian. Message uses the school's
ATTENDANCE template when one exists ({name} and {date} interpolate), else
the built-in default. Run from cron/Celery beat after attendance closes.
"""

from django.core.management.base import BaseCommand

from apps.attendance.models import StudentAttendanceRecord
from apps.communication.models import DeliveryLog, MessageTemplate
from apps.communication.providers import send_sms
from apps.communication.sms_views import guardian_numbers
from apps.core.dates import today_bs

DEFAULT = "Dear guardian, {name} is absent at school today ({date})."


class Command(BaseCommand):
    help = "SMS guardians of every student marked absent today."

    def add_arguments(self, parser):
        parser.add_argument("--date", help="BS date YYYY-MM-DD (default today)")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        date = options["date"] or today_bs()
        records = (
            StudentAttendanceRecord.objects.filter(
                session__date_bs=date, present=False
            )
            .select_related("student", "session", "session__school")
            .prefetch_related("student__guardian_links__guardian")
        )
        by_school: dict = {}
        for record in records:
            by_school.setdefault(record.session.school, []).append(record.student)

        total = 0
        for school, students in by_school.items():
            template = (
                MessageTemplate.objects.filter(
                    school=school, kind=MessageTemplate.Kind.ATTENDANCE
                )
                .values_list("body", flat=True)
                .first()
                or DEFAULT
            )
            for student, number in guardian_numbers(students):
                message = template.replace("{name}", student.full_name).replace(
                    "{date}", date
                )
                if options["dry_run"]:
                    self.stdout.write(f"{school.name} {number}: {message}")
                    continue
                total += send_sms([number], message)
                DeliveryLog.objects.create(
                    school=school, title="Absent alert", body=message[:500],
                    data={"number": number, "channel": "sms"},
                    status=DeliveryLog.Status.SENT,
                )
        self.stdout.write(self.style.SUCCESS(f"{date}: {total} absent alerts sent."))
