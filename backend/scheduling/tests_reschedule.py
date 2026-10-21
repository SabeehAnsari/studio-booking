from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Appointment
from .tests import BookingTestCase, local


@override_settings(CANCELLATION_CUTOFF_HOURS=2, MIN_BOOKING_NOTICE_MINUTES=60)
class RescheduleTests(BookingTestCase):
    def reschedule(self, user, appointment, start, staff=None):
        body = {"start": start.isoformat()}
        if staff:
            body["staff_id"] = staff.id
        return self.client_for(user).post(f"/api/appointments/{appointment.id}/reschedule/", body)

    def test_customer_moves_booking_to_a_free_time(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        response = self.reschedule(self.customer, appointment, local(self.monday, "11:00"))
        self.assertEqual(response.status_code, 200, response.data)
        appointment.refresh_from_db()
        self.assertEqual(appointment.start, local(self.monday, "11:00"))
        self.assertEqual(appointment.end, local(self.monday, "12:00"))
        self.assertEqual(appointment.status, Appointment.Status.CONFIRMED)

    def test_can_shift_into_time_it_already_occupies(self):
        # 09:00–10:00 → 09:15–10:15 overlaps its own old slot; that mustn't count as a clash.
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        response = self.reschedule(self.customer, appointment, local(self.monday, "09:15"))
        self.assertEqual(response.status_code, 200, response.data)

    def test_cannot_move_onto_someone_elses_booking(self):
        self.book(self.staff, local(self.monday, "10:00"), customer=self.other_customer)
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        response = self.reschedule(self.customer, appointment, local(self.monday, "10:30"))
        self.assertEqual(response.status_code, 409)
        appointment.refresh_from_db()
        self.assertEqual(appointment.start, local(self.monday, "09:00"))

    def test_cannot_move_outside_working_hours(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        self.assertEqual(self.reschedule(self.customer, appointment, local(self.monday, "15:00")).status_code, 409)

    def test_can_switch_to_another_staff_member(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        response = self.reschedule(self.customer, appointment, local(self.monday, "09:00"), staff=self.other_staff)
        self.assertEqual(response.status_code, 200, response.data)
        appointment.refresh_from_db()
        self.assertEqual(appointment.staff, self.other_staff)

    def test_same_time_and_staff_is_rejected(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        self.assertEqual(self.reschedule(self.customer, appointment, local(self.monday, "09:00")).status_code, 400)

    def test_reminder_is_re_armed_for_the_new_time(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        Appointment.objects.filter(pk=appointment.pk).update(reminder_sent_at=timezone.now())
        self.reschedule(self.customer, appointment, local(self.monday, "11:00"))
        appointment.refresh_from_db()
        self.assertIsNone(appointment.reminder_sent_at)

    def test_customer_cannot_move_inside_the_cutoff_but_staff_can(self):
        appointment = self.book(self.staff, timezone.now() + timedelta(hours=1))
        self.assertEqual(self.reschedule(self.customer, appointment, local(self.monday, "11:00")).status_code, 400)
        self.assertEqual(self.reschedule(self.staff_user, appointment, local(self.monday, "11:00")).status_code, 200)

    def test_other_customers_cannot_reschedule(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        self.assertEqual(self.reschedule(self.other_customer, appointment, local(self.monday, "11:00")).status_code, 404)

    def test_unpaid_and_cancelled_bookings_cannot_be_moved(self):
        unpaid = self.book(self.staff, local(self.monday, "09:00"), status=Appointment.Status.AWAITING_PAYMENT)
        cancelled = self.book(self.other_staff, local(self.monday, "09:00"), status=Appointment.Status.CANCELLED)
        self.assertEqual(self.reschedule(self.customer, unpaid, local(self.monday, "11:00")).status_code, 400)
        self.assertEqual(self.reschedule(self.customer, cancelled, local(self.monday, "11:00")).status_code, 400)

    def test_availability_can_ignore_the_viewers_own_booking(self):
        appointment = self.book(self.staff, local(self.monday, "09:00"))
        params = {"service": self.service.id, "staff": self.staff.id, "from": self.monday.isoformat(), "exclude": appointment.id}

        def starts(client):
            return [s["start"] for s in client.get("/api/availability/", params).data["days"][0]["slots"]]

        self.assertIn(local(self.monday, "09:00"), starts(self.client_for(self.customer)))
        # Strangers can't use `exclude` to see through someone else's booking.
        self.assertNotIn(local(self.monday, "09:00"), starts(APIClient()))
        self.assertNotIn(local(self.monday, "09:00"), starts(self.client_for(self.other_customer)))
