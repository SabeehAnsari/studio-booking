from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import LoginSerializer, RegisterSerializer, UserSerializer, tokens_for

User = get_user_model()

DEMO_USERNAMES = {
    User.Role.ADMIN: "demo-admin",
    User.Role.STAFF: "demo-staff",
    User.Role.CUSTOMER: "demo-customer",
}


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(tokens_for(user), status=status.HTTP_201_CREATED)


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class DemoLoginView(APIView):
    """Logs in as a seeded demo account so visitors can explore each role without signing up."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        if not settings.DEMO_MODE:
            return Response({"detail": "Demo mode is disabled."}, status=status.HTTP_404_NOT_FOUND)
        username = DEMO_USERNAMES.get(request.data.get("role"))
        if not username:
            return Response({"detail": "Unknown demo role."}, status=status.HTTP_400_BAD_REQUEST)
        user = User.objects.filter(username=username, is_active=True).first()
        if not user:
            return Response(
                {"detail": "Demo data not seeded. Run `python manage.py seed_demo`."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(tokens_for(user))
