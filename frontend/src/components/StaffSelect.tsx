import { Select } from './ui'
import { useStaffLookup } from '../lib/payroll'

/**
 * Staff dropdown fed by the payroll-gated lookup. A school has tens of
 * staff, not thousands, so a plain select beats a search box here —
 * employed staff first, departed grouped below for historical entries.
 */
export default function StaffSelect({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string
  onChange: (staffId: string) => void
  autoFocus?: boolean
}) {
  const staff = useStaffLookup()
  const rows = staff.data ?? []
  const employed = rows.filter((s) => s.status === 'employed')
  const former = rows.filter((s) => s.status !== 'employed')

  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      aria-label="Staff member"
    >
      <option value="">{staff.isLoading ? 'Loading staff…' : 'Choose a staff member…'}</option>
      {employed.map((s) => (
        <option key={s.id} value={s.id}>
          {s.full_name} — {s.role_name}
        </option>
      ))}
      {former.length > 0 && (
        <optgroup label="Former staff">
          {former.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} — {s.role_name} ({s.status.replace(/_/g, ' ')})
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  )
}
