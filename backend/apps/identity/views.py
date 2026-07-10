from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.generics import GenericAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.permissions import PERMISSION_MODULES

from .serializers import AccountSerializer, ChangePasswordSerializer, LoginSerializer


class LoginThrottle(AnonRateThrottle):
    """Strict cap on credential attempts (login abuse — DOCUMENTATION.md §17.2)."""

    scope = "login"
    rate = "10/min"


class LoginView(GenericAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LoginThrottle]
    serializer_class = LoginSerializer

    @extend_schema(
        summary="Role-scoped login",
        description=(
            "Authenticates (role, username, password); returns a short-lived "
            "access token, a rotating refresh token, and the account."
        ),
    )
    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ChangePasswordThrottle(UserRateThrottle):
    scope = "change-password"
    rate = "5/min"


class ChangePasswordView(GenericAPIView):
    """Self-service password change for any authenticated principal.

    Every outstanding refresh token is blacklisted — a password change must
    end every other session (stolen-credential recovery). A fresh token pair
    is returned so the caller's own session survives.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ChangePasswordThrottle]
    serializer_class = ChangePasswordSerializer

    @extend_schema(summary="Change own password")
    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = request.user
        with transaction.atomic():
            account.set_password(serializer.validated_data["new_password"])
            account.password_change_required = False
            account.save(update_fields=["password", "password_change_required", "updated_at"])
            for token in OutstandingToken.objects.filter(user=account):
                BlacklistedToken.objects.get_or_create(token=token)
        refresh = RefreshToken.for_user(account)
        refresh["role"] = account.role
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "account": AccountSerializer(account).data,
            },
            status=status.HTTP_200_OK,
        )


class PermissionCatalogView(APIView):
    """Grantable module permissions — renders the admin's permission UI."""

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="Permission catalog")
    def get(self, request):
        return Response({
            "modules": [
                {
                    "code": code,
                    "label": label,
                    "permissions": [f"{code}.view", f"{code}.manage"],
                }
                for code, label in PERMISSION_MODULES.items()
            ]
        })


class MeView(RetrieveAPIView):
    serializer_class = AccountSerializer

    @extend_schema(summary="Current account")
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_object(self):
        return self.request.user
