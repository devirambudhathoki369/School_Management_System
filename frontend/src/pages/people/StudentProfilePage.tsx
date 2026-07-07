import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  RELATIONS,
  useGuardianSearch,
  useStudentFull,
  type GuardianLink,
  type StudentFull,
} from '../../lib/people'
import { formatDateBS } from '../../lib/format'
import StudentModal from './StudentModal'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import {
  IconChevronLeft,
  IconPencil,
  IconPlus,
  IconStudents,
  IconTrash,
} from '../../components/icons'

const STATUS_TONE: Record<string, 'accent' | 'positive' | 'warning'> = {
  running: 'accent',
  passed_out: 'positive',
  dropped_out: 'warning',
}

/** One student: identity, enrolment, ids and the guardian circle. */
export default function StudentProfilePage() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const student = useStudentFull(studentId ?? null)
  const [editing, setEditing] = useState(false)
  const [addingGuardian, setAddingGuardian] = useState(false)
  const [editingLink, setEditingLink] = useState<GuardianLink | null>(null)

  if (student.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-56" />
      </div>
    )
  }
  if (student.isError || !student.data) {
    return (
      <EmptyState
        icon={<IconStudents size={22} />}
        title="Student not found"
        hint="They may belong to another school or the link is stale."
        action={
          <Button variant="secondary" onClick={() => navigate('/people/students')}>
            Back to students
          </Button>
        }
      />
    )
  }
  const s = student.data
  const fullName = [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ')

  return (
    <div className="space-y-5">
      <Link
        to="/people/students"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"
      >
        <IconChevronLeft size={16} /> All students
      </Link>

      <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{fullName}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {s.class_label} · {s.academic_year_name}
              {s.roll_no ? ` · Roll ${s.roll_no}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>
              {s.status.replace(/_/g, ' ')}
            </Badge>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <IconPencil size={16} /> Edit
            </Button>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Info label="Phone" value={s.contact} />
          <Info label="Email" value={s.email} />
          <Info label="Address" value={s.address} />
          <Info label="Birth date (BS)" value={s.birth_date_bs ? formatDateBS(s.birth_date_bs) : ''} />
          <Info label="Gender" value={s.gender} />
          <Info label="Blood group" value={s.blood_group} />
          <Info label="Ethnicity" value={s.ethnicity} />
          <Info label="Symbol no" value={s.symbol_no} />
          <Info label="Registration no" value={s.regd_no} />
          <Info label="EMIS" value={s.emis} />
          <Info label="RFID card" value={s.rfid_card} />
          <Info label="Previous school" value={s.previous_school} />
        </dl>
        {s.remarks && (
          <p className="mt-4 rounded-lg bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
            {s.remarks}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold">Guardians</h3>
          <Button variant="secondary" onClick={() => setAddingGuardian(true)}>
            <IconPlus size={16} /> Add guardian
          </Button>
        </div>
        {s.guardians.length === 0 ? (
          <EmptyState
            title="No guardians linked"
            hint="Link a parent or guardian so the school can reach someone."
          />
        ) : (
          <ul className="divide-y divide-border">
            {s.guardians.map((link) => (
              <li key={link.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {link.guardian.name}
                    {link.is_primary_contact && (
                      <span className="ml-2 align-middle">
                        <Badge tone="accent">primary contact</Badge>
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {[
                      link.relation[0].toUpperCase() + link.relation.slice(1),
                      link.guardian.contact,
                      link.guardian.occupation,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  aria-label={`Edit ${link.guardian.name}`}
                  onClick={() => setEditingLink(link)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <RemoveLinkButton studentId={s.id} link={link} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && <StudentModal student={s} onClose={() => setEditing(false)} />}
      {addingGuardian && (
        <GuardianLinkModal student={s} link={null} onClose={() => setAddingGuardian(false)} />
      )}
      {editingLink && (
        <GuardianLinkModal
          student={s}
          link={editingLink}
          onClose={() => setEditingLink(null)}
        />
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value || '—'}</dd>
    </div>
  )
}

function RemoveLinkButton({ studentId, link }: { studentId: string; link: GuardianLink }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () =>
      api.delete(`/api/v1/people/students/${studentId}/guardians/${link.id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people', 'student-full', studentId] })
      toast.success('Guardian detached.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })
  return (
    <button
      aria-label={`Remove ${link.guardian.name}`}
      onClick={() => {
        if (
          window.confirm(
            `Detach ${link.guardian.name}? The guardian record stays (they may have other children here).`,
          )
        )
          remove.mutate()
      }}
      className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
    >
      <IconTrash size={16} />
    </button>
  )
}

/**
 * Add or edit a guardian link. Adding searches existing guardians first —
 * siblings share one guardian record — with inline creation as the fallback.
 */
function GuardianLinkModal({
  student,
  link,
  onClose,
}: {
  student: StudentFull
  link: GuardianLink | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [search, setSearch] = useState('')
  const [existingId, setExistingId] = useState('')
  const matches = useGuardianSearch(mode === 'existing' ? search : '')
  const [person, setPerson] = useState({
    name: link?.guardian.name ?? '',
    contact: link?.guardian.contact ?? '',
    email: link?.guardian.email ?? '',
    address: link?.guardian.address ?? '',
    occupation: link?.guardian.occupation ?? '',
  })
  const [relation, setRelation] = useState(link?.relation ?? 'father')
  const [primary, setPrimary] = useState(link?.is_primary_contact ?? student.guardians.length === 0)

  const setP = (key: keyof typeof person) => (e: { target: { value: string } }) =>
    setPerson((p) => ({ ...p, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: async () => {
      if (link) {
        return api.patch(`/api/v1/people/students/${student.id}/guardians/${link.id}/`, {
          ...person,
          relation,
          is_primary_contact: primary,
        })
      }
      const payload =
        mode === 'existing'
          ? { guardian: existingId, relation, is_primary_contact: primary }
          : { ...person, relation, is_primary_contact: primary }
      return api.post(`/api/v1/people/students/${student.id}/guardians/`, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people', 'student-full', student.id] })
      toast.success(link ? 'Guardian updated.' : 'Guardian linked.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = link
    ? person.name.trim().length > 0
    : mode === 'existing'
      ? existingId !== ''
      : person.name.trim().length > 0

  return (
    <Modal
      open
      onClose={onClose}
      title={link ? `Edit ${link.guardian.name}` : 'Add guardian'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {link ? 'Save changes' : 'Link guardian'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!link && (
          <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
            {(
              [
                ['new', 'New person'],
                ['existing', 'Existing guardian'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`h-9 flex-1 rounded-lg text-sm font-medium transition-colors ${
                  mode === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {!link && mode === 'existing' ? (
          <>
            <Field label="Find guardian" hint="Search by name or phone — siblings share one record.">
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setExistingId('')
                }}
                placeholder="e.g. Hari or 98…"
                autoFocus
              />
            </Field>
            {search.trim().length >= 2 && (
              <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {(matches.data ?? []).map((g) => (
                  <li key={g.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-surface-muted">
                      <input
                        type="radio"
                        name="guardian"
                        className="size-4 accent-accent-strong"
                        checked={existingId === g.id}
                        onChange={() => setExistingId(g.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{g.name}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {[g.contact, g.address].filter(Boolean).join(' · ') || 'no contact'}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
                {matches.data && matches.data.length === 0 && (
                  <li className="px-4 py-3 text-sm text-ink-muted">
                    Nobody matches — switch to “New person”.
                  </li>
                )}
              </ul>
            )}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2">
              <Input value={person.name} onChange={setP('name')} autoFocus={!link} />
            </Field>
            <Field label="Phone">
              <Input value={person.contact} onChange={setP('contact')} inputMode="tel" />
            </Field>
            <Field label="Occupation">
              <Input value={person.occupation} onChange={setP('occupation')} />
            </Field>
            <Field label="Email">
              <Input value={person.email} onChange={setP('email')} type="email" />
            </Field>
            <Field label="Address">
              <Input value={person.address} onChange={setP('address')} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Relation">
            <Select value={relation} onChange={(e) => setRelation(e.target.value as typeof relation)}>
              {RELATIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex min-h-10 items-center gap-2.5 self-end pb-1 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-accent-strong"
              checked={primary}
              onChange={(e) => setPrimary(e.target.checked)}
            />
            Primary contact
          </label>
        </div>
      </div>
    </Modal>
  )
}
