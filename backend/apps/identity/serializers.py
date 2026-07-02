from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Account, Role


class AccountSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = ["id", "username", "role", "email", "verified", "last_login", "permissions"]
        read_only_fields = fields

    def get_permissions(self, account) -> list[str]:
        """Module permissions driving the UI; enforcement is server-side."""
        if account.role == Role.ADMIN:
            from apps.core.permissions import permission_codes

            return permission_codes()
        if account.role == Role.STAFF:
            profile = getattr(account, "staff_profile", None)
            return list(profile.permissions or []) if profile else []
        return []


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=25)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    role = serializers.ChoiceField(choices=Role.choices)

    def validate(self, attrs):
        account = authenticate(
            request=self.context.get("request"),
            username=attrs["username"],
            password=attrs["password"],
            role=attrs["role"],
        )
        if account is None:
            raise serializers.ValidationError("Invalid credentials.", code="authentication")
        if not account.verified:
            raise serializers.ValidationError("Account is not verified.", code="unverified")
        attrs["account"] = account
        return attrs

    def to_representation(self, instance):
        account = self.validated_data["account"]
        refresh = RefreshToken.for_user(account)
        refresh["role"] = account.role
        return {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "account": AccountSerializer(account).data,
        }
