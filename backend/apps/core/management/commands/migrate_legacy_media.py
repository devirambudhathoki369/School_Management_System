"""
Bring the legacy media tree into the new platform's storage layout.

Two different jobs, both idempotent:

1. Student photos — legacy main_student.image paths (student_profiles/…)
   become Student.photo in the per-school layout
   (schools/<school_id>/student-photos/<uuid>.<ext>), validated through the
   same content-sniffing intake as fresh uploads. Corrupt/renamed legacy
   files are reported, never imported blind.
2. Path-preserving copies — homework attachments/submissions and news/notice
   images were imported with their legacy paths kept verbatim in the
   FileFields, so those files just need to EXIST at the same relative path
   under MEDIA_ROOT. They are copied as-is.

The local Cent-New checkout only carries a small dev stub of the media tree;
run again with --source pointed at the production media archive once it has
been fetched — already-migrated rows are skipped.

    python manage.py migrate_legacy_media --source ~/Desktop/Django/Cent-New/smsys.backend/media
"""

import shutil
from pathlib import Path

import psycopg
from django.conf import settings
from django.core.management.base import BaseCommand

from apps.core import uploads
from apps.core.models import LegacyMap
from apps.homework.models import HomeworkAttachment, SubmissionAttachment
from apps.people.models import Student

COPY_MODELS = (
    ("homework attachments", HomeworkAttachment, "file"),
    ("submission attachments", SubmissionAttachment, "file"),
)


class Command(BaseCommand):
    help = "Copy legacy media into MEDIA_ROOT and attach student photos (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--source",
            default=str(Path.home() / "Desktop/Django/Cent-New/smsys.backend/media"),
            help="Legacy media directory (the production archive once fetched).",
        )
        parser.add_argument(
            "--legacy-dsn",
            default="host=/tmp port=5433 dbname=smsys_legacy",
            help="Legacy database DSN (for the student image column).",
        )

    def handle(self, *args, **options):
        source = Path(options["source"])
        if not source.is_dir():
            self.stderr.write(f"Source directory not found: {source}")
            return
        self.migrate_student_photos(source, options["legacy_dsn"])
        self.copy_path_preserving(source)

    # ------------------------------------------------------------- photos

    def migrate_student_photos(self, source: Path, dsn: str):
        students = dict(
            LegacyMap.objects.filter(legacy_table="main_student")
            .values_list("legacy_id", "new_id")
        )
        with psycopg.connect(dsn) as legacy, legacy.cursor() as cur:
            cur.execute(
                "SELECT id, image FROM main_student"
                " WHERE image IS NOT NULL AND image != '' ORDER BY id"
            )
            rows = cur.fetchall()

        attached = skipped = missing = rejected = 0
        for legacy_id, image_path in rows:
            new_id = students.get(legacy_id)
            if new_id is None:
                continue
            student = Student.all_objects.filter(id=new_id).first()
            if student is None or student.photo:
                skipped += 1
                continue
            file_path = source / image_path
            if not file_path.is_file():
                missing += 1
                continue
            with file_path.open("rb") as fh:
                upload = _SimpleUpload(fh, file_path.stat().st_size)
                try:
                    ext = uploads.validate(upload, "photo")
                except Exception:
                    rejected += 1
                    continue
                fh.seek(0)
                from django.core.files import File

                student.photo.save(f"photo.{ext}", File(fh), save=True)
                attached += 1
        self.stdout.write(
            self.style.SUCCESS(
                f"[student photos] attached {attached}; already had {skipped};"
                f" file missing {missing}; failed validation {rejected}"
                f" (of {len(rows)} legacy photo rows)"
            )
        )

    # ----------------------------------------------- path-preserving copies

    def copy_path_preserving(self, source: Path):
        media_root = Path(settings.MEDIA_ROOT)
        for label, model, field in COPY_MODELS:
            copied = present = missing = 0
            for name in model.all_objects.exclude(**{field: ""}).values_list(
                field, flat=True
            ):
                target = media_root / name
                if target.exists():
                    present += 1
                    continue
                origin = source / name
                if not origin.is_file():
                    missing += 1
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(origin, target)
                copied += 1
            self.stdout.write(
                self.style.SUCCESS(
                    f"[{label}] copied {copied}; already present {present}; missing {missing}"
                )
            )


class _SimpleUpload:
    """Just enough of the UploadedFile surface for uploads.validate()."""

    def __init__(self, fh, size):
        self._fh = fh
        self.size = size

    def read(self, n=-1):
        return self._fh.read(n)

    def seek(self, pos):
        return self._fh.seek(pos)
