# Append-only enforced in the database: any UPDATE or DELETE on the audit
# table raises, regardless of the connecting role. Maintenance (retention)
# runs as a superuser with the trigger disabled explicitly.

from django.db import migrations

TRIGGER_SQL = """
CREATE OR REPLACE FUNCTION audit_events_are_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Audit events are append-only'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON audit_auditevent
FOR EACH ROW EXECUTE FUNCTION audit_events_are_append_only();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS audit_event_append_only ON audit_auditevent;
DROP FUNCTION IF EXISTS audit_events_are_append_only();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0004_auditevent_actor_label_auditevent_legacy_id_and_more"),
    ]

    operations = [
        migrations.RunSQL(TRIGGER_SQL, REVERSE_SQL),
    ]
