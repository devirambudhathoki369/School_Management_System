import { useState } from 'react'
import { usePunchLogs, useDevices } from '../../lib/devices'
import { EmptyState, Field, Pagination, Select, SkeletonRows } from '../../components/ui'
import { IconScan } from '../../components/icons'

/** Raw punches exactly as the devices reported them — the source the
 * attendance engine works from. Read-only by design. */
export default function PunchLogPage() {
  const devices = useDevices()
  const [device, setDevice] = useState('')
  const [page, setPage] = useState(1)
  const logs = usePunchLogs(page, device)

  return (
    <div className="space-y-4">
      <Field label="Device" className="max-w-xs">
        <Select
          value={device}
          onChange={(e) => {
            setDevice(e.target.value)
            setPage(1)
          }}
        >
          <option value="">All devices</option>
          {(devices.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.alias || d.serial_number}
            </option>
          ))}
        </Select>
      </Field>

      {logs.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={10} />
        </div>
      ) : (logs.data?.results ?? []).length === 0 ? (
        <EmptyState
          icon={<IconScan size={22} />}
          title="No punches yet"
          hint="Card and biometric punches stream in here as they happen."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">PIN</th>
                  <th className="px-3 py-2.5 font-medium">Punched at</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.data!.results.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2.5 font-mono text-xs">{log.pin}</td>
                    <td className="px-3 py-2.5">{new Date(log.punch_time).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{log.status || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">
                      {new Date(log.received_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            count={logs.data!.count}
            page={page}
            pageSize={50}
            onPage={setPage}
            label="punches"
          />
        </>
      )}
    </div>
  )
}
