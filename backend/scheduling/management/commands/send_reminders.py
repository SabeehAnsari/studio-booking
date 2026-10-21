"""Background worker that emails appointment reminders.

    python manage.py send_reminders            # one pass: for a scheduler (cron, GitHub Actions)
    python manage.py send_reminders --loop     # long-running worker, checks every 5 minutes
"""

import signal
import time

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from scheduling.reminders import send_due_reminders


class Command(BaseCommand):
    help = "Email reminders for upcoming appointments."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Keep running, checking on an interval.")
        parser.add_argument("--interval", type=int, default=300, help="Seconds between checks with --loop.")

    def handle(self, *args, loop, interval, **options):
        if not loop:
            run = self.run_once()
            if run.failed:
                # Non-zero exit so a scheduler (e.g. GitHub Actions) shows the run as failed.
                raise CommandError(f"Reminders failed for appointments {run.failed}; they'll be retried next run.")
            return

        stopping = False

        def stop(signum, frame):
            nonlocal stopping
            stopping = True
            self.stdout.write("Stopping after the current pass…")

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)

        self.stdout.write(f"Reminder worker started; checking every {interval}s.")
        while not stopping:
            # The database may have closed idle connections (e.g. Neon scaling to zero).
            close_old_connections()
            try:
                self.run_once()
            except Exception as exc:  # keep the worker alive through transient failures
                self.stderr.write(f"Reminder pass failed: {exc}")
            for _ in range(interval):
                if stopping:
                    break
                time.sleep(1)

    def run_once(self):
        run = send_due_reminders()
        message = f"Reminders: {run.sent} sent, {run.suppressed} demo (not emailed), {len(run.failed)} failed."
        self.stdout.write(self.style.ERROR(message) if run.failed else message)
        return run
