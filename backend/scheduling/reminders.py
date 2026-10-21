"""Appointment reminder emails, sent ahead of each visit by the `send_reminders` worker.

Safe to run on a schedule, repeatedly, or as several workers at once: each appointment is
locked (SELECT ... FOR UPDATE SKIP LOCKED) while its reminder goes out and is then stamped
with `reminder_sent_at`, so nobody gets the same reminder twice.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.db.models import F
from django.template.loader import render_to_string
from django.utils import timezone

from .availability import business_tz
from .models import Appointment

logger = logging.getLogger(__name__)


@dataclass
class ReminderRun:
    sent: int = 0
    suppressed: int = 0  # demo accounts: marked as reminded, but no email leaves the building
    failed: list[int] = field(default_factory=list)


def due_reminders(now: datetime | None = None):
    """Appointments whose reminder should go out now."""
    now = now or timezone.now()
    return Appointment.objects.filter(
        status__in=[Appointment.Status.PENDING, Appointment.Status.CONFIRMED],
        reminder_sent_at__isnull=True,
        start__gt=now,
        start__lte=now + timedelta(hours=settings.REMINDER_HOURS_BEFORE),
        created_at__lte=F("start") - timedelta(hours=settings.REMINDER_MIN_BOOKING_LEAD_HOURS),
    )


def send_due_reminders(now: datetime | None = None) -> ReminderRun:
    now = now or timezone.now()
    run = ReminderRun()
    for appointment_id in list(due_reminders(now).values_list("id", flat=True)):
        try:
            outcome = _remind(appointment_id, now)
        except Exception:
            # One bad address or SMTP hiccup shouldn't stop the rest; it's retried next run.
            logger.exception("Reminder failed for appointment %s", appointment_id)
            run.failed.append(appointment_id)
            continue
        if outcome == "sent":
            run.sent += 1
        elif outcome == "suppressed":
            run.suppressed += 1
    return run


def _remind(appointment_id: int, now: datetime) -> str | None:
    with transaction.atomic():
        appointment = (
            due_reminders(now)
            .select_related("customer", "service", "staff__user")
            .select_for_update(skip_locked=True, of=("self",))
            .filter(pk=appointment_id)
            .first()
        )
        if appointment is None:
            return None  # another worker has it, or it was cancelled/rescheduled meanwhile

        if appointment.customer.is_demo:
            outcome = "suppressed"
            logger.info("Reminder for demo appointment %s recorded, not emailed", appointment.id)
        else:
            # Sent while the row is locked: if sending raises, the stamp below rolls back and
            # the next run retries.
            build_reminder_email(appointment, now).send()
            outcome = "sent"

        appointment.reminder_sent_at = now
        appointment.save(update_fields=["reminder_sent_at", "updated_at"])
        return outcome


def build_reminder_email(appointment: Appointment, now: datetime | None = None) -> EmailMultiAlternatives:
    now = now or timezone.now()
    tz = business_tz()
    local_start = appointment.start.astimezone(tz)
    days_away = (local_start.date() - now.astimezone(tz).date()).days
    day = {0: "today", 1: "tomorrow"}.get(days_away, local_start.strftime("%A"))
    time = local_start.strftime("%I:%M %p").lstrip("0")

    payment = next((p for p in appointment.payments.all() if p.status == "paid"), None)
    deposit = payment.amount if payment else 0
    context = {
        "business_name": settings.BUSINESS_NAME,
        "first_name": appointment.customer.first_name or "there",
        "service": appointment.service.name,
        "staff": appointment.staff.user.get_full_name(),
        "day": day,
        "time": time,
        "date": f"{local_start:%A, %B} {local_start.day}",
        "duration": appointment.service.duration_minutes,
        "deposit": deposit,
        "balance": appointment.price - deposit,
        "manage_url": f"{settings.FRONTEND_URL}/appointments",
        "cutoff_hours": settings.CANCELLATION_CUTOFF_HOURS,
        "tz_name": local_start.tzname(),
    }
    message = EmailMultiAlternatives(
        subject=f"Reminder: {appointment.service.name} {day} at {time}",
        body=render_to_string("scheduling/email/reminder.txt", context),
        to=[appointment.customer.email],
    )
    message.attach_alternative(render_to_string("scheduling/email/reminder.html", context), "text/html")
    return message
