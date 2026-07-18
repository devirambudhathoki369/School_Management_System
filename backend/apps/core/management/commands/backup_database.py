"""
Database backup (legacy superadmin DatabaseBackupView, as a vendor op).

Runs pg_dump in custom format against the configured default database and
writes a timestamped .dump into --out (default ./backups). Wire it to cron
for the nightly copy; restore with pg_restore.
"""

import os
import subprocess
from datetime import datetime

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "pg_dump the default database to a timestamped file."

    def add_arguments(self, parser):
        parser.add_argument("--out", default="backups", help="Target directory.")

    def handle(self, *args, **options):
        db = settings.DATABASES["default"]
        if "postgresql" not in db["ENGINE"]:
            raise CommandError("Only PostgreSQL is supported.")
        os.makedirs(options["out"], exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        target = os.path.join(options["out"], f"{db['NAME']}_{stamp}.dump")
        env = os.environ.copy()
        if db.get("PASSWORD"):
            env["PGPASSWORD"] = db["PASSWORD"]
        cmd = ["pg_dump", "-Fc", "-f", target, "-d", db["NAME"]]
        for flag, key in (("-h", "HOST"), ("-p", "PORT"), ("-U", "USER")):
            if db.get(key):
                cmd += [flag, str(db[key])]
        # S603: argv comes from Django settings, not request input.
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)  # noqa: S603
        if result.returncode != 0:
            raise CommandError(f"pg_dump failed: {result.stderr.strip()}")
        size = os.path.getsize(target)
        self.stdout.write(self.style.SUCCESS(f"{target} ({size / 1_048_576:.1f} MB)"))
