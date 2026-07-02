import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache():
    """Throttle counters live in the cache and would leak between tests."""
    cache.clear()
    yield
    cache.clear()
