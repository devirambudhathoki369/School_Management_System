import pytest


@pytest.fixture(autouse=True)
def ensure_ledger_groups(db):
    """Reseed the reference groups: the migration-seeded rows are lost when
    a transactional test flushes the database."""
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
