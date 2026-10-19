from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AppointmentViewSet, AvailabilityView, DashboardView, ServiceViewSet, StaffViewSet, config_view

router = DefaultRouter()
router.register("services", ServiceViewSet, basename="service")
router.register("staff", StaffViewSet, basename="staff")
router.register("appointments", AppointmentViewSet, basename="appointment")

urlpatterns = [
    path("config/", config_view, name="config"),
    path("availability/", AvailabilityView.as_view(), name="availability"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("", include(router.urls)),
]
