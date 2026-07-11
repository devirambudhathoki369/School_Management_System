"""Root URL configuration. Every API route lives under a version prefix."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.reports import DashboardView
from apps.core.views import CalendarView

urlpatterns = [
    # Movable in production (DJANGO_ADMIN_PATH=<segment>/): the Django admin
    # login has no lockout of its own, so don't leave it at the default
    # address every scanner tries first.
    path(getattr(settings, "ADMIN_PATH", "admin/"), admin.site.urls),
    path("health/", include("apps.core.urls")),
    path("api/v1/meta/calendar/", CalendarView.as_view(), name="meta-calendar"),
    path("api/v1/reports/dashboard/", DashboardView.as_view(), name="reports-dashboard"),
    path("api/v1/auth/", include("apps.identity.urls")),
    path("api/v1/academics/", include("apps.academics.urls")),
    path("api/v1/people/", include("apps.people.urls")),
    path("api/v1/examinations/", include("apps.examinations.urls")),
    path("api/v1/attendance/", include("apps.attendance.urls")),
    path("api/v1/billing/", include("apps.billing.urls")),
    path("api/v1/payroll/", include("apps.payroll.urls")),
    path("api/v1/accounting/", include("apps.accounting.urls")),
    path("api/v1/homework/", include("apps.homework.urls")),
    path("api/v1/library/", include("apps.library.urls")),
    path("api/v1/transport/", include("apps.transport.urls")),
    path("api/v1/communication/", include("apps.communication.urls")),
    path("api/v1/inventory/", include("apps.inventory.urls")),
    path("api/v1/portal/", include("apps.portal.urls")),
    path("api/v1/audit/", include("apps.audit.urls")),
    path("api/v1/devices/", include("apps.devices.urls")),
    path("iclock/", include("apps.devices.urls_protocol")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
