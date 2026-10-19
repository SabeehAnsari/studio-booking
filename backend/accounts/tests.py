from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

User = get_user_model()


class AuthTests(TestCase):
    def test_register_then_login_with_email(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {"email": "New@Example.com", "password": "a-strong-pass-123", "first_name": "New", "last_name": "User"},
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["user"]["role"], "customer")

        response = client.post("/api/auth/login/", {"username": "new@example.com", "password": "a-strong-pass-123"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)

    def test_register_rejects_duplicate_email(self):
        User.objects.create_user("taken@example.com", "taken@example.com", "x")
        response = APIClient().post(
            "/api/auth/register/",
            {"email": "taken@example.com", "password": "a-strong-pass-123", "first_name": "A", "last_name": "B"},
        )
        self.assertEqual(response.status_code, 400)

    def test_real_signups_are_not_flagged_as_demo(self):
        response = APIClient().post(
            "/api/auth/register/",
            {"email": "john@example.com", "password": "a-strong-pass-123", "first_name": "John", "last_name": "Doe"},
        )
        self.assertFalse(response.data["user"]["is_demo"])

    def test_cannot_register_with_demo_domain(self):
        response = APIClient().post(
            "/api/auth/register/",
            {"email": "x@demo.example.com", "password": "a-strong-pass-123", "first_name": "X", "last_name": "Y"},
        )
        self.assertEqual(response.status_code, 400)

    def test_users_cannot_change_their_own_role(self):
        user = User.objects.create_user("c@example.com", "c@example.com", "x")
        client = APIClient()
        client.force_authenticate(user)
        client.patch("/api/auth/me/", {"role": "admin"})
        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.CUSTOMER)

    @override_settings(DEMO_MODE=False)
    def test_demo_login_disabled_outside_demo_mode(self):
        response = APIClient().post("/api/auth/demo-login/", {"role": "admin"})
        self.assertEqual(response.status_code, 404)

    @override_settings(DEMO_MODE=True)
    def test_demo_login_returns_tokens(self):
        User.objects.create_user("demo-staff", "demo-staff@demo.example.com", None, role=User.Role.STAFF)
        response = APIClient().post("/api/auth/demo-login/", {"role": "staff"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["role"], "staff")
        self.assertTrue(response.data["user"]["is_demo"])
