from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .staff_views import MyStaffProfileView, TimeOffDetailView, TimeOffListView, WorkingHoursView
from .views import AppointmentViewSet, AvailabilityView, DashboardView, ServiceViewSet, StaffViewSet, config_view

router = DefaultRouter()
router.register("services", ServiceViewSet, basename="service")
router.register("staff", StaffViewSet, basename="staff")
router.register("appointments", AppointmentViewSet, basename="appointment")

urlpatterns = [
    path("config/", config_view, name="config"),
    path("availability/", AvailabilityView.as_view(), name="availability"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    # Staff self-service. Listed before the router so "staff/me/" isn't read as a staff ID.
    path("staff/me/", MyStaffProfileView.as_view(), name="staff-me"),
    path("staff/<int:staff_id>/hours/", WorkingHoursView.as_view(), name="staff-hours"),
    path("staff/<int:staff_id>/time-off/", TimeOffListView.as_view(), name="staff-time-off"),
    path("staff/<int:staff_id>/time-off/<int:time_off_id>/", TimeOffDetailView.as_view(), name="staff-time-off-detail"),
    path("", include(router.urls)),
]
