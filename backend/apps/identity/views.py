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
from rest_framework_simplejwt.views import TokenRefreshView

from apps.audit.models import AuditEvent
from apps.audit.services import record as audit
from apps.core.permissions import PERMISSION_MODULES
from apps.tenants.services import resolve_school_for

from . import lockout
from .serializers import (
    AccountSerializer,
    ChangePasswordSerializer,
    HardenedTokenRefreshSerializer,
    LoginSerializer,
)


class LoginThrottle(AnonRateThrottle):
    """Cap on credential attempts (login abuse — DOCUMENTATION.md §17.2).
    Per-IP: generous enough for a school NAT (many families share one
    public IP) while still stopping brute force. Distributed guessing is
    handled separately by the per-account lockout (identity.lockout)."""

    scope = "login"
    rate = "30/min"


class RefreshThrottle(AnonRateThrottle):
    """Refresh carries a signed token, not a guessable credential — the
    throttle only bounds DoS. Every app open behind a school NAT hits this
    endpoint once, so the per-IP cap must be an order of magnitude above
    the login cap or session restores 429 en masse."""

    scope = "token-refresh"
    rate = "600/min"


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
        # Failure paths RETURN responses instead of raising: DRF's exception
        # handler marks the transaction rollback-only, which would erase the
        # audit rows written below (see apps.audit.services).
        data = request.data if isinstance(request.data, dict) else {}
        role = str(data.get("role", ""))
        username = str(data.get("username", ""))
        if username:
            wait = lockout.seconds_remaining(role, username)
            if wait:
                return Response(
                    {"detail": f"Too many failed attempts. Try again in {-(-wait // 60)} minutes."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            if username and lockout.register_failure(role, username):
                audit(
                    action=AuditEvent.Action.LOGIN,
                    object_table="identity.Account",
                    object_id=f"{role}:{username}"[:40],
                    changes={"event": "lockout", "failures": lockout.LOCKOUT_THRESHOLD},
                    request=request,
                )
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        account = serializer.validated_data["account"]
        lockout.reset(role, username)
        audit(
            action=AuditEvent.Action.LOGIN,
            object_table="identity.Account",
            object_id=account.id,
            actor=account,
            school=resolve_school_for(account),
            changes={"event": "success", "role": account.role},
            request=request,
        )
        return Response(serializer.data, status=status.HTTP_200_OK)


class HardenedTokenRefreshView(TokenRefreshView):
    """Refresh that re-checks the ACCOUNT, not just the token signature —
    a deactivated principal must lose access at the next refresh, not when
    the 7-day token finally expires."""

    serializer_class = HardenedTokenRefreshSerializer
    throttle_classes = [RefreshThrottle]

    def post(self, request, *args, **kwargs):
        from rest_framework.exceptions import AuthenticationFailed

        # The serializer blacklists the token when its account is dead. That
        # write must COMMIT, so the 401 is returned rather than raised —
        # DRF's handler would mark the transaction rollback-only and undo
        # the blacklisting (see apps.audit.services for the same trap).
        try:
            return super().post(request, *args, **kwargs)
        except AuthenticationFailed as exc:
            if exc.get_codes() == "account_inactive":
                return Response({"detail": str(exc.detail)}, status=status.HTTP_401_UNAUTHORIZED)
            raise


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
            audit(
                action=AuditEvent.Action.UPDATE,
                object_table="identity.Account",
                object_id=account.id,
                actor=account,
                school=resolve_school_for(account),
                changes={"event": "password_change", "sessions_revoked": True},
                request=request,
            )
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
