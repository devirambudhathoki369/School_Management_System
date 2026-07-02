"""
/iclock/* — the ZKTeco push protocol endpoints the hardware talks to.

Wire-compatible with the legacy server (same handshake, options blocks,
command framing) so devices in the field keep working unmodified — with one
hardening change: unknown serials get 403 instead of being auto-provisioned
(AT4). Optional shared-secret check via the DEVICE_PUSH_COMM_KEY setting.
"""

import hashlib

from django.conf import settings
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .services import commands, ingest, registry
from .views_protocol_builders import build_init_response, build_registered_response


def _check_push_key(request):
    expected = getattr(settings, "DEVICE_PUSH_COMM_KEY", "") or ""
    if expected and request.GET.get("pushcommkey", "") != expected:
        return HttpResponseForbidden("invalid pushcommkey")
    return None


def _touch_or_forbid(request):
    serial = request.GET.get("SN")
    if not serial:
        return None, HttpResponseBadRequest("missing SN")
    device = registry.touch(serial, request)
    if device is None:  # not pre-registered -> reject (AT4)
        return None, HttpResponseForbidden("unregistered device")
    return device, None


def _registry_code(serial: str) -> str:
    """Stable per-device token newer push firmware stores and echoes back."""
    return hashlib.md5(("zk-reg-" + (serial or "")).encode()).hexdigest()[:16]  # noqa: S324 — protocol token, not a credential


@csrf_exempt
@require_POST
def registry_view(request):
    """Newer-push registration handshake; without it the device loops
    cdata(options=all) <-> registry(404) forever and never polls."""
    if (forbidden := _check_push_key(request)) is not None:
        return forbidden
    device, error = _touch_or_forbid(request)
    if error:
        return error
    return HttpResponse(
        f"RegistryCode={_registry_code(device.serial_number)}", content_type="text/plain"
    )


@require_GET
def getrequest(request):
    """Device polling: deliver pending commands as C:<id>:<content> lines."""
    if (forbidden := _check_push_key(request)) is not None:
        return forbidden
    device, error = _touch_or_forbid(request)
    if error:
        return error
    info = request.GET.get("INFO")
    if info:
        registry.update_counters(device, info)
    pending = commands.pop_pending(device)
    if not pending:
        return HttpResponse("OK", content_type="text/plain")
    body = "\n".join(f"C:{c.cmd_id}:{c.cmd_content}" for c in pending)
    return HttpResponse(body, content_type="text/plain")


@csrf_exempt
@require_POST
def devicecmd(request):
    """Command results: lines of ID=..&Return=..&CMD=.. pairs."""
    if (forbidden := _check_push_key(request)) is not None:
        return forbidden
    device, error = _touch_or_forbid(request)
    if error:
        return error
    for raw in request.body.decode("utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line:
            continue
        params = dict(
            pair.partition("=")[::2] for pair in line.split("&") if "=" in pair
        )
        cmd_id, ret = params.get("ID"), params.get("Return")
        if cmd_id and ret is not None:
            try:
                commands.mark_done(cmd_id, int(ret), line)
            except ValueError:
                pass
    return HttpResponse("OK", content_type="text/plain")


@require_GET
def ping(request):
    serial = request.GET.get("SN")
    if serial:
        registry.touch(serial, request)
    return HttpResponse("OK", content_type="text/plain")


@csrf_exempt
def cdata(request):
    """Handshake (GET options=all) and data pushes (POST ATTLOG/OPERLOG)."""
    if (forbidden := _check_push_key(request)) is not None:
        return forbidden
    device, error = _touch_or_forbid(request)
    if error:
        return error

    if request.method == "GET":
        if request.GET.get("options") == "all":
            pushver = request.GET.get("pushver")
            device_type = request.GET.get("DeviceType")
            if pushver:
                device.push_version = pushver
            if device_type:
                device.device_type = device_type
            device.save(update_fields=["push_version", "device_type"])
            # Newer firmware advertises PushOptionsFlag=1 and expects the
            # registry-style block; legacy firmware gets "GET OPTION FROM".
            if request.GET.get("PushOptionsFlag") == "1":
                return HttpResponse(
                    build_registered_response(
                        device, _registry_code(device.serial_number)
                    ),
                    content_type="text/plain",
                )
            return HttpResponse(build_init_response(device), content_type="text/plain")
        return HttpResponse("OK", content_type="text/plain")

    if request.method == "POST":
        table = request.GET.get("table", "")
        registry.update_stamp(device, table, request.GET.get("Stamp"))
        if table == "ATTLOG":
            n = ingest.ingest_attlog(device, request.body)
            return HttpResponse(f"OK: {n}", content_type="text/plain")
        if table == "OPERLOG":
            n = ingest.ingest_operlog(device, request.body)
            return HttpResponse(f"OK: {n}", content_type="text/plain")
        return HttpResponse("OK", content_type="text/plain")  # ATTPHOTO etc: ack

    return HttpResponseBadRequest("unsupported method")
