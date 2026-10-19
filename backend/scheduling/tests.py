from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .availability import business_tz, compute_slots, next_available_slot
from .models import Appointment, Service, StaffMember, TimeOff, WorkingHours

User = get_user_model()


def next_weekday(weekday: int, weeks_ahead: int = 1):
    today = timezone.now().astimezone(business_tz()).date()
    return today + timedelta(days=(weekday - today.weekday()) % 7 + 7 * weeks_ahead)


def local(day, hh_mm: str) -> datetime:
    return datetime.combine(day, time.fromisoformat(hh_mm), tzinfo=business_tz()).astimezone(UTC)


@override_settings(BUSINESS_TIMEZONE="America/New_York", SLOT_INTERVAL_MINUTES=15, MIN_BOOKING_NOTICE_MINUTES=60)
class BookingTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.service = Service.objects.create(name="Massage", duration_minutes=60, price=Decimal("90.00"))
        cls.staff_user = User.objects.create_user("maya", "maya@example.com", "x", role=User.Role.STAFF)
        cls.other_staff_user = User.objects.create_user("sam", "sam@example.com", "x", role=User.Role.STAFF)
        cls.customer = User.objects.create_user("casey", "casey@example.com", "x", role=User.Role.CUSTOMER)
        cls.other_customer = User.objects.create_user("ava", "ava@example.com", "x", role=User.Role.CUSTOMER)
        cls.admin = User.objects.create_user("alex", "alex@example.com", "x", role=User.Role.ADMIN)

        cls.staff = StaffMember.objects.create(user=cls.staff_user)
        cls.staff.services.add(cls.service)
        cls.other_staff = StaffMember.objects.create(user=cls.other_staff_user)
        cls.other_staff.services.add(cls.service)
        for staff in (cls.staff, cls.other_staff):
            WorkingHours.objects.create(staff=staff, weekday=0, start_time=time(9), end_time=time(12))

        cls.monday = next_weekday(0)

    def book(self, staff, start, customer=None, status=Appointment.Status.CONFIRMED):
        return Appointment.objects.create(
            customer=customer or self.customer, staff=staff, service=self.service,
            start=start, end=start + self.service.duration, price=self.service.price, status=status,
        )

    def client_for(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user)
        return client


class ExclusionConstraintTests(BookingTestCase):
    def test_database_rejects_overlapping_appointments_for_same_staff(self):
        self.book(self.staff, local(self.monday, "09:00"))
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.book(self.staff, local(self.monday, "09:30"), customer=self.other_customer)

    def test_back_to_back_appointments_are_allowed(self):
        self.book(self.staff, local(self.monday, "09:00"))
        self.book(self.staff, local(self.monday, "10:00"))  # [) ranges: 10:00 end doesn't clash with 10:00 start

    def test_different_staff_can_overlap(self):
        self.book(self.staff, local(self.monday, "09:00"))
        self.book(self.other_staff, local(self.monday, "09:00"))

    def test_cancelled_appointment_frees_the_slot(self):
        self.book(self.staff, local(self.monday, "09:00"), status=Appointment.Status.CANCELLED)
        self.book(self.staff, local(self.monday, "09:00"))


class AvailabilityTests(BookingTestCase):
    def slots(self, staff=None):
        result = compute_slots(self.service, [staff or self.staff], self.monday, self.monday)
        return [s.start for s in result[self.monday]]

    def test_slots_fill_the_shift(self):
        slots = self.slots()
        # 09:00–12:00 with a 60-minute service on a 15-minute grid: 09:00 … 11:00
        self.assertEqual(slots[0], local(self.monday, "09:00"))
        self.assertEqual(slots[-1], local(self.monday, "11:00"))
        self.assertEqual(len(slots), 9)

    def test_existing_appointment_blocks_overlapping_slots(self):
        self.book(self.staff, local(self.monday, "10:00"))
        slots = self.slots()
        self.assertIn(local(self.monday, "09:00"), slots)
        self.assertNotIn(local(self.monday, "09:15"), slots)
        self.assertNotIn(local(self.monday, "10:45"), slots)
        self.assertIn(local(self.monday, "11:00"), slots)

    def test_time_off_blocks_slots(self):
        TimeOff.objects.create(staff=self.staff, start=local(self.monday, "00:00"), end=local(self.monday, "23:59"))
        self.assertEqual(self.slots(), [])

    def test_next_available_skips_booked_time(self):
        # Both staff are booked at 09:00 next Monday, so that slot must never be offered as the next opening.
        self.book(self.staff, local(self.monday, "09:00"))
        self.book(self.other_staff, local(self.monday, "09:00"))
        slot = next_available_slot(self.service, search_days=21)
        self.assertIsNotNone(slot)
        self.assertNotEqual(slot.start, local(self.monday, "09:00"))

    def test_service_list_includes_next_opening(self):
        response = APIClient().get("/api/services/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["category"], "other")
        self.assertIn("next_available", response.data[0])

    def test_no_slots_on_days_off(self):
        tuesday = self.monday + timedelta(days=1)
        self.assertEqual(compute_slots(self.service, [self.staff], tuesday, tuesday)[tuesday], [])


class BookingApiTests(BookingTestCase):
    def payload(self, start, staff=None):
        return {"service_id": self.service.id, "staff_id": (staff or self.staff).id, "start": start.isoformat()}

    def test_customer_can_book_open_slot(self):
        response = self.client_for(self.customer).post("/api/appointments/", self.payload(local(self.monday, "09:00")))
        self.assertEqual(response.status_code, 201, response.data)
        appointment = Appointment.objects.get()
        self.assertEqual(appointment.customer, self.customer)
        self.assertEqual(appointment.end, local(self.monday, "10:00"))
        self.assertEqual(appointment.price, Decimal("90.00"))

    def test_booking_taken_slot_returns_conflict(self):
        self.book(self.staff, local(self.monday, "09:00"), customer=self.other_customer)
        response = self.client_for(self.customer).post("/api/appointments/", self.payload(local(self.monday, "09:30")))
        self.assertEqual(response.status_code, 409)

    def test_booking_outside_working_hours_is_rejected(self):
        response = self.client_for(self.customer).post("/api/appointments/", self.payload(local(self.monday, "13:00")))
        self.assertEqual(response.status_code, 409)

    def test_booking_requires_auth(self):
        response = APIClient().post("/api/appointments/", self.payload(local(self.monday, "09:00")))
        self.assertEqual(response.status_code, 401)

    def test_availability_endpoint_groups_staff_per_slot(self):
        self.book(self.staff, local(self.monday, "09:00"))
        response = APIClient().get(
            "/api/availability/", {"service": self.service.id, "from": self.monday.isoformat()}
        )
        self.assertEqual(response.status_code, 200)
        first = response.data["days"][0]["slots"][0]
        self.assertEqual(first["start"], local(self.monday, "09:00"))
        self.assertEqual(first["staff_ids"], [self.other_staff.id])


class PermissionTests(BookingTestCase):
    def test_customers_only_see_their_own_appointments(self):
        mine = self.book(self.staff, local(self.monday, "09:00"))
        self.book(self.staff, local(self.monday, "10:00"), customer=self.other_customer)
        response = self.client_for(self.customer).get("/api/appointments/")
        self.assertEqual([a["id"] for a in response.data["results"]], [mine.id])

    def test_staff_only_see_their_own_schedule(self):
        mine = self.book(self.staff, local(self.monday, "09:00"))
        self.book(self.other_staff, local(self.monday, "09:00"))
        response = self.client_for(self.staff_user).get("/api/appointments/")
        self.assertEqual([a["id"] for a in response.data["results"]], [mine.id])

    def test_customer_cannot_complete_appointment(self):
        appointment = self.book(self.staff, timezone.now() - timedelta(hours=3))
        response = self.client_for(self.customer).post(f"/api/appointments/{appointment.id}/complete/")
        self.assertEqual(response.status_code, 403)

    def test_staff_can_complete_started_appointment(self):
        appointment = self.book(self.staff, timezone.now() - timedelta(hours=3))
        response = self.client_for(self.staff_user).post(f"/api/appointments/{appointment.id}/complete/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "completed")

    def test_dashboard_is_admin_only(self):
        self.assertEqual(self.client_for(self.customer).get("/api/dashboard/").status_code, 403)
        self.assertEqual(self.client_for(self.admin).get("/api/dashboard/").status_code, 200)


@override_settings(CANCELLATION_CUTOFF_HOURS=2)
class CancellationTests(BookingTestCase):
    def test_customer_can_cancel_before_cutoff(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        response = self.client_for(self.customer).post(f"/api/appointments/{appointment.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "cancelled")

    def test_customer_cannot_cancel_inside_cutoff(self):
        appointment = self.book(self.staff, timezone.now() + timedelta(hours=1))
        response = self.client_for(self.customer).post(f"/api/appointments/{appointment.id}/cancel/")
        self.assertEqual(response.status_code, 400)

    def test_staff_can_cancel_inside_cutoff(self):
        appointment = self.book(self.staff, timezone.now() + timedelta(hours=1))
        response = self.client_for(self.staff_user).post(f"/api/appointments/{appointment.id}/cancel/")
        self.assertEqual(response.status_code, 200)
