import { StatCard } from '../../components/ui'
import { IconShield } from '../../components/icons'
import { formatMoney, formatReceiptNo } from '../../lib/format'
import { useIntegrityReport, type IntegrityPayload } from '../../lib/reports'
import { ReportBody, ReportTable, type Col } from './shared'

/**
 * Financial integrity — the constraints-era descendant of the legacy
 * academic-year mismatch finders. Healthy books show two empty lists.
 */

type PaymentMismatch = IntegrityPayload['payments'][number]
type ChargeMismatch = IntegrityPayload['charges'][number]

export default function IntegrityReportPage() {
  const report = useIntegrityReport()
  const payments = report.data?.payments ?? []
  const charges = report.data?.charges ?? []
  const clean = payments.length === 0 && charges.length === 0

  const paymentColumns: Array<Col<PaymentMismatch>> = [
    { key: 'serial', label: 'Receipt', render: (r) => formatReceiptNo(r.serial) },
    { key: 'date', label: 'Date (BS)', render: (r) => r.date_bs },
    { key: 'name', label: 'Student', render: (r) => r.name },
    { key: 'class', label: 'Class (snapshot)', render: (r) => r.class_label },
    { key: 'py', label: 'Payment year', render: (r) => r.payment_year },
    { key: 'cy', label: 'Class year', render: (r) => r.class_year },
    { key: 'paid', label: 'Paid', align: 'right', render: (r) => formatMoney(r.total_paid) },
  ]
  const chargeColumns: Array<Col<ChargeMismatch>> = [
    { key: 'date', label: 'Date (BS)', render: (r) => r.date_bs },
    { key: 'name', label: 'Student', render: (r) => r.name },
    { key: 'chy', label: 'Charge year', render: (r) => r.charge_year },
    { key: 'bay', label: 'Batch year', render: (r) => r.batch_year },
    { key: 'total', label: 'Total', align: 'right', render: (r) => formatMoney(r.total) },
  ]

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-md">
        <StatCard
          label="Payment mismatches"
          value={report.data?.summary.payment_mismatches ?? '—'}
          tone={payments.length ? 'warning' : 'positive'}
          icon={<IconShield size={16} />}
        />
        <StatCard
          label="Charge mismatches"
          value={report.data?.summary.charge_mismatches ?? '—'}
          tone={charges.length ? 'warning' : 'positive'}
        />
      </div>

      <ReportBody
        loading={report.isLoading}
        empty={clean}
        emptyTitle="Books are consistent"
        emptyHint="Every payment and charge sits in the academic year its class runs in."
      >
        {payments.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-ink-muted">
              Payments outside their class year
            </h2>
            <ReportTable columns={paymentColumns} rows={payments} rowKey={(r) => r.id} />
          </section>
        )}
        {charges.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-muted">
              Charges disagreeing with their batch
            </h2>
            <ReportTable columns={chargeColumns} rows={charges} rowKey={(r) => r.id} />
          </section>
        )}
      </ReportBody>
    </div>
  )
}
