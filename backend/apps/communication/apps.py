from django.apps import AppConfig


class CommunicationConfig(AppConfig):
    name = "apps.communication"
    verbose_name = "Communication"

    def ready(self):
        from . import receivers  # noqa: F401 — connect attendance push signal
