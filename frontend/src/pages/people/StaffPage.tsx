import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  GENDERS,
  STAFF_STATUSES,
  usePermissionCatalog,
  useStaffList,
  useStaffRoles,
  type StaffMember,
} from '../../lib/people'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import {
  IconPencil,
  IconSearch,
  IconShield,
  IconStudents,
  IconUserPlus,
} from '../../components/icons'

const STATUS_TONE: Record<string, 'accent' | 'neutral' | 'warning'> = {
  employed: 'accent',
  on_leave: 'warning',
}

/**
 * Staff records + module permissions (admin only — the backend role-gates
 * this whole surface). Permissions here are the real authorization: every
 * API call is checked server-side against these grants.
 */
export default function StaffPage() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('employed')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null)
  const [granting, setGranting] = useState<StaffMember | null>(null)

  const { data, isLoading, isError } = useStaffList({ search: query, status, page })
  const rows = data?.results ?? []

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-0 flex-1 basis-64"
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setQuery(search)
          }}
        >
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff by name…"
            className="pl-9"
            aria-label="Search staff"
          />
        </form>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          aria-label="Status filter"
          className="w-36"
        >
          <option value="">All statuses</option>
          {STAFF_STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Button onClick={() => setEditing('new')}>
          <IconUserPlus size={16} /> New staff
        </Button>
      </div>

      {isError && (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          Could not load staff records.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconStudents size={22} />}
            title="No staff match"
            hint="Try another search or status."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((m) => {
              const grants = m.permissions.filter((p) => /\.(view|manage)$/.test(p))
              return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.full_name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {[m.role_name, m.primary_contact].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="hidden sm:block">
                  <Badge tone={STATUS_TONE[m.status] ?? 'neutral'}>
                    {m.status.replace(/_/g, ' ')}
                  </Badge>
                </span>
                <button
                  aria-label={`Permissions for ${m.full_name}`}
                  title={`${grants.length} grants`}
                  onClick={() => setGranting(m)}
                  className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ${
                    grants.length
                      ? 'text-accent-strong hover:bg-accent-soft'
                      : 'text-ink-faint hover:bg-surface-sunken hover:text-ink'
                  }`}
                >
                  <IconShield size={16} />
                  {grants.length || 'none'}
                </button>
                <button
                  aria-label={`Edit ${m.full_name}`}
                  onClick={() => setEditing(m)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
              </li>
              )
            })}
          </ul>
        )}
      </div>

      {data && (
        <Pagination
          count={data.count}
          page={page}
          pageSize={50}
          onPage={setPage}
          label="staff"
        />
      )}

      {editing && (
        <StaffModal
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {granting && <PermissionsModal member={granting} onClose={() => setGranting(null)} />}
    </div>
  )
}

function StaffModal({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const roles = useStaffRoles()
  const [form, setForm] = useState({
    first_name: member?.first_name ?? '',
    middle_name: member?.middle_name ?? '',
    last_name: member?.last_name ?? '',
    role: member?.role ?? '',
    status: member?.status ?? 'employed',
    gender: member?.gender ?? '',
    birth_date_bs: member?.birth_date_bs ?? '',
    email: member?.email ?? '',
    primary_contact: member?.primary_contact ?? '',
    secondary_contact: member?.secondary_contact ?? '',
    address: member?.address ?? '',
    qualification: member?.qualification ?? '',
    joined_date_bs: member?.joined_date_bs ?? '',
    rfid_card: member?.rfid_card ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () =>
      member
        ? api.patch(`/api/v1/people/staff/${member.id}/`, form)
        : api.post('/api/v1/people/staff/', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people', 'staff'] })
      toast.success(member ? 'Staff record updated.' : 'Staff member added.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid =
    form.first_name.trim() && form.last_name.trim() && form.role && form.primary_contact.trim()

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={member ? `Edit ${member.full_name}` : 'New staff member'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {member ? 'Save changes' : 'Add staff member'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="First name">
          <Input value={form.first_name} onChange={set('first_name')} autoFocus />
        </Field>
        <Field label="Middle name">
          <Input value={form.middle_name} onChange={set('middle_name')} />
        </Field>
        <Field label="Last name">
          <Input value={form.last_name} onChange={set('last_name')} />
        </Field>
        <Field label="Job role">
          <Select value={form.role} onChange={set('role')}>
            <option value="">{roles.isLoading ? 'Loading…' : 'Choose…'}</option>
            {(roles.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={set('status')}>
            {STAFF_STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gender">
          <Select value={form.gender} onChange={set('gender')}>
            <option value="">—</option>
            {GENDERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Primary phone">
          <Input value={form.primary_contact} onChange={set('primary_contact')} inputMode="tel" />
        </Field>
        <Field label="Secondary phone">
          <Input value={form.secondary_contact} onChange={set('secondary_contact')} inputMode="tel" />
        </Field>
        <Field label="Email">
          <Input value={form.email} onChange={set('email')} type="email" />
        </Field>
        <Field label="Birth date (BS)">
          <Input value={form.birth_date_bs} onChange={set('birth_date_bs')} placeholder="2050-01-15" />
        </Field>
        <Field label="Joined date (BS)">
          <Input value={form.joined_date_bs} onChange={set('joined_date_bs')} placeholder="2080-04-01" />
        </Field>
        <Field label="RFID card">
          <Input value={form.rfid_card} onChange={set('rfid_card')} />
        </Field>
        <Field label="Qualification" className="sm:col-span-2">
          <Input value={form.qualification} onChange={set('qualification')} />
        </Field>
        <Field label="Address">
          <Input value={form.address} onChange={set('address')} />
        </Field>
      </div>
    </Modal>
  )
}

/**
 * Module-permission matrix: per module, None / View / Manage. Manage implies
 * view server-side, so the two are presented as one exclusive choice.
 */
function PermissionsModal({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const catalog = usePermissionCatalog()
  // Imported staff may still carry legacy numeric codes — they grant nothing
  // and the API rejects them on write, so only real codes enter the editor.
  const [granted, setGranted] = useState<Set<string>>(
    new Set(member.permissions.filter((p) => /\.(view|manage)$/.test(p))),
  )

  const levelOf = (code: string): 'none' | 'view' | 'manage' =>
    granted.has(`${code}.manage`) ? 'manage' : granted.has(`${code}.view`) ? 'view' : 'none'

  const setLevel = (code: string, level: 'none' | 'view' | 'manage') =>
    setGranted((prev) => {
      const next = new Set(prev)
      next.delete(`${code}.view`)
      next.delete(`${code}.manage`)
      if (level !== 'none') next.add(`${code}.${level}`)
      return next
    })

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/v1/people/staff/${member.id}/`, { permissions: [...granted].sort() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people', 'staff'] })
      toast.success('Permissions saved.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Permissions — ${member.full_name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            Save permissions
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-muted">
        View allows reading a module; Manage also allows creating and editing.
        These grants are enforced on every API call, not just hidden in the UI.
      </p>
      <div className="overflow-hidden rounded-xl border border-border">
        <ul className="divide-y divide-border">
          {(catalog.data ?? []).map((mod) => {
            const level = levelOf(mod.code)
            return (
              <li
                key={mod.code}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-sm font-medium">{mod.label}</p>
                <div
                  role="radiogroup"
                  aria-label={`${mod.label} access`}
                  className="flex gap-1 rounded-lg bg-surface-sunken p-1"
                >
                  {(['none', 'view', 'manage'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={level === value}
                      onClick={() => setLevel(mod.code, value)}
                      className={`h-8 rounded-md px-3 text-xs font-medium capitalize transition-colors ${
                        level === value
                          ? value === 'none'
                            ? 'bg-surface text-ink shadow-sm'
                            : 'bg-accent-strong text-white shadow-sm'
                          : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
