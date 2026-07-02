from django.urls import path
from rest_framework_simplejwt.views import TokenBlacklistView, TokenRefreshView

from .views import LoginView, MeView

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("logout/", TokenBlacklistView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
]
