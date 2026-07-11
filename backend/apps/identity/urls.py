from django.urls import path
from rest_framework_simplejwt.views import TokenBlacklistView

from .views import (
    ChangePasswordView,
    HardenedTokenRefreshView,
    LoginView,
    MeView,
    PermissionCatalogView,
    RefreshThrottle,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("refresh/", HardenedTokenRefreshView.as_view(), name="token-refresh"),
    path(
        "logout/",
        TokenBlacklistView.as_view(throttle_classes=[RefreshThrottle]),
        name="logout",
    ),
    path("me/", MeView.as_view(), name="me"),
    path("permission-catalog/", PermissionCatalogView.as_view(), name="permission-catalog"),
]
