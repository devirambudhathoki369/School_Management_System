import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache():
    """Throttle counters live in the cache and would leak between tests."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _ensure_ledger_groups(request):
    """Reseed the accounting reference groups for db tests: the
    migration-seeded rows are lost whenever a transactional test flushes
    the database."""
    if request.node.get_closest_marker("django_db") is None:
        yield
        return
    request.getfixturevalue("db")
    from apps.accounting.groups import LEDGER_GROUPS
    from apps.accounting.models import LedgerGroup

    if not LedgerGroup.objects.exists():
        LedgerGroup.objects.bulk_create(
            LedgerGroup(
                code=code, name=name, natural_side=side,
                category=category, cash_flow=cash_flow or "",
            )
            for code, (name, side, category, cash_flow) in LEDGER_GROUPS.items()
        )
    yield
