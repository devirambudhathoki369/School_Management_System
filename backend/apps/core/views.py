from django.core.cache import cache
from django.db import connection
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .dates import ad_to_bs, bs_to_ad, today_bs


class HealthCheckView(APIView):
    """Liveness/readiness probe: verifies database and cache round-trips."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        checks = {}
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            checks["database"] = cursor.fetchone()[0] == 1
        cache.set("health_ping", "pong", timeout=5)
        checks["cache"] = cache.get("health_ping") == "pong"
        healthy = all(checks.values())
        return Response({"status": "ok" if healthy else "degraded", "checks": checks},
                        status=200 if healthy else 503)


class CalendarView(APIView):
    """Operational-calendar facts for clients. The BS conversion table lives
    server-side (nepali_datetime); forms default their date_bs from here
    instead of shipping the table to the browser. Optional ?bs= / ?ad=
    convert a specific date."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = today_bs()
        payload = {"today_bs": today, "today_ad": str(bs_to_ad(today))}
        try:
            if bs := request.query_params.get("bs"):
                payload["ad"] = str(bs_to_ad(bs))
            if ad := request.query_params.get("ad"):
                from datetime import date

                payload["bs"] = ad_to_bs(date.fromisoformat(ad))
        except (ValueError, TypeError):
            return Response({"error": {"message": "Invalid date."}}, status=400)
        return Response(payload)


class SplashView(APIView):
    """Newest active vendor announcement — every logged-in user sees it once
    per dismissal (the client keys dismissals on the announcement id)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.tenants.models import VendorAnnouncement

        row = (
            VendorAnnouncement.objects.filter(active=True)
            .order_by("-created_at")
            .first()
        )
        if row is None:
            return Response({"announcement": None})
        return Response({
            "announcement": {
                "id": str(row.id),
                "title": row.title,
                "message": row.message,
                "image": row.image.url if row.image else None,
            }
        })
