"""Shared DRF router for every module's urls.py."""

from rest_framework.routers import DefaultRouter


class ApiRouter(DefaultRouter):
    """DefaultRouter minus its two anonymous conveniences:

    - the API root view (a browsable index of every route in the module) —
      the SPA never uses it, and it let ANY authenticated principal,
      guardians included, enumerate the private API surface;
    - .json format-suffix twin routes, which double the URL space for no
      consumer.

    The deny-by-default sweep (apps.core.tests.test_route_sweep) keeps both
    from creeping back.
    """

    include_root_view = False
    include_format_suffixes = False
