import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useLibraries, type LibraryRow } from '../../lib/campus'
import { formatMoneyRs } from '../../lib/format'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconLibrary, IconPencil, IconPlus } from '../../components/icons'

/** Library definitions and their fine policy. Most schools run exactly one. */
export default function LibSettingsPage() {
  const libraries = useLibraries()
  const [editing, setEditing] = useState<LibraryRow | 'new' | null>(null)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New library
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {libraries.isLoading ? (
          <SkeletonRows rows={2} />
        ) : (libraries.data ?? []).length === 0 ? (
          <EmptyState
            icon={<IconLibrary size={22} />}
            title="No library yet"
            hint="Define the library and its fine rates to start cataloging."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(libraries.data ?? []).map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {[
                      l.address,
                      `late fine ${formatMoneyRs(l.fine_per_day)}/day`,
                      `damage fine ${formatMoneyRs(l.fine_on_damage)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  aria-label={`Edit ${l.name}`}
                  onClick={() => setEditing(l)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <LibraryModal
          library={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function LibraryModal({
  library,
  onClose,
}: {
  library: LibraryRow | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: library?.name ?? '',
    address: library?.address ?? '',
    contacts: library?.contacts ?? '',
    fine_per_day: library?.fine_per_day ?? '0',
    fine_on_damage: library?.fine_on_damage ?? '0',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () =>
      library
        ? api.patch(`/api/v1/library/libraries/${library.id}/`, form)
        : api.post('/api/v1/library/libraries/', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'libraries'] })
      toast.success(library ? 'Library updated.' : 'Library created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={library ? `Edit ${library.name}` : 'New library'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
            {library ? 'Save changes' : 'Create library'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={set('name')} autoFocus placeholder="Main library" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Address">
            <Input value={form.address} onChange={set('address')} />
          </Field>
          <Field label="Contacts">
            <Input value={form.contacts} onChange={set('contacts')} />
          </Field>
          <Field label="Late fine / day">
            <Input type="number" step="0.01" min="0" value={form.fine_per_day} onChange={set('fine_per_day')} />
          </Field>
          <Field label="Damage fine">
            <Input type="number" step="0.01" min="0" value={form.fine_on_damage} onChange={set('fine_on_damage')} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
