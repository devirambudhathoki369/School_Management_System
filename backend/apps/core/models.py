"""
Shared model foundation for every module.

Design decisions (see LEGACY_DATA_MAP.md and DOCUMENTATION.md §17–19):

- Primary keys are UUIDv7, generated client-side (works with bulk_create).
  Time-ordered, so B-tree locality stays good at scale, and identifiers leak
  no per-tenant row counts through the API.
- Soft delete is the default (`is_active`); the default manager hides
  inactive rows, `all_objects` sees everything (legacy invariant X1).
- Tenant-owned rows inherit TenantScopedModel; the tenant is *always* derived
  from the authenticated principal via `apps.core.tenancy`, never from
  client-supplied identifiers (legacy weakness §17.2, invariant I1).
"""


import uuid

import uuid_utils
from django.db import models
from django.db.models import Manager


def uuid7() -> uuid.UUID:
    """Time-ordered UUIDv7, generated client-side so bulk_create gets PKs."""
    return uuid.UUID(bytes=uuid_utils.uuid7().bytes)


class UUIDv7Field(models.UUIDField):
    """Time-ordered UUID primary key (good B-tree locality at scale)."""

    def __init__(self, **kwargs):
        kwargs.setdefault("primary_key", True)
        kwargs.setdefault("editable", False)
        kwargs.setdefault("default", uuid7)
        super().__init__(**kwargs)


class ActiveManager(models.Manager):
    """Default manager: active rows only (soft delete is invisible)."""

    def get_queryset(self):
        return super().get_queryset().filter(is_active=True)


class BaseModel(models.Model):
    """Timestamps + soft delete. The base of every domain entity."""

    id = UUIDv7Field()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    objects = ActiveManager()
    all_objects = Manager()  # noqa: DJ012 — ruff misreads a second manager as a field

    class Meta:
        abstract = True
        base_manager_name = "all_objects"
        default_manager_name = "objects"

    def soft_delete(self):
        self.is_active = False
        self.save(update_fields=["is_active", "updated_at"])


class TenantScopedModel(BaseModel):
    """Base for every row owned by a school (tenant)."""

    school = models.ForeignKey(
        "tenants.School",
        on_delete=models.PROTECT,
        related_name="%(app_label)s_%(class)s_set",
    )

    class Meta(BaseModel.Meta):
        abstract = True


class LegacyMap(models.Model):
    """
    Cross-walk from legacy smsysdb rows to new-platform rows.

    Written by every ETL phase; read by later phases to resolve FKs and kept
    permanently for support ("which legacy invoice is this?").
    """

    id = models.BigAutoField(primary_key=True)
    legacy_table = models.CharField(max_length=80)
    legacy_id = models.BigIntegerField()
    new_table = models.CharField(max_length=80)
    new_id = models.UUIDField()
    migrated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["legacy_table", "legacy_id"], name="uniq_legacy_row"
            )
        ]
        indexes = [models.Index(fields=["new_table", "new_id"])]

    def __str__(self):
        return f"{self.legacy_table}#{self.legacy_id} -> {self.new_table}#{self.new_id}"
