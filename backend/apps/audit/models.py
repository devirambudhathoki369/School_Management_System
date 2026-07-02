"""
Append-only audit trail (successor of legacy main_historylog, 664k rows).

Events are write-once: no update or delete path exists in application code,
and the table will additionally be protected by a DB-level rule revoking
UPDATE/DELETE from the app role. Signal wiring that auto-captures create/
update diffs lands with the first domain modules; the model ships first so
every module can depend on it.
"""

from django.db import models

from apps.core.models import UUIDv7Field


class AuditEvent(models.Model):
    class Action(models.TextChoices):
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        SOFT_DELETE = "soft_delete", "Soft delete"
        LOGIN = "login", "Login"
        READ_SENSITIVE = "read_sensitive", "Sensitive read"

    id = UUIDv7Field()
    at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    school = models.ForeignKey(
        "tenants.School", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=16, choices=Action.choices)
    object_table = models.CharField(max_length=80)
    object_id = models.CharField(max_length=40)
    changes = models.JSONField(null=True, blank=True)  # field-level diff
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        indexes = [
            models.Index(fields=["object_table", "object_id"]),
            models.Index(fields=["school", "at"]),
        ]

    def __str__(self):
        return f"{self.action} {self.object_table}#{self.object_id}"
