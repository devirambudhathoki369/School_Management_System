import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

interface StudentRow {
  id: string
  full_name: string
  gender: string
  status: string
  roll_no: string
  class_label: string
  contact: string
}

interface Page {
  count: number
  results: StudentRow[]
}

const PAGE_SIZE = 50

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-accent-soft text-accent-strong',
  passed_out: 'bg-emerald-50 text-positive',
  dropped_out: 'bg-amber-50 text-warning',
}

/**
 * Students directory. Responsive by layout swap: a data table from `md` up,
 * stacked cards below (tables don't shrink; cards do).
 */
export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['students', query, page],
    queryFn: async () =>
      (
        await api.get<Page>('/api/v1/people/students/', {
          params: { search: query || undefined, page },
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  const pages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return (
    <div className="mx-auto max-w-6xl">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          setQuery(search)
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or roll no…"
          className="h-11 w-full max-w-sm rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong"
        >
          Search
        </button>
      </form>

      {isError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">
          Could not load students. Check your permissions and try again.
        </p>
      )}

      {/* Table (md and up) */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Class</th>
              <th className="px-4 py-3 font-medium">Roll</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.results ?? []).map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                <td className="px-4 py-3 font-medium">{s.full_name}</td>
                <td className="px-4 py-3 text-ink-muted">{s.class_label}</td>
                <td className="px-4 py-3 text-ink-muted">{s.roll_no || '—'}</td>
                <td className="px-4 py-3 text-ink-muted">{s.contact || '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards (below md) */}
      <ul className="space-y-3 md:hidden">
        {(data?.results ?? []).map((s) => (
          <li key={s.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{s.full_name}</p>
              <StatusBadge status={s.status} />
            </div>
            <p className="mt-1 text-sm text-ink-muted">{s.class_label}</p>
            <p className="mt-1 text-sm text-ink-muted">
              Roll {s.roll_no || '—'} · {s.contact || 'no contact'}
            </p>
          </li>
        ))}
      </ul>

      {isLoading && <p className="py-8 text-center text-ink-muted">Loading…</p>}
      {data && data.results.length === 0 && (
        <p className="py-8 text-center text-ink-muted">No students match.</p>
      )}

      {data && data.count > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-ink-muted">
            {data.count.toLocaleString()} students · page {page} of {pages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="h-10 rounded-lg border border-border px-4 font-medium disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="h-10 rounded-lg border border-border px-4 font-medium disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? 'bg-surface-sunken text-ink-muted'
      }`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
