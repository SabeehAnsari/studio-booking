from datetime import time, timedelta
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from .availability import bookable_staff, business_tz, compute_slots, next_available_slots
from .models import Service, TimeOff, WorkingHours
from .tests import BookingTestCase, local


class ServiceListPerformanceTests(BookingTestCase):
    """The service menu is the first request every visitor makes; keep it cheap."""

    def add_services(self, count):
        for i in range(count):
            service = Service.objects.create(name=f"Extra {i}", duration_minutes=30, price=Decimal("40"))
            self.staff.services.add(service)

    def test_query_count_does_not_grow_with_the_number_of_services(self):
        def queries():
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(APIClient().get("/api/services/").status_code, 200)
            return len(captured.captured_queries)

        few = queries()
        self.add_services(10)
        self.assertEqual(queries(), few)
        self.assertLessEqual(few, 8)

    def test_batched_search_matches_searching_each_service_separately(self):
        # Varied data: extra hours, a booking, time off and services with different staff/durations.
        WorkingHours.objects.create(staff=self.staff, weekday=2, start_time=time(13), end_time=time(17))
        self.book(self.staff, local(self.monday, "09:00"))
        TimeOff.objects.create(staff=self.other_staff, start=local(self.monday, "00:00"), end=local(self.monday, "10:30"))
        self.add_services(3)
        services = list(Service.objects.all())

        def searched_separately(service):
            today = timezone.now().astimezone(business_tz()).date()
            by_day = compute_slots(service, bookable_staff(service), today, today + timedelta(days=13))
            return next((slots[0] for _, slots in sorted(by_day.items()) if slots), None)

        batched = next_available_slots(services, search_days=14)
        for service in services:
            self.assertEqual(batched[service.id], searched_separately(service), service.name)
