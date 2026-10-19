"""Computes bookable time slots from working hours, existing appointments and time off.

All comparisons are done in UTC. Working hours are wall-clock times in the business
timezone, so a 09:00 shift stays at 09:00 local time across DST changes.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

from .models import Appointment, Service, StaffMember, TimeOff


@dataclass(frozen=True)
class Slot:
    start: datetime
    end: datetime
    staff_id: int


def business_tz() -> ZoneInfo:
    return ZoneInfo(settings.BUSINESS_TIMEZONE)


def local_day_bounds(day: date) -> tuple[datetime, datetime]:
    """UTC start and end of a calendar day in the business timezone."""
    tz = business_tz()
    start = datetime.combine(day, datetime.min.time(), tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def booking_window() -> tuple[datetime, datetime]:
    """Earliest and latest instants a new booking may start."""
    now = timezone.now()
    return (
        now + timedelta(minutes=settings.MIN_BOOKING_NOTICE_MINUTES),
        now + timedelta(days=settings.MAX_BOOKING_DAYS_AHEAD),
    )


def _busy_intervals(staff_ids, range_start, range_end) -> dict[int, list[tuple[datetime, datetime]]]:
    busy: dict[int, list[tuple[datetime, datetime]]] = defaultdict(list)
    appointments = (
        Appointment.objects.active()
        .filter(staff_id__in=staff_ids)
        .overlapping(range_start, range_end)
        .values_list("staff_id", "start", "end")
    )
    time_off = (
        TimeOff.objects.filter(staff_id__in=staff_ids, start__lt=range_end, end__gt=range_start)
        .values_list("staff_id", "start", "end")
    )
    for staff_id, start, end in [*appointments, *time_off]:
        busy[staff_id].append((start, end))
    return busy


def _overlaps_any(start, end, intervals) -> bool:
    return any(start < busy_end and end > busy_start for busy_start, busy_end in intervals)


def compute_slots(service: Service, staff_members, first_day: date, last_day: date) -> dict[date, list[Slot]]:
    """Return available slots per local day (inclusive range) for the given staff members."""
    staff_members = list(staff_members)
    if not staff_members or last_day < first_day:
        return {}

    tz = business_tz()
    step = timedelta(minutes=settings.SLOT_INTERVAL_MINUTES)
    duration = service.duration
    earliest, latest = booking_window()

    range_start, _ = local_day_bounds(first_day)
    _, range_end = local_day_bounds(last_day)
    staff_ids = [s.id for s in staff_members]
    busy = _busy_intervals(staff_ids, range_start, range_end)

    hours_by_staff: dict[int, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    for staff in staff_members:
        for shift in staff.working_hours.all():
            hours_by_staff[staff.id][shift.weekday].append(shift)

    result: dict[date, list[Slot]] = {}
    day = first_day
    while day <= last_day:
        slots: list[Slot] = []
        for staff in staff_members:
            for shift in hours_by_staff[staff.id][day.weekday()]:
                shift_start = datetime.combine(day, shift.start_time, tzinfo=tz).astimezone(UTC)
                shift_end = datetime.combine(day, shift.end_time, tzinfo=tz).astimezone(UTC)
                cursor = shift_start
                while cursor + duration <= shift_end:
                    slot_end = cursor + duration
                    if earliest <= cursor <= latest and not _overlaps_any(cursor, slot_end, busy[staff.id]):
                        slots.append(Slot(cursor, slot_end, staff.id))
                    cursor += step
        slots.sort(key=lambda s: (s.start, s.staff_id))
        result[day] = slots
        day += timedelta(days=1)
    return result


def bookable_staff(service: Service, staff_id: int | None = None):
    qs = StaffMember.objects.filter(is_active=True, services=service).prefetch_related("working_hours")
    if staff_id is not None:
        qs = qs.filter(id=staff_id)
    return qs


def next_available_slot(service: Service, search_days: int = 14) -> Slot | None:
    """The earliest open slot for a service with any staff member, looking `search_days` ahead."""
    today = timezone.now().astimezone(business_tz()).date()
    by_day = compute_slots(service, bookable_staff(service), today, today + timedelta(days=search_days - 1))
    return next((slots[0] for _, slots in sorted(by_day.items()) if slots), None)


def is_slot_available(service: Service, staff: StaffMember, start: datetime) -> bool:
    start = start.astimezone(UTC)
    day = start.astimezone(business_tz()).date()
    slots = compute_slots(service, bookable_staff(service, staff.id), day, day).get(day, [])
    return any(slot.start == start for slot in slots)
