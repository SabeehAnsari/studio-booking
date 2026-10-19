from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import DEMO_EMAIL_DOMAIN

User = get_user_model()


def tokens_for(user) -> dict:
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": UserSerializer(user).data}


class LoginSerializer(TokenObtainPairSerializer):
    """Accepts the email in the username field and returns the user alongside the tokens."""

    def validate(self, attrs):
        attrs[self.username_field] = attrs.get(self.username_field, "").lower()
        super().validate(attrs)
        return tokens_for(self.user)


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    is_demo = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "full_name", "phone", "role", "is_demo"]
        read_only_fields = ["id", "username", "role"]


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["email", "password", "first_name", "last_name", "phone"]
        extra_kwargs = {"first_name": {"required": True}, "last_name": {"required": True}}

    def validate_email(self, value: str) -> str:
        value = value.lower()
        if value.endswith(f"@{DEMO_EMAIL_DOMAIN}"):
            # Otherwise the account would be treated as demo data and wiped by the next reseed.
            raise serializers.ValidationError("Please use a different email address.")
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        validate_password(attrs["password"], User(email=attrs["email"], first_name=attrs.get("first_name", "")))
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        # Email doubles as the username so customers log in with one identifier.
        user = User(username=validated_data["email"], role=User.Role.CUSTOMER, **validated_data)
        user.set_password(password)
        user.save()
        return user
