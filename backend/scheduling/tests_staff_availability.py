from datetime import time, timedelta

from django.test import override_settings
from django.utils import timezone

from .availability import compute_slots
from .models import TimeOff, WorkingHours
from .tests import BookingTestCase, local


@override_settings(BUSINESS_TIMEZONE="America/New_York")
class WorkingHoursTests(BookingTestCase):
    url = "/api/staff/{}/hours/"

    def put(self, user, staff, hours):
        return self.client_for(user).put(self.url.format(staff.id), {"hours": hours}, format="json")

    def test_staff_replace_their_weekly_hours(self):
        response = self.put(self.staff_user, self.staff, [
            {"weekday": 1, "start_time": "10:00", "end_time": "14:00"},
            {"weekday": 1, "start_time": "15:00", "end_time": "18:00"},
        ])
        self.assertEqual(response.status_code, 200, response.data)
        shifts = list(self.staff.working_hours.values_list("weekday", "start_time", "end_time"))
        self.assertEqual(shifts, [(1, time(10), time(14)), (1, time(15), time(18))])  # Monday shift is gone

    def test_new_hours_change_availability_immediately(self):
        tuesday = self.monday + timedelta(days=1)
        self.put(self.staff_user, self.staff, [{"weekday": 1, "start_time": "09:00", "end_time": "10:00"}])
        slots = compute_slots(self.service, [self.staff], tuesday, tuesday)[tuesday]
        self.assertEqual([s.start for s in slots], [local(tuesday, "09:00")])

    def test_overlapping_and_backwards_shifts_are_rejected(self):
        overlap = self.put(self.staff_user, self.staff, [
            {"weekday": 2, "start_time": "09:00", "end_time": "13:00"},
            {"weekday": 2, "start_time": "12:00", "end_time": "16:00"},
        ])
        backwards = self.put(self.staff_user, self.staff, [{"weekday": 2, "start_time": "17:00", "end_time": "09:00"}])
        self.assertEqual((overlap.status_code, backwards.status_code), (400, 400))
        self.assertIn("overlap", str(overlap.data))
        self.assertEqual(self.staff.working_hours.count(), 1)  # unchanged

    def test_bookings_left_outside_new_hours_are_reported_not_cancelled(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        response = self.put(self.staff_user, self.staff, [{"weekday": 0, "start_time": "12:00", "end_time": "17:00"}])
        self.assertEqual([a["id"] for a in response.data["outside_hours"]], [appointment.id])
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, "confirmed")

    def test_staff_cannot_edit_someone_elses_hours_but_admins_can(self):
        hours = [{"weekday": 3, "start_time": "09:00", "end_time": "12:00"}]
        self.assertEqual(self.put(self.staff_user, self.other_staff, hours).status_code, 403)
        self.assertEqual(self.put(self.customer, self.staff, hours).status_code, 403)
        self.assertEqual(self.put(self.admin, self.other_staff, hours).status_code, 200)

    def test_me_endpoint(self):
        self.assertEqual(self.client_for(self.staff_user).get("/api/staff/me/").data["id"], self.staff.id)
        self.assertEqual(self.client_for(self.customer).get("/api/staff/me/").status_code, 403)


@override_settings(BUSINESS_TIMEZONE="America/New_York")
class TimeOffTests(BookingTestCase):
    def post(self, user, staff, start, end, reason="Dentist"):
        return self.client_for(user).post(
            f"/api/staff/{staff.id}/time-off/", {"start": start, "end": end, "reason": reason}, format="json"
        )

    def test_times_are_read_in_studio_time(self):
        day = self.monday.isoformat()
        response = self.post(self.staff_user, self.staff, f"{day}T09:00", f"{day}T10:30")
        self.assertEqual(response.status_code, 201, response.data)
        time_off = TimeOff.objects.get()
        self.assertEqual(time_off.start, local(self.monday, "09:00"))
        self.assertEqual(time_off.end, local(self.monday, "10:30"))

    def test_time_off_blocks_bookings(self):
        day = self.monday.isoformat()
        self.post(self.staff_user, self.staff, f"{day}T00:00", f"{day}T23:59")
        self.assertEqual(compute_slots(self.service, [self.staff], self.monday, self.monday)[self.monday], [])

    def test_clashing_bookings_are_listed_and_nothing_is_saved(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        day = self.monday.isoformat()
        response = self.post(self.staff_user, self.staff, f"{day}T08:00", f"{day}T12:00")
        self.assertEqual(response.status_code, 409)
        self.assertEqual([c["id"] for c in response.data["conflicts"]], [appointment.id])
        self.assertFalse(TimeOff.objects.exists())

    def test_end_must_be_after_start_and_in_the_future(self):
        day = self.monday.isoformat()
        self.assertEqual(self.post(self.staff_user, self.staff, f"{day}T12:00", f"{day}T09:00").status_code, 400)
        past = (timezone.now() - timedelta(days=2)).date().isoformat()
        self.assertEqual(self.post(self.staff_user, self.staff, f"{past}T09:00", f"{past}T10:00").status_code, 400)

    def test_list_and_delete(self):
        day = self.monday.isoformat()
        created = self.post(self.staff_user, self.staff, f"{day}T09:00", f"{day}T10:00").data
        client = self.client_for(self.staff_user)
        self.assertEqual([t["id"] for t in client.get(f"/api/staff/{self.staff.id}/time-off/").data], [created["id"]])
        self.assertEqual(client.delete(f"/api/staff/{self.staff.id}/time-off/{created['id']}/").status_code, 204)
        self.assertFalse(TimeOff.objects.exists())

    def test_staff_cannot_touch_someone_elses_time_off(self):
        day = self.monday.isoformat()
        self.assertEqual(self.post(self.staff_user, self.other_staff, f"{day}T09:00", f"{day}T10:00").status_code, 403)
        created = self.post(self.admin, self.other_staff, f"{day}T09:00", f"{day}T10:00")
        self.assertEqual(created.status_code, 201)
        response = self.client_for(self.staff_user).delete(f"/api/staff/{self.other_staff.id}/time-off/{created.data['id']}/")
        self.assertEqual(response.status_code, 403)

    def test_working_hours_model_unchanged_by_time_off(self):
        day = self.monday.isoformat()
        self.post(self.staff_user, self.staff, f"{day}T09:00", f"{day}T10:00")
        self.assertEqual(WorkingHours.objects.filter(staff=self.staff).count(), 1)
