"""
Tenant context: the single place the "current school" is resolved from.

The active tenant is bound per-request (or per-task) from the authenticated
principal — never from client-supplied ids. Query-time scoping helpers read
this context so cross-tenant leaks require an explicit, audited override.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from uuid import UUID

_current_school_id: ContextVar[UUID | None] = ContextVar("current_school_id", default=None)


def get_current_school_id() -> UUID | None:
    return _current_school_id.get()


@contextmanager
def school_context(school_id: UUID | None):
    """Bind the active tenant for the duration of a request or task."""
    token = _current_school_id.set(school_id)
    try:
        yield
    finally:
        _current_school_id.reset(token)
