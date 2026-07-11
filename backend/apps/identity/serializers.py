from django.contrib.auth import authenticate, password_validation
from rest_framework import serializers
# DRF's exception, NOT simplejwt's: the simplejwt variant wraps detail in a
# dict, which breaks the view's get_codes() dispatch for this code.
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Account, Role

# Argon2 hashes whatever it is given; an unbounded field lets a client post
# megabytes per guess and buy CPU for free. 128 chars is far beyond any
# passphrase and keeps hashing cost flat.
PASSWORD_MAX_LENGTH = 128


class AccountSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()
    school = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            "id", "username", "role", "email", "verified", "last_login",
            "password_change_required", "permissions", "school",
        ]
        read_only_fields = fields

    def get_school(self, account) -> dict | None:
        """Letterhead facts for the account's tenant (receipt/report headers).
        PAN goes on every IRD-relevant printout, so it ships with the session."""
        from apps.tenants.services import resolve_school_for

        school = resolve_school_for(account)
        if school is None:
            return None
        return {
            "id": str(school.id),
            "name": school.name,
            "address": school.address,
            "contact": school.contact,
            "pan_no": school.pan_no,
        }

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
    password = serializers.CharField(
        write_only=True, trim_whitespace=False, max_length=PASSWORD_MAX_LENGTH
    )
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


class HardenedTokenRefreshSerializer(TokenRefreshSerializer):
    """Refresh that re-validates the ACCOUNT behind the token.

    SimpleJWT's default refresh only checks the token's signature and
    blacklist status — an account deactivated mid-session keeps minting
    access tokens until the refresh token ages out (7 days). Here the
    account row is loaded and must still be active and verified; a token
    for a dead account is rejected AND blacklisted so it cannot retry.
    """

    def validate(self, attrs):
        # Verify + inspect BEFORE the parent rotates — otherwise a fresh
        # refresh token is already minted for the dead account by the time
        # the check runs. TokenError from a bad token propagates and the
        # view turns it into the standard 401.
        token = self.token_class(attrs["refresh"])  # signature, expiry, blacklist
        account = Account.objects.filter(
            pk=token.payload.get(jwt_settings.USER_ID_CLAIM)
        ).first()
        if account is None or not account.is_active or not account.verified:
            token.blacklist()  # the token itself is dead from here on
            raise AuthenticationFailed("Account is no longer active.", code="account_inactive")
        return super().validate(attrs)  # rotation + new pair


class ChangePasswordSerializer(serializers.Serializer):
    """Self-service password change. Requires the current password even for
    forced changes (the temp credential IS the proof of possession)."""

    current_password = serializers.CharField(
        write_only=True, trim_whitespace=False, max_length=PASSWORD_MAX_LENGTH
    )
    new_password = serializers.CharField(
        write_only=True, trim_whitespace=False, max_length=PASSWORD_MAX_LENGTH
    )

    @property
    def account(self):
        return self.context["request"].user

    def validate_current_password(self, value):
        if not self.account.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        password_validation.validate_password(value, user=self.account)
        return value

    def validate(self, attrs):
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError(
                {"new_password": "New password must differ from the current one."}
            )
        return attrs
