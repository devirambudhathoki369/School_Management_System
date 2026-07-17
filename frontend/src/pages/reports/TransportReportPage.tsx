import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ClassPicker from '../../components/ClassPicker'
import { Badge, Field, Select, StatCard } from '../../components/ui'
import { IconBus } from '../../components/icons'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDateBS, formatMoney } from '../../lib/format'
import { useTransportReport, type TransportRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  type Col,
} from './shared'

/** Transportation history: riders per station/class with contacts. */

interface Station {
  id: string
  name: string
}

export default function TransportReportPage() {
  const { account } = useAuth()
  const [stationId, setStationId] = useState('')
  const [classId, setClassId] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)

  const stations = useQuery({
    queryKey: ['transport', 'stations', 'names'],
    queryFn: async () =>
      (await api.get<{ results?: Station[] } | Station[]>('/api/v1/transport/stations/', {
        params: { page_size: '500' },
      })).data,
  })
  const stationRows: Station[] = Array.isArray(stations.data)
    ? stations.data
    : (stations.data?.results ?? [])

  const report = useTransportReport({
    bus_station: stationId || undefined,
    class_info: classId || undefined,
    include_inactive: includeInactive ? 'true' : undefined,
  })
  const rows = report.data?.rows ?? []

  const columns: Array<Col<TransportRow>> = [
    { key: 'name', label: 'Student', render: (r) => r.name },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    { key: 'station', label: 'Station', render: (r) => r.station },
    {
      key: 'fee',
      label: 'Monthly fee',
      align: 'right',
      render: (r) => (r.fee != null ? formatMoney(r.fee) : '—'),
      csv: (r) => r.fee ?? '',
    },
    { key: 'since', label: 'Riding since (BS)', render: (r) => formatDateBS(r.start_date_bs), csv: (r) => r.start_date_bs },
    { key: 'guardian', label: 'Guardian', render: (r) => r.guardian_name },
    { key: 'contact', label: 'Contact', render: (r) => r.contact },
    {
      key: 'state',
      label: 'Status',
      render: (r) =>
        r.is_active ? <Badge tone="positive">riding</Badge> : <Badge tone="neutral">ended</Badge>,
      csv: (r) => (r.is_active ? 'riding' : 'ended'),
    },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Bus station">
          <Select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">All stations</option>
            {stationRows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-1 lg:col-span-1">
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} allowAnyClass />
        </div>
        {account?.role === 'admin' && (
          <label className="flex items-end gap-2 pb-2.5 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="size-4 accent-accent"
            />
            Include past riders
          </label>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-xs">
        <StatCard
          label="Riders"
          value={report.data?.summary.count ?? '—'}
          tone="accent"
          icon={<IconBus size={16} />}
        />
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Transportation history</h2>
        <ReportActions title="transportation-history" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>

      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No riders"
        emptyHint="Students subscribed to a bus station appear here with their contacts."
        truncated={report.data?.truncated}
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <ReportPrintSheet title="Transportation history" columns={columns} rows={rows} rowKey={(r) => r.id} />
      </ReportBody>
    </div>
  )
}
