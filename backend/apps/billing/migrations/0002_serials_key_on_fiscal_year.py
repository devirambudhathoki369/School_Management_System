# Receipt serials key on the fiscal (economic) year, not the academic year.
# The final legacy code numbers receipts per (school, economic year) because
# an academic year closing mid-fiscal-year restarted the counter and minted
# duplicate receipt numbers; IRD numbering also runs per fiscal year.
# Safe swap: no new-era serials had been allocated yet (verified: 0 rows in
# the counter table, 0 payments with a non-null serial).

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0001_initial"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="receiptserialcounter",
            name="uniq_serial_counter",
        ),
        migrations.RemoveConstraint(
            model_name="payment",
            name="uniq_receipt_serial",
        ),
        migrations.RemoveField(
            model_name="receiptserialcounter",
            name="academic_year",
        ),
        migrations.AddField(
            model_name="receiptserialcounter",
            name="billing_year",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="+",
                to="billing.billingyear",
            ),
        ),
        migrations.AddConstraint(
            model_name="receiptserialcounter",
            constraint=models.UniqueConstraint(
                fields=("school", "billing_year", "kind"), name="uniq_serial_counter"
            ),
        ),
        migrations.AddConstraint(
            model_name="payment",
            constraint=models.UniqueConstraint(
                condition=models.Q(("serial__isnull", False)),
                fields=("school", "billing_year", "kind", "serial"),
                name="uniq_receipt_serial",
            ),
        ),
    ]
