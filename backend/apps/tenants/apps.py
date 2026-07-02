from django.apps import AppConfig


class TenantsConfig(AppConfig):
    name = "apps.tenants"
    verbose_name = "Tenants"

    def ready(self):
        from . import signals  # noqa: F401 — connect post_save hooks
