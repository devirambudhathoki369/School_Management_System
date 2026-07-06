"""Root URL configuration. Every API route lives under a version prefix."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", include("apps.core.urls")),
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
    path("api/v1/audit/", include("apps.audit.urls")),
    path("api/v1/devices/", include("apps.devices.urls")),
    path("iclock/", include("apps.devices.urls_protocol")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
