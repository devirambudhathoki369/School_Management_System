import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Paginated } from '../../lib/billing'
import {
  Badge,
  EmptyState,
  Field,
  Input,
  Pagination,
  Select,
  SkeletonRows,
} from '../../components/ui'
import { IconChevronDown, IconShield } from '../../components/icons'

/**
 * The append-only audit trail (admins only): who did what, when, from where.
 * 664k legacy events plus everything the new platform writes — the DB
 * refuses updates and deletes below the ORM, so this view is trustworthy.
 */

interface AuditEvent {
  id: string
  at: string
  actor: string | null
  actor_name: string
  action: 'create' | 'update' | 'soft_delete' | 'login' | 'read_sensitive'
  object_table: string
  object_id: string
  changes: unknown
  ip_address: string | null
}

const ACTION_TONE: Record<AuditEvent['action'], 'positive' | 'accent' | 'danger' | 'neutral' | 'warning'> = {
  create: 'positive',
  update: 'accent',
  soft_delete: 'danger',
  login: 'neutral',
  read_sensitive: 'warning',
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [table, setTable] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const events = useQuery({
    queryKey: ['audit', page, action, table],
    queryFn: async () =>
      (
        await api.get<Paginated<AuditEvent>>('/api/v1/audit/events/', {
          params: {
            page,
            ...(action ? { action } : {}),
            ...(table.trim() ? { object_table: table.trim() } : {}),
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:max-w-lg">
        <Field label="Action">
          <Select
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="soft_delete">Soft delete</option>
            <option value="login">Login</option>
            <option value="read_sensitive">Sensitive read</option>
          </Select>
        </Field>
        <Field label="Record table" hint="Exact table, e.g. legacy:main.student">
          <Input
            value={table}
            onChange={(e) => {
              setTable(e.target.value)
              setPage(1)
            }}
            placeholder="all tables"
          />
        </Field>
      </div>

      {events.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={10} />
        </div>
      ) : (events.data?.results ?? []).length === 0 ? (
        <EmptyState
          icon={<IconShield size={22} />}
          title="No matching events"
          hint="Loosen the filters — every platform action lands in this trail."
        />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {events.data!.results.map((event) => {
              const open = expanded === event.id
              const hasChanges =
                event.changes != null && Object.keys(event.changes as object).length > 0
              return (
                <li key={event.id}>
                  <button
                    onClick={() => setExpanded(open ? null : event.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted"
                  >
                    <Badge tone={ACTION_TONE[event.action]}>
                      {event.action.replace('_', ' ')}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium">{event.actor_name || 'system'}</span>
                        <span className="text-ink-muted"> · {event.object_table}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {new Date(event.at).toLocaleString()}
                        {event.ip_address ? ` · ${event.ip_address}` : ''}
                        {` · ${event.object_id}`}
                      </p>
                    </div>
                    {hasChanges && (
                      <IconChevronDown
                        size={14}
                        className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>
                  {open && hasChanges && (
                    <pre className="overflow-x-auto border-t border-border bg-surface-sunken px-4 py-3 text-xs leading-relaxed text-ink-muted">
                      {JSON.stringify(event.changes, null, 2)}
                    </pre>
                  )}
                </li>
              )
            })}
          </ul>
          <Pagination
            count={events.data!.count}
            page={page}
            pageSize={50}
            onPage={setPage}
            label="events"
          />
        </>
      )}
    </div>
  )
}
