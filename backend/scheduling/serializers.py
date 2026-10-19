from django.db import IntegrityError, transaction
from rest_framework import serializers
from rest_framework.exceptions import APIException

from accounts.serializers import UserSerializer

from .availability import is_slot_available, next_available_slot
from .models import Appointment, Service, StaffMember, WorkingHours


class SlotUnavailable(APIException):
    status_code = 409
    default_code = "slot_unavailable"


class ServiceSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Service
        fields = ["id", "name", "category", "category_label", "description", "duration_minutes", "price", "is_active"]


class ServiceMenuSerializer(ServiceSerializer):
    """Public service listing, with the soonest bookable slot. Not for nesting: it runs an availability search."""

    next_available = serializers.SerializerMethodField()

    class Meta(ServiceSerializer.Meta):
        fields = [*ServiceSerializer.Meta.fields, "next_available"]

    def get_next_available(self, service):
        slot = next_available_slot(service)
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

    class Meta:
        model = Appointment
        fields = [
            "id", "service", "staff", "customer", "service_id", "staff_id",
            "start", "end", "status", "price", "notes", "cancelled_at", "created_at",
        ]
        read_only_fields = ["end", "status", "price", "cancelled_at", "created_at"]

    def validate(self, attrs):
        service, staff = attrs["service"], attrs["staff"]
        if not staff.services.filter(pk=service.pk).exists():
            raise serializers.ValidationError({"staff_id": f"{staff} does not offer {service}."})
        return attrs

    def create(self, validated_data):
        service = validated_data["service"]
        # Checked here rather than in validate() so the 409 status isn't flattened into a 400.
        if not is_slot_available(service, validated_data["staff"], validated_data["start"]):
            raise SlotUnavailable("That time is no longer available. Please pick another slot.")
        validated_data["end"] = validated_data["start"] + service.duration
        validated_data["price"] = service.price
        try:
            with transaction.atomic():
                return super().create(validated_data)
        except IntegrityError as exc:
            # Lost a race with another booking for the same slot: the exclusion constraint caught it.
            if "no_overlapping_appointments_per_staff" in str(exc):
                raise SlotUnavailable("That time was just booked. Please pick another slot.") from exc
            raise
