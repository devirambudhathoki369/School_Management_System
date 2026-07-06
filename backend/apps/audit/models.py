"""
Append-only audit trail (successor of legacy main_historylog, 664k rows).

Events are write-once: no update or delete path exists in application code,
and a DB trigger (migration 0004) rejects UPDATE/DELETE outright. Archived
legacy rows keep their original timestamp and address the audited object as
"legacy:<app>.<model>" + the legacy integer id — imported rows carry a
matching `legacy_id` column, so support queries join naturally. Events the
new platform writes use the new table name + UUID instead. Legacy superadmin
actors have no unified account; they keep a human-readable `actor_label`.
"""

from django.db import models
from django.utils import timezone

from apps.core.models import UUIDv7Field


class AuditEvent(models.Model):
    class Action(models.TextChoices):
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        SOFT_DELETE = "soft_delete", "Soft delete"
        LOGIN = "login", "Login"
        READ_SENSITIVE = "read_sensitive", "Sensitive read"

    id = UUIDv7Field()
    at = models.DateTimeField(default=timezone.now, db_index=True)
    actor = models.ForeignKey(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    actor_label = models.CharField(max_length=40, blank=True, default="")
    school = models.ForeignKey(
        "tenants.School", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=16, choices=Action.choices)
    object_table = models.CharField(max_length=80)
    object_id = models.CharField(max_length=40)
    changes = models.JSONField(null=True, blank=True)  # field-level diff
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=200, blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta:
        indexes = [
            models.Index(fields=["object_table", "object_id"]),
            models.Index(fields=["school", "at"]),
        ]

    def __str__(self):
        return f"{self.action} {self.object_table}#{self.object_id}"
