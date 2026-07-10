import { useState } from 'react'
import { useDeviceUsers, useDevices } from '../../lib/devices'
import { Badge, EmptyState, Field, Pagination, Select, SkeletonRows } from '../../components/ui'
import { IconScan } from '../../components/icons'

/** People enrolled on the devices — the pin/card that resolves a punch to a
 * student or staff member. */
export default function DeviceUsersPage() {
  const devices = useDevices()
  const [device, setDevice] = useState('')
  const [page, setPage] = useState(1)
  const users = useDeviceUsers(page, device)

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

      {users.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={8} />
        </div>
      ) : (users.data?.results ?? []).length === 0 ? (
        <EmptyState
          icon={<IconScan size={22} />}
          title="No device users"
          hint="Enrolled pins and cards appear here as devices sync."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">PIN</th>
                  <th className="px-3 py-2.5 font-medium">Person</th>
                  <th className="px-3 py-2.5 font-medium">Card</th>
                  <th className="px-3 py-2.5 font-medium">Device</th>
                  <th className="px-4 py-2.5 font-medium">Verify</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data!.results.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 py-2.5 font-mono text-xs">{user.pin}</td>
                    <td className="px-3 py-2.5">
                      {user.person_name || <span className="text-ink-faint">unlinked</span>}
                      {user.person_name && (
                        <span className="ml-2 align-middle">
                          <Badge tone={user.student ? 'accent' : 'neutral'}>
                            {user.student ? 'student' : 'staff'}
                          </Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{user.card || '—'}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{user.device_alias || '—'}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{user.verify || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            count={users.data!.count}
            page={page}
            pageSize={50}
            onPage={setPage}
            label="device users"
          />
        </>
      )}
    </div>
  )
}
