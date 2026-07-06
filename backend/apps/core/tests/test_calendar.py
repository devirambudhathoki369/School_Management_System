"""Calendar meta endpoint: BS/AD facts for client forms."""

import pytest
from rest_framework.test import APIClient

from apps.core.dates import today_bs
from apps.people.tests.test_tenant_isolation import login, make_school


@pytest.mark.django_db
class TestCalendarEndpoint:
    def test_requires_authentication(self):
        assert APIClient().get("/api/v1/meta/calendar/").status_code == 401

    def test_returns_today_and_converts(self, db):
        make_school("cal")
        api = APIClient()
        login(api, "admin_cal", "admin")
        res = api.get("/api/v1/meta/calendar/", {"bs": "2081-01-01", "ad": "2024-04-13"})
        assert res.status_code == 200
        assert res.data["today_bs"] == today_bs()
        assert res.data["ad"] == "2024-04-13"
        assert res.data["bs"] == "2081-01-01"

    def test_rejects_malformed_dates(self, db):
        make_school("cal2")
        api = APIClient()
        login(api, "admin_cal2", "admin")
        assert api.get("/api/v1/meta/calendar/", {"bs": "not-a-date"}).status_code == 400
