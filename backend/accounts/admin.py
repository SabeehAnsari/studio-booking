from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["username", "email", "first_name", "last_name", "role", "is_active"]
    list_filter = ["role", "is_active", "is_superuser"]
    fieldsets = BaseUserAdmin.fieldsets + (("Booking", {"fields": ("role", "phone")}),)
    add_fieldsets = BaseUserAdmin.add_fieldsets + (("Booking", {"fields": ("email", "role", "phone")}),)
