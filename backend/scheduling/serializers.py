from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException

from accounts.serializers import UserSerializer
from payments.services import deposit_required, hold_duration, release_expired_holds

from .availability import business_tz, is_slot_available, next_available_slot
from .models import Appointment, Service, StaffMember, TimeOff, WorkingHours


class SlotUnavailable(APIException):
    status_code = 409
    default_code = "slot_unavailable"


class ServiceSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Service
        fields = [
            "id", "name", "category", "category_label", "description", "duration_minutes", "price", "deposit",
            "is_active",
        ]


class ServiceMenuSerializer(ServiceSerializer):
    """Public service listing, with the soonest bookable slot. Not for nesting: it runs an availability search."""

    next_available = serializers.SerializerMethodField()

    class Meta(ServiceSerializer.Meta):
        fields = [*ServiceSerializer.Meta.fields, "next_available"]

    def get_next_available(self, service):
        # The list view precomputes every service's opening in one pass (see ServiceViewSet.list).
        precomputed = self.context.get("next_available")
        slot = precomputed[service.id] if precomputed is not None else next_available_slot(service)
        return {"start": slot.start, "staff_id": slot.staff_id} if slot else None


class WorkingHoursSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkingHours
        fields = ["weekday", "start_time", "end_time"]


class StaffMemberSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="user.get_full_name", read_only=True)
    service_ids = serializers.PrimaryKeyRelatedField(source="services", many=True, read_only=True)
    working_hours = WorkingHoursSerializer(many=True, read_only=True)

    class Meta:
        model = StaffMember
        fields = ["id", "name", "title", "bio", "service_ids", "working_hours"]


class AppointmentSerializer(serializers.ModelSerializer):
    service = ServiceSerializer(read_only=True)
    staff = StaffMemberSerializer(read_only=True)
    customer = UserSerializer(read_only=True)

    service_id = serializers.PrimaryKeyRelatedField(
        source="service", queryset=Service.objects.filter(is_active=True), write_only=True
    )
    staff_id = serializers.PrimaryKeyRelatedField(
        source="staff", queryset=StaffMember.objects.filter(is_active=True), write_only=True
    )
    payment = serializers.SerializerMethodField()

    class Meta:
        model = Appointment
        fields = [
            "id", "service", "staff", "customer", "service_id", "staff_id",
            "start", "end", "status", "price", "notes", "hold_expires_at", "payment", "reminder_sent_at", "cancelled_at",
            "created_at",
        ]
        read_only_fields = ["end", "status", "price", "hold_expires_at", "reminder_sent_at", "cancelled_at", "created_at"]

    def get_payment(self, appointment):
        """The most recent deposit payment, if any. Uses the prefetched `payments` when available."""
        latest = next(iter(appointment.payments.all()), None)
        if latest is None:
            return None
        return {"status": latest.status, "amount": latest.amount, "currency": latest.currency}

    def validate(self, attrs):
        service, staff = attrs["service"], attrs["staff"]
        if not staff.services.filter(pk=service.pk).exists():
            raise serializers.ValidationError({"staff_id": f"{staff} does not offer {service}."})
        return attrs

    def create(self, validated_data):
        service = validated_data["service"]
        release_expired_holds()
        # Checked here rather than in validate() so the 409 status isn't flattened into a 400.
        if not is_slot_available(service, validated_data["staff"], validated_data["start"]):
            raise SlotUnavailable("That time is no longer available. Please pick another slot.")
        validated_data["end"] = validated_data["start"] + service.duration
        validated_data["price"] = service.price
        if deposit_required(service):
            # Hold the slot while the customer pays; confirmed once Stripe reports the payment.
            validated_data["status"] = Appointment.Status.AWAITING_PAYMENT
            validated_data["hold_expires_at"] = timezone.now() + hold_duration()
        try:
            with transaction.atomic():
                return super().create(validated_data)
        except IntegrityError as exc:
            # Lost a race with another booking for the same slot: the exclusion constraint caught it.
            if "no_overlapping_appointments_per_staff" in str(exc):
                raise SlotUnavailable("That time was just booked. Please pick another slot.") from exc
            raise


class RescheduleSerializer(serializers.Serializer):
    """Move an existing booking to a new time and, optionally, a different staff member."""

    start = serializers.DateTimeField()
    staff_id = serializers.PrimaryKeyRelatedField(
        source="staff", queryset=StaffMember.objects.filter(is_active=True), required=False
    )

    def validate(self, attrs):
        appointment = self.context["appointment"]
        staff = attrs.get("staff", appointment.staff)
        if not staff.services.filter(pk=appointment.service_id).exists():
            raise serializers.ValidationError({"staff_id": f"{staff} does not offer {appointment.service}."})
        if attrs["start"] == appointment.start and staff == appointment.staff:
            raise serializers.ValidationError({"start": "That's the time it's already booked for."})
        attrs["staff"] = staff
        return attrs

    def save(self):
        appointment = self.context["appointment"]
        staff, start = self.validated_data["staff"], self.validated_data["start"]
        if not is_slot_available(appointment.service, staff, start, exclude_appointment_id=appointment.pk):
            raise SlotUnavailable("That time is no longer available. Please pick another slot.")
        appointment.staff = staff
        appointment.start = start
        appointment.end = start + appointment.service.duration
        # The reminder was for the old time; the worker sends a fresh one for the new time.
        appointment.reminder_sent_at = None
        try:
            with transaction.atomic():
                appointment.save(update_fields=["staff", "start", "end", "reminder_sent_at", "updated_at"])
        except IntegrityError as exc:
            if "no_overlapping_appointments_per_staff" in str(exc):
                raise SlotUnavailable("That time was just booked. Please pick another slot.") from exc
            raise
        return appointment


class WeeklyHoursSerializer(serializers.Serializer):
    """A staff member's whole week, replaced in one go: [{weekday, start_time, end_time}, ...]."""

    hours = WorkingHoursSerializer(many=True)

    def validate_hours(self, shifts):
        by_day: dict[int, list] = {}
        for shift in shifts:
            if shift["end_time"] <= shift["start_time"]:
                day = WorkingHours.Weekday(shift["weekday"]).label
                raise serializers.ValidationError(f"{day}: a shift must end after it starts.")
            by_day.setdefault(shift["weekday"], []).append(shift)
        for weekday, day_shifts in by_day.items():
            day_shifts.sort(key=lambda s: s["start_time"])
            for earlier, later in zip(day_shifts, day_shifts[1:]):
                if later["start_time"] < earlier["end_time"]:
                    day = WorkingHours.Weekday(weekday).label
                    raise serializers.ValidationError(f"{day}: shifts overlap.")
        return shifts


class TimeOffSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimeOff
        fields = ["id", "start", "end", "reason"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Staff type times in studio time ("2026-10-30T09:00"), not UTC.
        # (DRF reads the field's `timezone` attribute; `default_timezone` is a method.)
        for name in ("start", "end"):
            self.fields[name].timezone = business_tz()

    def validate(self, attrs):
        if attrs["end"] <= attrs["start"]:
            raise serializers.ValidationError({"end": "Time off must end after it starts."})
        if attrs["end"] <= timezone.now():
            raise serializers.ValidationError({"end": "That time is already in the past."})
        return attrs


class AppointmentBriefSerializer(serializers.ModelSerializer):
    """Just enough to list bookings affected by a schedule change."""

    service = serializers.CharField(source="service.name")
    customer = serializers.CharField(source="customer.get_full_name")

    class Meta:
        model = Appointment
        fields = ["id", "start", "end", "service", "customer"]

