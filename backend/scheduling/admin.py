from django.contrib import admin

from .models import Appointment, Service, StaffMember, TimeOff, WorkingHours


@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = ["name", "duration_minutes", "price", "is_active"]
    list_filter = ["is_active"]
    search_fields = ["name"]


class WorkingHoursInline(admin.TabularInline):
    model = WorkingHours
    extra = 0


class TimeOffInline(admin.TabularInline):
    model = TimeOff
    extra = 0


@admin.register(StaffMember)
class StaffMemberAdmin(admin.ModelAdmin):
    list_display = ["__str__", "title", "is_active"]
    list_filter = ["is_active", "services"]
    filter_horizontal = ["services"]
    inlines = [WorkingHoursInline, TimeOffInline]


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ["start", "service", "staff", "customer", "status", "price"]
    list_filter = ["status", "staff", "service"]
    search_fields = ["customer__email", "customer__first_name", "customer__last_name"]
    date_hierarchy = "start"
    raw_id_fields = ["customer"]
