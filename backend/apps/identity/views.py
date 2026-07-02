from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.generics import GenericAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from .serializers import AccountSerializer, LoginSerializer


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


class MeView(RetrieveAPIView):
    serializer_class = AccountSerializer

    @extend_schema(summary="Current account")
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_object(self):
        return self.request.user
