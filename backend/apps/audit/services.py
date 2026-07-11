"""
Application-side audit writer.

One narrow entry point so every security-relevant event lands in the same
append-only table the legacy archive lives in (a DB trigger rejects
UPDATE/DELETE below the ORM — see models.py). Auth events keep the volume
proportionate: successful logins, lockouts, password changes and grant
changes are recorded; a single failed password attempt is not.

Because ATOMIC_REQUESTS is on and DRF marks the transaction rollback-only
when a handler raises (set_rollback), events for FAILED flows must be
written on a non-exception response path — return the error response
instead of raising, or the audit row vanishes with the rollback.
"""

from .models import AuditEvent


def client_ip(request) -> str | None:
    """Best-effort client address. REMOTE_ADDR is what the WSGI server saw;
    honouring X-Forwarded-For blindly would let clients spoof their audit
    trail, so the proxy chain must rewrite REMOTE_ADDR (gunicorn behind
    nginx does)."""
    if request is None:
        return None
    return request.META.get("REMOTE_ADDR") or None


def record(
    *,
    action: str,
    object_table: str,
    object_id: str,
    actor=None,
    school=None,
    changes: dict | None = None,
    request=None,
) -> AuditEvent:
    """Append one audit event. Never raises into the caller's flow beyond
    database errors — auditing shares the caller's transaction so a rolled
    back action leaves no phantom event."""
    return AuditEvent.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        actor_label=str(getattr(actor, "username", "") or "")[:40],
        school=school,
        action=action,
        object_table=object_table,
        object_id=str(object_id)[:40],
        changes=changes,
        ip_address=client_ip(request),
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:200] if request else ""),
    )
