from datetime import timedelta

from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeBoundary, RangeOperators
from django.db import models
from django.db.models import F, Func, Q


class TsTzRange(Func):
    function = "TSTZRANGE"
    output_field = DateTimeRangeField()


class Service(models.Model):
    class Category(models.TextChoices):
        # Declaration order is the display order on the service menu.
        MASSAGE = "massage", "Massage"
        SKIN = "skin", "Skin & Facials"
        HAIR = "hair", "Hair"
        CONSULTATION = "consultation", "Consultations"
        OTHER = "other", "Other"

    name = models.CharField(max_length=120)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    description = models.TextField(blank=True)
    duration_minutes = models.PositiveIntegerField()
    price = models.DecimalField(max_digits=8, decimal_places=2)
    # Paid online at booking time to secure the slot; the rest is paid at the studio. 0 = no deposit.
    deposit = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.CheckConstraint(condition=Q(duration_minutes__gt=0), name="service_duration_positive"),
            models.CheckConstraint(condition=Q(price__gte=0), name="service_price_non_negative"),
            models.CheckConstraint(
                condition=Q(deposit__gte=0) & Q(deposit__lte=F("price")), name="service_deposit_within_price"
            ),
        ]

    @property
    def duration(self) -> timedelta:
        return timedelta(minutes=self.duration_minutes)

    def __str__(self) -> str:
        return self.name


class StaffMember(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_profile")
    title = models.CharField(max_length=120, blank=True)
    bio = models.TextField(blank=True)
    services = models.ManyToManyField(Service, related_name="staff", blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["user__first_name", "user__last_name"]

    def __str__(self) -> str:
        return str(self.user)


class WorkingHours(models.Model):
    """A weekly recurring shift, in the business timezone. A staff member can have several per day."""

    class Weekday(models.IntegerChoices):
        MONDAY = 0
        TUESDAY = 1
        WEDNESDAY = 2
        THURSDAY = 3
        FRIDAY = 4
        SATURDAY = 5
        SUNDAY = 6

    staff = models.ForeignKey(StaffMember, on_delete=models.CASCADE, related_name="working_hours")
    weekday = models.IntegerField(choices=Weekday.choices)
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        ordering = ["staff", "weekday", "start_time"]
        verbose_name_plural = "working hours"
        constraints = [
            models.CheckConstraint(condition=Q(end_time__gt=F("start_time")), name="working_hours_end_after_start"),
        ]

    def __str__(self) -> str:
        return f"{self.staff} {self.get_weekday_display()} {self.start_time:%H:%M}-{self.end_time:%H:%M}"


class TimeOff(models.Model):
    staff = models.ForeignKey(StaffMember, on_delete=models.CASCADE, related_name="time_off")
    start = models.DateTimeField()
    end = models.DateTimeField()
    reason = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["start"]
        verbose_name_plural = "time off"
        constraints = [
            models.CheckConstraint(condition=Q(end__gt=F("start")), name="time_off_end_after_start"),
        ]

    def __str__(self) -> str:
        return f"{self.staff} off {self.start:%Y-%m-%d %H:%M} → {self.end:%Y-%m-%d %H:%M}"


class AppointmentQuerySet(models.QuerySet):
    def active(self):
        return self.filter(status__in=Appointment.ACTIVE_STATUSES)

    def overlapping(self, start, end):
        return self.filter(start__lt=end, end__gt=start)


class Appointment(models.Model):
    class Status(models.TextChoices):
        AWAITING_PAYMENT = "awaiting_payment", "Awaiting payment"
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        NO_SHOW = "no_show", "No-show"
        # A payment hold that ran out before the deposit was paid. Not a real booking.
        EXPIRED = "expired", "Payment not completed"

    # Statuses that occupy the staff member's calendar.
    ACTIVE_STATUSES = [Status.AWAITING_PAYMENT, Status.PENDING, Status.CONFIRMED]

    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="appointments")
    staff = models.ForeignKey(StaffMember, on_delete=models.PROTECT, related_name="appointments")
    service = models.ForeignKey(Service, on_delete=models.PROTECT, related_name="appointments")
    start = models.DateTimeField(db_index=True)
    end = models.DateTimeField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED, db_index=True)
    # Snapshot of the service price at booking time, so later price changes don't rewrite history.
    price = models.DecimalField(max_digits=8, decimal_places=2)
    notes = models.TextField(blank=True)
    # While awaiting payment, the slot is held until this moment, then released.
    hold_expires_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = AppointmentQuerySet.as_manager()

    class Meta:
        ordering = ["start"]
        constraints = [
            models.CheckConstraint(condition=Q(end__gt=F("start")), name="appointment_end_after_start"),
            # The database itself guarantees a staff member can never be double-booked,
            # even if two requests race past the application-level availability check.
            ExclusionConstraint(
                name="no_overlapping_appointments_per_staff",
                expressions=[
                    (TsTzRange("start", "end", RangeBoundary()), RangeOperators.OVERLAPS),
                    ("staff", RangeOperators.EQUAL),
                ],
                condition=Q(status__in=["awaiting_payment", "pending", "confirmed"]),
                violation_error_message="This staff member already has an appointment at that time.",
            ),
        ]

    @property
    def is_active(self) -> bool:
        return self.status in self.ACTIVE_STATUSES

    def __str__(self) -> str:
        return f"{self.service} with {self.staff} at {self.start:%Y-%m-%d %H:%M}"
