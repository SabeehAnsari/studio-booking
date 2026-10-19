from datetime import date, timedelta

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from payments import services as payments

from .availability import bookable_staff, business_tz, compute_slots, local_day_bounds
from .models import Appointment, Service, StaffMember
from .permissions import IsBusinessAdmin, can_manage
from .serializers import AppointmentSerializer, ServiceMenuSerializer, StaffMemberSerializer


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def config_view(request):
    return Response(
        {
            "business_name": "Studio Booking",
            "timezone": settings.BUSINESS_TIMEZONE,
            "slot_interval_minutes": settings.SLOT_INTERVAL_MINUTES,
            "min_notice_minutes": settings.MIN_BOOKING_NOTICE_MINUTES,
            "max_days_ahead": settings.MAX_BOOKING_DAYS_AHEAD,
            "cancellation_cutoff_hours": settings.CANCELLATION_CUTOFF_HOURS,
            "demo_mode": settings.DEMO_MODE,
            "payments_enabled": settings.PAYMENTS_ENABLED,
            "payment_provider": settings.PAYMENT_PROVIDER if settings.PAYMENTS_ENABLED else None,
            "payments_test_mode": settings.PAYMENT_PROVIDER == "demo" or settings.STRIPE_SECRET_KEY.startswith("sk_test_"),
            "currency": settings.PAYMENT_CURRENCY,
        }
    )


class ServiceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ServiceMenuSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = None

    def get_queryset(self):
        return Service.objects.filter(is_active=True)

    def list(self, request, *args, **kwargs):
        payments.release_expired_holds()
        # Menu order: by category (in declaration order), then by name.
        category_order = {value: index for index, value in enumerate(Service.Category.values)}
        services = sorted(self.get_queryset(), key=lambda s: (category_order[s.category], s.name))
        return Response(self.get_serializer(services, many=True).data)


class StaffViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StaffMemberSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = None

    def get_queryset(self):
        qs = (
            StaffMember.objects.filter(is_active=True)
            .select_related("user")
            .prefetch_related("services", "working_hours")
        )
        service_id = self.request.query_params.get("service")
        if service_id:
            qs = qs.filter(services__id=service_id)
        return qs


def _parse_date(value: str | None, field: str) -> date:
    try:
        return date.fromisoformat(value or "")
    except ValueError:
        raise ValidationError({field: "Use YYYY-MM-DD."})


class AvailabilityView(APIView):
    """
    GET /api/availability/?service=1&from=2026-10-20&to=2026-10-26[&staff=3]

    Returns open slots grouped by local day. Omitting `staff` means "any available staff member",
    in which case each slot lists every staff member free at that time.
    """

    permission_classes = [permissions.AllowAny]
    MAX_RANGE_DAYS = 42

    def get(self, request):
        payments.release_expired_holds()
        params = request.query_params
        try:
            service = Service.objects.get(pk=params.get("service"), is_active=True)
        except (Service.DoesNotExist, ValueError, TypeError):
            raise NotFound("Service not found.")

        first = _parse_date(params.get("from"), "from")
        last = _parse_date(params.get("to") or params.get("from"), "to")
        if (last - first).days > self.MAX_RANGE_DAYS:
            raise ValidationError({"to": f"Range is limited to {self.MAX_RANGE_DAYS} days."})

        staff_id = params.get("staff")
        staff = bookable_staff(service, int(staff_id) if staff_id else None)
        by_day = compute_slots(service, staff, first, last)

        days = []
        for day, slots in by_day.items():
            grouped: dict = {}
            for slot in slots:
                grouped.setdefault(slot.start, {"start": slot.start, "end": slot.end, "staff_ids": []})
                grouped[slot.start]["staff_ids"].append(slot.staff_id)
            days.append({"date": day, "slots": list(grouped.values())})

        return Response({"service": service.id, "timezone": settings.BUSINESS_TIMEZONE, "days": days})


class AppointmentViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    serializer_class = AppointmentSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Appointment.objects.select_related("service", "staff__user", "customer").prefetch_related(
            "staff__services", "staff__working_hours", "payments"
        )
        if user.is_business_admin:
            pass
        elif user.is_staff_member:
            qs = qs.filter(staff__user=user)
        else:
            qs = qs.filter(customer=user)

        params = self.request.query_params
        now = timezone.now()
        scope = params.get("scope")
        if scope == "upcoming":
            qs = qs.filter(end__gte=now, status__in=Appointment.ACTIVE_STATUSES)
        elif scope == "past":
            qs = qs.filter(Q(end__lt=now) | ~Q(status__in=Appointment.ACTIVE_STATUSES)).order_by("-start")
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("date"):
            day_start, day_end = local_day_bounds(_parse_date(params["date"], "date"))
            qs = qs.filter(start__gte=day_start, start__lt=day_end)
        if params.get("staff") and user.is_business_admin:
            qs = qs.filter(staff_id=params["staff"])
        return qs

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        payments.release_expired_holds()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        appointment = serializer.save(customer=request.user)
        checkout_url = None
        if appointment.status == Appointment.Status.AWAITING_PAYMENT:
            try:
                checkout_url = payments.start_checkout(appointment).checkout_url
            except payments.PaymentError as exc:
                # Don't leave a hold behind for a checkout that never opened.
                appointment.status = Appointment.Status.EXPIRED
                appointment.hold_expires_at = None
                appointment.save(update_fields=["status", "hold_expires_at", "updated_at"])
                return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        data = self.get_serializer(self.get_queryset().get(pk=appointment.pk)).data
        return Response({**data, "checkout_url": checkout_url}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """Reopen the Stripe checkout for a booking still awaiting its deposit."""
        appointment = self.get_object()
        if appointment.customer_id != request.user.id:
            raise PermissionDenied("Only the customer can pay for this booking.")
        try:
            payment = payments.resume_checkout(appointment)
        except payments.PaymentError as exc:
            raise ValidationError({"detail": str(exc)})
        return Response({"checkout_url": payment.checkout_url})

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        appointment = self.get_object()
        if not appointment.is_active:
            raise ValidationError({"detail": "Only upcoming appointments can be cancelled."})
        awaiting_payment = appointment.status == Appointment.Status.AWAITING_PAYMENT
        if not can_manage(request.user, appointment) and not awaiting_payment:
            cutoff = appointment.start - timedelta(hours=settings.CANCELLATION_CUTOFF_HOURS)
            if timezone.now() > cutoff:
                raise ValidationError(
                    {"detail": f"Appointments can't be cancelled within {settings.CANCELLATION_CUTOFF_HOURS} hours "
                               "of the start time. Please contact us directly."}
                )
        try:
            # Refund first: if Stripe fails, the booking stays as it was rather than being
            # cancelled without the customer getting their deposit back.
            refunded = payments.cancel_payments(appointment)
        except payments.PaymentError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        # Abandoning an unpaid hold isn't a real cancellation, so it doesn't count against the business.
        appointment.status = Appointment.Status.EXPIRED if awaiting_payment else Appointment.Status.CANCELLED
        appointment.hold_expires_at = None
        appointment.cancelled_at = timezone.now()
        appointment.save(update_fields=["status", "hold_expires_at", "cancelled_at", "updated_at"])
        data = self.get_serializer(self.get_queryset().get(pk=appointment.pk)).data
        return Response({**data, "refunded_amount": refunded})

    def _staff_transition(self, request, new_status, *, must_have_started: bool):
        appointment = self.get_object()
        if not can_manage(request.user, appointment):
            raise PermissionDenied("Only staff can update this appointment.")
        if appointment.status == Appointment.Status.AWAITING_PAYMENT:
            raise ValidationError({"detail": "This booking is still waiting for the customer's deposit."})
        if not appointment.is_active or appointment.status == new_status:
            raise ValidationError({"detail": f"Appointment is already {appointment.get_status_display().lower()}."})
        if must_have_started and appointment.start > timezone.now():
            raise ValidationError({"detail": "This appointment hasn't started yet."})
        appointment.status = new_status
        appointment.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(appointment).data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        return self._staff_transition(request, Appointment.Status.CONFIRMED, must_have_started=False)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return self._staff_transition(request, Appointment.Status.COMPLETED, must_have_started=True)

    @action(detail=True, methods=["post"], url_path="no-show")
    def no_show(self, request, pk=None):
        return self._staff_transition(request, Appointment.Status.NO_SHOW, must_have_started=True)


class DashboardView(APIView):
    permission_classes = [IsBusinessAdmin]

    def get(self, request):
        now = timezone.now()
        today = now.astimezone(business_tz()).date()
        today_start, today_end = local_day_bounds(today)
        month_start, _ = local_day_bounds(today.replace(day=1))
        last_30 = now - timedelta(days=30)
        horizon_end = local_day_bounds(today + timedelta(days=13))[1]

        # Unpaid holds that lapsed were never real bookings; leave them out of every metric.
        appointments = Appointment.objects.exclude(status=Appointment.Status.EXPIRED)
        active = appointments.filter(status__in=Appointment.ACTIVE_STATUSES)

        recent = appointments.filter(start__gte=last_30, start__lt=now)
        recent_total = recent.count()
        recent_lost = recent.filter(status__in=[Appointment.Status.CANCELLED, Appointment.Status.NO_SHOW]).count()

        revenue_month = (
            appointments.filter(start__gte=month_start, start__lt=now, status=Appointment.Status.COMPLETED)
            .aggregate(total=Sum("price"))["total"]
            or 0
        )
        booked_month = (
            active.filter(start__gte=now, start__lt=local_day_bounds(_month_end(today))[1])
            .aggregate(total=Sum("price"))["total"]
            or 0
        )

        tz = business_tz()
        per_day = (
            active.filter(start__gte=today_start, start__lt=horizon_end)
            .annotate(day=TruncDate("start", tzinfo=tz))
            .values("day")
            .annotate(count=Count("id"))
        )
        counts = {row["day"]: row["count"] for row in per_day}
        upcoming_by_day = [
            {"date": today + timedelta(days=i), "count": counts.get(today + timedelta(days=i), 0)} for i in range(14)
        ]

        top_services = (
            appointments.filter(start__gte=last_30)
            .exclude(status=Appointment.Status.CANCELLED)
            .values("service__name")
            .annotate(count=Count("id"))
            .order_by("-count")[:5]
        )
        staff_load = (
            active.filter(start__gte=today_start, start__lt=horizon_end)
            .values("staff__id", "staff__user__first_name", "staff__user__last_name")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        return Response(
            {
                "today_count": active.filter(start__gte=today_start, start__lt=today_end).count(),
                "upcoming_14d_count": sum(counts.values()),
                "revenue_month_to_date": revenue_month,
                "booked_revenue_rest_of_month": booked_month,
                "cancellation_rate_30d": round(recent_lost / recent_total, 3) if recent_total else 0,
                "customers_count": appointments.values("customer").distinct().count(),
                "upcoming_by_day": upcoming_by_day,
                "top_services": [{"name": s["service__name"], "count": s["count"]} for s in top_services],
                "staff_load": [
                    {
                        "id": s["staff__id"],
                        "name": f'{s["staff__user__first_name"]} {s["staff__user__last_name"]}'.strip(),
                        "count": s["count"],
                    }
                    for s in staff_load
                ],
            },
            status=status.HTTP_200_OK,
        )


def _month_end(day: date) -> date:
    next_month = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
    return next_month - timedelta(days=1)
