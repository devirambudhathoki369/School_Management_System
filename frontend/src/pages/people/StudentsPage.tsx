import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { STUDENT_STATUSES, useClassStudents, useStudentsPage } from '../../lib/people'
import type { ClassInfoFull } from '../../lib/academics'
import ClassPicker from '../../components/ClassPicker'
import StudentModal from './StudentModal'
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
  IconArrowRight,
  IconGraduate,
  IconSearch,
  IconStudents,
  IconUserPlus,
} from '../../components/icons'

const PAGE_SIZE = 50

const STATUS_TONE: Record<string, 'accent' | 'positive' | 'warning'> = {
  running: 'accent',
  passed_out: 'positive',
  dropped_out: 'warning',
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Badge>
}

/** Students directory: search + filters, enrol, and bulk promotion. */
export default function StudentsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('running')
  const [classId, setClassId] = useState('')
  const [page, setPage] = useState(1)
  const [enrolling, setEnrolling] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const { data, isLoading, isError } = useStudentsPage({
    search: query,
    status,
    classInfo: classId,
    page,
  })

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
            placeholder="Search by name or roll no…"
            className="pl-9"
            aria-label="Search students"
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
          {STUDENT_STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => setShowFilters((s) => !s)}>
          {classId ? 'Class ✓' : 'Class filter'}
        </Button>
        <Button variant="secondary" onClick={() => setPromoting(true)}>
          <IconGraduate size={16} /> Promote
        </Button>
        <Button onClick={() => setEnrolling(true)}>
          <IconUserPlus size={16} /> Enrol student
        </Button>
      </div>

      {showFilters && (
        <div className="mb-4 rounded-xl border border-border bg-surface p-4">
          <ClassPicker
            classId={classId}
            allowAnyClass
            onChange={(id) => {
              setClassId(id)
              setPage(1)
            }}
          />
        </div>
      )}

      {isError && (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          Could not load students. Check your permissions and try again.
        </p>
      )}

      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Class</th>
                <th className="px-4 py-3 font-medium">Roll</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(data?.results ?? []).map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted"
                  onClick={() => navigate(`/people/students/${s.id}`)}
                >
                  <td className="px-4 py-3 font-medium">{s.full_name}</td>
                  <td className="px-4 py-3 text-ink-muted">{s.class_label}</td>
                  <td className="px-4 py-3 text-ink-muted">{s.roll_no || '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{s.contact || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-right text-ink-faint">
                    <IconArrowRight size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.results.length === 0 && (
          <EmptyState
            icon={<IconStudents size={22} />}
            title="No students match"
            hint="Try a different search, status or class filter."
          />
        )}
      </div>

      <ul className="space-y-3 md:hidden">
        {isLoading && (
          <li className="rounded-xl border border-border bg-surface">
            <SkeletonRows rows={5} />
          </li>
        )}
        {(data?.results ?? []).map((s) => (
          <li key={s.id}>
            <Link
              to={`/people/students/${s.id}`}
              className="block rounded-xl border border-border bg-surface p-4 active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{s.full_name}</p>
                <StatusBadge status={s.status} />
              </div>
              <p className="mt-1 text-sm text-ink-muted">{s.class_label}</p>
              <p className="mt-1 text-sm text-ink-muted">
                Roll {s.roll_no || '—'} · {s.contact || 'no contact'}
              </p>
            </Link>
          </li>
        ))}
        {data && data.results.length === 0 && (
          <li className="rounded-xl border border-border bg-surface">
            <EmptyState title="No students match" />
          </li>
        )}
      </ul>

      {data && (
        <Pagination
          count={data.count}
          page={page}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          label="students"
        />
      )}

      {enrolling && (
        <StudentModal
          student={null}
          onClose={() => setEnrolling(false)}
          onSaved={(id) => navigate(`/people/students/${id}`)}
        />
      )}
      {promoting && <PromoteModal onClose={() => setPromoting(false)} />}
    </div>
  )
}

/**
 * Bulk promotion. Moving students across academic years also MOVES their
 * outstanding dues into the new year (Y1) — the modal says so up front.
 */
function PromoteModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [source, setSource] = useState<ClassInfoFull | null>(null)
  const [target, setTarget] = useState<ClassInfoFull | null>(null)
  const [status, setStatus] = useState('running')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const roster = useClassStudents(source?.id ?? null)

  const students = roster.data ?? []
  const allPicked = students.length > 0 && students.every((s) => picked.has(s.id))
  const crossYear =
    source?.academic_year && target?.academic_year
      ? source.academic_year !== target.academic_year
      : false

  const promote = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ promoted: number; dues_carried: number }>(
          '/api/v1/people/students/promote/',
          {
            students: [...picked],
            source_class: source!.id,
            target_class: target!.id,
            status,
          },
        )
      ).data,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['academics'] })
      toast.success(
        `Promoted ${res.promoted} student${res.promoted === 1 ? '' : 's'}` +
          (res.dues_carried ? ` · dues carried for ${res.dues_carried}` : '') +
          '.',
      )
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Promote students"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={promote.isPending}
            disabled={!source || !target || source.id === target.id || picked.size === 0}
            onClick={() => promote.mutate()}
          >
            Promote {picked.size || ''} student{picked.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            From
          </h3>
          <ClassPicker
            classId={source?.id ?? ''}
            onChange={(_, cls) => {
              setSource(cls)
              setPicked(new Set())
            }}
          />
        </section>

        {source && (
          <div className="overflow-hidden rounded-xl border border-border">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border bg-surface-muted px-4 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 accent-accent-strong"
                checked={allPicked}
                onChange={() =>
                  setPicked(allPicked ? new Set() : new Set(students.map((s) => s.id)))
                }
              />
              {roster.isLoading
                ? 'Loading students…'
                : `All ${students.length} running student${students.length === 1 ? '' : 's'}`}
            </label>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto">
              {students.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent-strong"
                      checked={picked.has(s.id)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (next.has(s.id)) next.delete(s.id)
                          else next.add(s.id)
                          return next
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{s.full_name}</span>
                    {s.roll_no && (
                      <span className="shrink-0 text-xs text-ink-faint">Roll {s.roll_no}</span>
                    )}
                  </label>
                </li>
              ))}
              {!roster.isLoading && students.length === 0 && (
                <li className="px-4 py-3 text-sm text-ink-muted">
                  No running students in this class.
                </li>
              )}
            </ul>
          </div>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            To
          </h3>
          <div className="space-y-3">
            <ClassPicker classId={target?.id ?? ''} onChange={(_, cls) => setTarget(cls)} />
            <Field label="New status" hint="Passed out marks school-leavers; running is a normal promotion.">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STUDENT_STATUSES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        {crossYear && (
          <p className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
            This promotion crosses academic years: each student's outstanding
            balance moves with them as an opening-balance charge in the new
            year.
          </p>
        )}
      </div>
    </Modal>
  )
}
