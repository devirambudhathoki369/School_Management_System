"""
Deny-by-default sweep over EVERY registered API route.

New endpoints are added weekly; this test makes "someone forgot the
permission classes" impossible to ship silently:

- anonymous requests must never see data (401 on everything but the
  explicit public allowlist);
- an authenticated staff account with ZERO module grants must be refused
  by every module route (403), proving the module gate actually sits in
  front of each one;
- a guardian must be refused by every staff-side route.

A route added without declaring `allowed_roles`/`permission_code` fails
closed at runtime — and this sweep documents and enforces that contract.
"""

import re
import uuid

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school

# Endpoints that are anonymous BY DESIGN.
PUBLIC = {
    "/api/v1/auth/login/",
    "/api/v1/auth/refresh/",
    "/api/v1/auth/logout/",  # blacklists the posted token; GET yields 405
}

# Authenticated-but-ungated endpoints: any signed-in principal may call them.
ANY_PRINCIPAL = {
    "/api/v1/auth/me/",
    "/api/v1/auth/change-password/",
    "/api/v1/auth/permission-catalog/",
    "/api/v1/meta/calendar/",
    "/api/v1/meta/splash/",  # vendor announcement: every signed-in user sees it
    "/api/v1/people/staff-roles/",  # global vocabulary, no tenant data
}

# Reviewed and accepted for ANY staff/admin (role gate, no module gate):
# global vocabulary tables with zero tenant rows, plus the dashboard, which
# filters its blocks server-side by the caller's own grants.
STAFF_VOCAB = {
    "/api/v1/billing/years/",       # deployment-wide fiscal years (names, dates)
    "/api/v1/accounting/groups/",   # the 34 seeded ledger groups
    "/api/v1/reports/dashboard/",   # self-filtering per module grant
}

DUMMY_ID = str(uuid.uuid4())


def _concrete(pattern) -> str:
    """One URL pattern segment as a literal path: path converters and regex
    named groups both become the dummy UUID."""
    text = str(pattern).lstrip("^").rstrip("$")
    text = re.sub(r"\(\?P<[^>]+>[^)]*\)", DUMMY_ID, text)  # DRF router regexes
    return re.sub(r"<[^>]+>", DUMMY_ID, text)  # path() converters


def api_routes():
    """Every concrete /api/v1 path, with url params filled by a dummy UUID."""
    routes = []

    def walk(patterns, prefix):
        for entry in patterns:
            # .json-style format-suffix twins duplicate the plain routes;
            # skip them on the RAW pattern, before substitution erases the
            # tell-tale group name.
            if "format" in str(entry.pattern):
                continue
            if isinstance(entry, URLResolver):
                walk(entry.url_patterns, prefix + _concrete(entry.pattern))
            elif isinstance(entry, URLPattern):
                path = prefix + _concrete(entry.pattern)
                if path.startswith("api/v1/"):
                    routes.append("/" + path)

    walk(get_resolver().url_patterns, "")
    return sorted(set(routes))


@pytest.mark.django_db
class TestRouteSweep:
    def test_every_route_is_registered(self):
        routes = api_routes()
        assert len(routes) > 80  # sanity: the walker actually finds the API

    def test_anonymous_is_refused_everywhere(self):
        api = APIClient()
        leaks = []
        for route in api_routes():
            if route in PUBLIC:
                continue
            status = api.get(route).status_code
            if status not in (401, 405):
                leaks.append((route, status))
        assert not leaks, f"anonymous access leaked through: {leaks}"

    def test_staff_without_grants_is_refused_by_every_module_route(self):
        school = make_school("sweep")
        make_staff(school, "sweep_staff", [])  # zero grants
        api = APIClient()
        login(api, "sweep_staff", "staff")
        leaks = []
        for route in api_routes():
            if route in PUBLIC or route in ANY_PRINCIPAL or route in STAFF_VOCAB:
                continue
            status = api.get(route).status_code
            # 403 = gate held; 404/405 acceptable only when the gate passed
            # roles first is impossible — TenantScopedViewSet checks
            # permissions before object lookup, so 404 here would mean the
            # module gate let the request through.
            if status not in (401, 403, 405):
                leaks.append((route, status))
        assert not leaks, f"ungranted staff reached: {leaks}"

    def test_guardian_is_refused_by_every_staff_route(self):
        from apps.identity.models import Account, Role

        make_school("gsweep")
        Account.objects.create_user("gsweep_parent", Role.GUARDIAN, "Sweep-Pass-2082!",
                                    verified=True)
        api = APIClient()
        res = api.post(
            "/api/v1/auth/login/",
            {"username": "gsweep_parent", "password": "Sweep-Pass-2082!", "role": "guardian"},
        )
        assert res.status_code == 200
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        leaks = []
        for route in api_routes():
            if route in PUBLIC or route in ANY_PRINCIPAL:
                continue
            if route.startswith("/api/v1/portal/"):
                continue  # the guardian's own surface
            status = api.get(route).status_code
            # STAFF_VOCAB is deliberately NOT excluded here: those routes are
            # role-gated to staff/admin and a guardian must bounce off them.
            if status not in (401, 403, 405):
                leaks.append((route, status))
        assert not leaks, f"guardian reached staff routes: {leaks}"
