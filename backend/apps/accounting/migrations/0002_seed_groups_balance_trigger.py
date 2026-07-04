# 1. Seed the 34 legacy ledger groups (stable legacy codes; see groups.py).
# 2. Install a DEFERRED constraint trigger: at commit, every voucher touched
#    by a line write must balance (sum Dr == sum Cr) unless needs_review is
#    set — the exemption that lets the 4 unbalanced legacy journal vouchers
#    and the 16 patched soft-deleted entries import verbatim (finding #2).

from django.db import migrations

BALANCE_TRIGGER_SQL = """
CREATE OR REPLACE FUNCTION accounting_check_voucher_balance() RETURNS trigger AS $$
DECLARE
    v_id uuid;
    v_needs_review boolean;
    imbalance numeric;
BEGIN
    v_id := COALESCE(NEW.voucher_id, OLD.voucher_id);
    SELECT needs_review INTO v_needs_review FROM accounting_voucher WHERE id = v_id;
    IF NOT FOUND OR v_needs_review THEN
        RETURN NULL;  -- voucher deleted in the same tx, or exempted
    END IF;
    SELECT COALESCE(SUM(CASE WHEN side = 'dr' THEN amount ELSE -amount END), 0)
      INTO imbalance
      FROM accounting_voucherline
     WHERE voucher_id = v_id AND is_active;
    IF imbalance <> 0 THEN
        -- check_violation so Django surfaces it as IntegrityError
        RAISE EXCEPTION 'Voucher % does not balance (Dr-Cr = %)', v_id, imbalance
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER voucher_must_balance
AFTER INSERT OR UPDATE OR DELETE ON accounting_voucherline
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION accounting_check_voucher_balance();
"""

BALANCE_TRIGGER_REVERSE_SQL = """
DROP TRIGGER IF EXISTS voucher_must_balance ON accounting_voucherline;
DROP FUNCTION IF EXISTS accounting_check_voucher_balance();
"""


def seed_groups(apps, schema_editor):
    from apps.accounting.groups import LEDGER_GROUPS

    LedgerGroup = apps.get_model("accounting", "LedgerGroup")
    LedgerGroup.objects.bulk_create(
        [
            LedgerGroup(
                code=code, name=name, natural_side=side,
                category=category, cash_flow=cash_flow or "",
            )
            for code, (name, side, category, cash_flow) in LEDGER_GROUPS.items()
        ],
        ignore_conflicts=True,
    )


def unseed_groups(apps, schema_editor):
    apps.get_model("accounting", "LedgerGroup").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounting", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_groups, unseed_groups),
        migrations.RunSQL(BALANCE_TRIGGER_SQL, BALANCE_TRIGGER_REVERSE_SQL),
    ]
