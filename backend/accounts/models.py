from django.contrib.auth.models import AbstractUser
from django.db import models

# Seeded demo accounts use this email domain; it's how they're told apart from real sign-ups.
DEMO_EMAIL_DOMAIN = "demo.example.com"


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        STAFF = "staff", "Staff"
        CUSTOMER = "customer", "Customer"

    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.CUSTOMER)
    phone = models.CharField(max_length=30, blank=True)

    @property
    def is_business_admin(self) -> bool:
        return self.role == self.Role.ADMIN or self.is_superuser

    @property
    def is_staff_member(self) -> bool:
        return self.role == self.Role.STAFF

    @property
    def is_demo(self) -> bool:
        return self.email.lower().endswith(f"@{DEMO_EMAIL_DOMAIN}")

    def __str__(self) -> str:
        return self.get_full_name() or self.username
