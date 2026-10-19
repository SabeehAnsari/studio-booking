from django.test import SimpleTestCase, override_settings


class RootRedirectTests(SimpleTestCase):
    @override_settings(FRONTEND_URL="https://studio-booking-web.onrender.com")
    def test_api_root_sends_visitors_to_the_website(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "https://studio-booking-web.onrender.com")

    def test_api_routes_are_unaffected(self):
        self.assertEqual(self.client.get("/health/").json(), {"status": "ok"})
