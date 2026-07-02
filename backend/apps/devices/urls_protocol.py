"""Device-facing endpoints (no session auth — the hardware protocol)."""

from django.urls import path

from .views_protocol import cdata, devicecmd, getrequest, ping, registry_view

urlpatterns = [
    path("registry", registry_view, name="iclock-registry"),
    path("getrequest", getrequest, name="iclock-getrequest"),
    path("devicecmd", devicecmd, name="iclock-devicecmd"),
    path("ping", ping, name="iclock-ping"),
    path("cdata", cdata, name="iclock-cdata"),
]
