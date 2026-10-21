"""Staff self-service: weekly working hours and time off.

Staff manage their own; business admins can manage anyone's. Changes never cancel bookings
silently: time off that clashes with a booking is refused (with the clashes listed), and new
hours report any upcoming bookings they leave outside, which stay booked.
"""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .availability import business_tz
from .models import Appointment, StaffMember, TimeOff, WorkingHours
from .serializers import (
    AppointmentBriefSerializer,
    StaffMemberSerializer,
    TimeOffSerializer,
    WeeklyHoursSerializer,
    WorkingHoursSerializer,
)


# Public-demo guardrails: anyone can log in as the demo staff or owner, so stop one visitor
# leaving the demo unbookable for the next until the nightly reset.
DEMO_MAX_TIME_OFF = timedelta(days=7)


def _demo_guardrails_apply(request) -> bool:
    return settings.DEMO_MODE and request.user.is_demo


def editable_staff(request, staff_id) -> StaffMember:
    staff = get_object_or_404(StaffMember.objects.select_related("user"), pk=staff_id)
    if not (request.user.is_business_admin or staff.user_id == request.user.id):
        raise PermissionDenied("You can only change your own schedule.")
    return staff


class MyStaffProfileView(APIView):
    """GET /api/staff/me/: the logged-in staff member's profile (for the self-service page)."""

    def get(self, request):
        staff = StaffMember.objects.filter(user=request.user).prefetch_related("services", "working_hours").first()
        if staff is None:
            raise PermissionDenied("This account isn't a staff member.")
        return Response(StaffMemberSerializer(staff).data)


class WorkingHoursView(APIView):
    """GET/PUT /api/staff/<id>/hours/: the whole week, replaced in one request."""

    def get(self, request, staff_id):
        staff = editable_staff(request, staff_id)
        return Response({"hours": WorkingHoursSerializer(staff.working_hours.all(), many=True).data})

    def put(self, request, staff_id):
        staff = editable_staff(request, staff_id)
        serializer = WeeklyHoursSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if _demo_guardrails_apply(request) and not serializer.validated_data["hours"]:
            raise ValidationError(
                {"detail": "In the public demo, keep at least one shift so other visitors can still book. "
                           "The demo resets every night."}
            )
        with transaction.atomic():
            staff.working_hours.all().delete()
            WorkingHours.objects.bulk_create(
                WorkingHours(staff=staff, **shift) for shift in serializer.validated_data["hours"]
            )
        shifts = list(staff.working_hours.all())
        return Response(
            {
                "hours": WorkingHoursSerializer(shifts, many=True).data,
                "outside_hours": AppointmentBriefSerializer(_outside_hours(staff, shifts), many=True).data,
            }
        )


def _outside_hours(staff: StaffMember, shifts: list[WorkingHours]) -> list[Appointment]:
    """Upcoming bookings that no longer fit inside any shift."""
    tz = business_tz()

    def fits(appointment: Appointment) -> bool:
        start = appointment.start.astimezone(tz)
        end = appointment.end.astimezone(tz)
        return any(
            shift.weekday == start.weekday()
            and start.date() == end.date()
            and shift.start_time <= start.time()
            and end.time() <= shift.end_time
            for shift in shifts
        )

    upcoming = (
        Appointment.objects.active()
        .filter(staff=staff, start__gt=timezone.now())
        .select_related("service", "customer")
        .order_by("start")
    )
    return [a for a in upcoming if not fits(a)]


class TimeOffListView(APIView):
    """GET/POST /api/staff/<id>/time-off/: current and future time off."""

    def get(self, request, staff_id):
        staff = editable_staff(request, staff_id)
        time_off = staff.time_off.filter(end__gt=timezone.now()).order_by("start")
        return Response(TimeOffSerializer(time_off, many=True).data)

    def post(self, request, staff_id):
        staff = editable_staff(request, staff_id)
        serializer = TimeOffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        start, end = serializer.validated_data["start"], serializer.validated_data["end"]
        if _demo_guardrails_apply(request) and end - start > DEMO_MAX_TIME_OFF:
            raise ValidationError(
                {"detail": "In the public demo, time off is limited to 7 days at a time. The demo resets every night."}
            )
        with transaction.atomic():
            # Lock this staff member's bookings so none can slip in between the check and the insert.
            clashes = list(
                Appointment.objects.active()
                .filter(staff=staff)
                .overlapping(start, end)
                .select_related("service", "customer")
                .select_for_update(of=("self",))
                .order_by("start")
            )
            if clashes:
                return Response(
                    {
                        "detail": (
                            "1 booking falls in that time. Reschedule or cancel it first."
                            if len(clashes) == 1
                            else f"{len(clashes)} bookings fall in that time. Reschedule or cancel them first."
                        ),
                        "conflicts": AppointmentBriefSerializer(clashes, many=True).data,
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            time_off = serializer.save(staff=staff)
        return Response(TimeOffSerializer(time_off).data, status=status.HTTP_201_CREATED)


class TimeOffDetailView(APIView):
    """DELETE /api/staff/<id>/time-off/<time_off_id>/"""

    def delete(self, request, staff_id, time_off_id):
        staff = editable_staff(request, staff_id)
        get_object_or_404(TimeOff, pk=time_off_id, staff=staff).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
