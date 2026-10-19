"""Seed a realistic demo dataset: services, staff with weekly hours, customers, and ~6 weeks of bookings.

    python manage.py seed_demo

Re-running wipes and recreates all scheduling data and demo users, so it's safe to run on a
schedule (e.g. nightly) to reset a public demo.
"""

import random
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import connection, transaction
from django.utils import timezone

from accounts.models import DEMO_EMAIL_DOMAIN
from scheduling.availability import business_tz
from scheduling.models import Appointment, Service, StaffMember, TimeOff, WorkingHours

User = get_user_model()


# (name, category, description, minutes, price, relative popularity)
SERVICES = [
    ("Signature Massage", "massage", "Full-body relaxation massage with warm oils.", 60, "90.00", 5),
    ("Deep Tissue Massage", "massage", "Targeted pressure for chronic tension and recovery.", 90, "130.00", 3),
    ("Hot Stone Massage", "massage", "Heated basalt stones melt away deep muscle tension.", 75, "110.00", 2),
    ("Express Facial", "skin", "Cleanse, exfoliate and hydrate in under an hour.", 45, "70.00", 5),
    ("Hydrating Facial", "skin", "Deep hydration with a calming mask and facial massage.", 60, "95.00", 3),
    ("Haircut & Style", "hair", "Consultation, wash, cut and blow-dry.", 45, "55.00", 6),
    ("Colour & Gloss", "hair", "All-over colour or gloss refresh, finished with a blow-dry.", 90, "120.00", 2),
    ("Free Consultation", "consultation", "A short chat to plan your treatment.", 15, "0.00", 1),
]

# (username, first, last, title, service indexes, weekly shifts {weekday: [(start, end), ...]})
STAFF = [
    ("demo-staff", "Maya", "Chen", "Senior Massage Therapist", [0, 1, 2, 7],
     {0: [("09:00", "13:00"), ("14:00", "18:00")], 1: [("09:00", "17:00")], 3: [("11:00", "19:00")],
      4: [("09:00", "17:00")], 5: [("10:00", "15:00")]}),
    ("staff-jordan", "Jordan", "Rivera", "Esthetician", [3, 4, 7],
     {1: [("10:00", "18:00")], 2: [("10:00", "18:00")], 3: [("10:00", "18:00")], 4: [("12:00", "20:00")]}),
    ("staff-sam", "Sam", "Okafor", "Stylist", [5, 6, 7],
     {0: [("10:00", "18:00")], 2: [("12:00", "20:00")], 4: [("10:00", "18:00")], 5: [("09:00", "14:00")]}),
]

CUSTOMER_NAMES = [
    "Ava Thompson", "Liam Patel", "Sofia Martinez", "Noah Kim", "Isabella Rossi", "Ethan Brooks",
    "Mia Nguyen", "Lucas Silva", "Amelia Johnson", "Oliver Schmidt", "Harper Davis", "Elijah Moore",
    "Zara Ahmed", "Leo Fischer", "Chloe Dubois",
]


class Command(BaseCommand):
    help = "Wipe and seed demo data for the booking app."

    def add_arguments(self, parser):
        parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducible data.")

    @transaction.atomic
    def handle(self, *args, seed, **options):
        rng = random.Random(seed)
        tz = business_tz()

        # TRUNCATE ... RESTART IDENTITY keeps IDs stable across resets, so shared links
        # like /book?service=1 keep working after the nightly reseed.
        tables = [
            m._meta.db_table
            for m in (Appointment, TimeOff, WorkingHours, StaffMember.services.through, StaffMember, Service)
        ]
        with connection.cursor() as cursor:
            cursor.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")
        User.objects.filter(email__endswith=f"@{DEMO_EMAIL_DOMAIN}").delete()

        services = [
            Service.objects.create(name=n, category=c, description=d, duration_minutes=m, price=Decimal(p))
            for n, c, d, m, p, _ in SERVICES
        ]
        popularity = {service.id: weight for service, (*_, weight) in zip(services, SERVICES)}

        self._user("demo-admin", "Alex", "Morgan", User.Role.ADMIN)
        demo_customer = self._user("demo-customer", "Casey", "Walker", User.Role.CUSTOMER)
        customers = [demo_customer] + [
            self._user(f"customer-{i}", *name.split(" ", 1), User.Role.CUSTOMER)
            for i, name in enumerate(CUSTOMER_NAMES)
        ]

        staff_members = []
        for username, first, last, title, service_idx, shifts in STAFF:
            user = self._user(username, first, last, User.Role.STAFF)
            staff = StaffMember.objects.create(user=user, title=title, bio=f"{first} has been with the studio for years.")
            staff.services.set([services[i] for i in service_idx])
            for weekday, ranges in shifts.items():
                for start, end in ranges:
                    WorkingHours.objects.create(
                        staff=staff, weekday=weekday, start_time=time.fromisoformat(start), end_time=time.fromisoformat(end)
                    )
            staff_members.append(staff)

        today = timezone.now().astimezone(tz).date()
        # Jordan is away for a couple of days next week — shows time off blocking availability.
        off_day = today + timedelta(days=(7 - today.weekday()) + 2)
        TimeOff.objects.create(
            staff=staff_members[1],
            start=datetime.combine(off_day, time.min, tzinfo=tz),
            end=datetime.combine(off_day + timedelta(days=2), time.min, tzinfo=tz),
            reason="Training course",
        )

        now = timezone.now()
        earliest_future = now + timedelta(hours=2)
        created = 0
        for offset in range(-30, 15):
            day = today + timedelta(days=offset)
            for staff in staff_members:
                staff_services = list(staff.services.all())
                weights = [popularity[s.id] for s in staff_services]
                for shift in staff.working_hours.filter(weekday=day.weekday()):
                    cursor = datetime.combine(day, shift.start_time, tzinfo=tz).astimezone(UTC)
                    shift_end = datetime.combine(day, shift.end_time, tzinfo=tz).astimezone(UTC)
                    fill_rate = 0.65 if offset < 0 else max(0.15, 0.6 - offset * 0.03)
                    while cursor < shift_end:
                        service = rng.choices(staff_services, weights)[0]
                        end = cursor + service.duration
                        if end > shift_end:
                            break
                        future = cursor > now
                        if (future and cursor < earliest_future) or rng.random() > fill_rate:
                            cursor += timedelta(minutes=rng.choice([15, 30, 45]))
                            continue
                        if TimeOff.objects.filter(staff=staff, start__lt=end, end__gt=cursor).exists():
                            break
                        Appointment.objects.create(
                            customer=rng.choice(customers[1:]),
                            staff=staff,
                            service=service,
                            start=cursor,
                            end=end,
                            price=service.price,
                            status=self._status(rng, future),
                        )
                        created += 1
                        cursor = end + timedelta(minutes=rng.choice([0, 0, 15, 30]))

        # Give the demo customer a believable history plus a couple of upcoming visits.
        mine_past = Appointment.objects.filter(start__lt=now, status=Appointment.Status.COMPLETED).order_by("?")[:3]
        mine_future = Appointment.objects.filter(start__gt=earliest_future).active().order_by("?")[:2]
        Appointment.objects.filter(pk__in=[a.pk for a in [*mine_past, *mine_future]]).update(customer=demo_customer)

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {len(services)} services, {len(staff_members)} staff, {len(customers)} customers, "
            f"{created} appointments."
        ))

    @staticmethod
    def _status(rng: random.Random, future: bool) -> str:
        roll = rng.random()
        if future:
            if roll < 0.08:
                return Appointment.Status.CANCELLED
            return Appointment.Status.PENDING if roll < 0.2 else Appointment.Status.CONFIRMED
        if roll < 0.08:
            return Appointment.Status.CANCELLED
        return Appointment.Status.NO_SHOW if roll < 0.12 else Appointment.Status.COMPLETED

    @staticmethod
    def _user(username, first, last, role):
        user = User(
            username=username,
            email=f"{username}@{DEMO_EMAIL_DOMAIN}",
            first_name=first,
            last_name=last,
            role=role,
        )
        user.set_unusable_password()
        user.save()
        return user
