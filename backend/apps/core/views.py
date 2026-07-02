from django.core.cache import cache
from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


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
