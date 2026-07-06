import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  useLedgerGroups,
  useLedgers,
  type LedgerAccount,
} from '../../lib/accounting'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconPencil, IconPlus, IconSearch, IconTrash } from '../../components/icons'

/**
 * Chart of accounts: the school's ledgers under the 34 fixed groups.
 * Groups are platform reference data (their Dr/Cr behaviour is what keeps
 * vouchers honest), so schools create ledgers, never groups.
 */

export default function LedgersPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const ledgers = useLedgers()
  const groups = useLedgerGroups()
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<LedgerAccount | 'new' | null>(null)

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const all = ledgers.data ?? []
    return needle
      ? all.filter(
          (l) =>
            l.name.toLowerCase().includes(needle) ||
            l.group_name.toLowerCase().includes(needle),
        )
      : all
  }, [ledgers.data, filter])

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/accounting/ledgers/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'ledgers'] })
      toast.success('Ledger removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter ledgers…"
            className="pl-9"
          />
        </div>
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New ledger
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {ledgers.isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filter ? 'No ledgers match' : 'No ledgers yet'}
            hint={filter ? undefined : 'Create the accounts vouchers will post to.'}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  {(l.address || l.contact) && (
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {[l.address, l.contact].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <Badge>{l.group_name}</Badge>
                <button
                  aria-label={`Edit ${l.name}`}
                  onClick={() => setEditing(l)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <button
                  aria-label={`Delete ${l.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete ledger “${l.name}”? Vouchers keep their history.`))
                      remove.mutate(l.id)
                  }}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <LedgerModal
          ledger={editing === 'new' ? null : editing}
          groups={groups.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function LedgerModal({
  ledger,
  groups,
  onClose,
}: {
  ledger: LedgerAccount | null
  groups: Array<{ code: number; name: string; category: string }>
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(ledger?.name ?? '')
  const [group, setGroup] = useState(ledger ? String(ledger.group) : '')
  const [address, setAddress] = useState(ledger?.address ?? '')
  const [contact, setContact] = useState(ledger?.contact ?? '')

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), group: Number(group), address, contact }
      if (ledger) return api.patch(`/api/v1/accounting/ledgers/${ledger.id}/`, payload)
      return api.post('/api/v1/accounting/ledgers/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'ledgers'] })
      toast.success(ledger ? 'Ledger updated.' : 'Ledger created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={ledger ? `Edit ${ledger.name}` : 'New ledger'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!name.trim() || !group}
            onClick={() => save.mutate()}
          >
            {ledger ? 'Save changes' : 'Create ledger'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Nabil Bank — collection a/c" />
        </Field>
        <Field label="Group" hint="The group fixes the account's Dr/Cr behaviour on vouchers and reports.">
          <Select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Choose a group…</option>
            {groups.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Contact">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
