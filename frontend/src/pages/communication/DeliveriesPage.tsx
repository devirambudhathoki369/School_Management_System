import { useState } from 'react'
import { useDeliveries } from '../../lib/campus'
import {
  Badge,
  EmptyState,
  Pagination,
  Select,
  SkeletonRows,
} from '../../components/ui'
import { IconMegaphone } from '../../components/icons'

const STATUS_TONE: Record<string, 'accent' | 'positive' | 'danger' | 'warning'> = {
  queued: 'accent',
  sent: 'positive',
  failed: 'danger',
  stale: 'warning',
}

/**
 * Read-only register of every push/SMS the platform queued or delivered.
 * Queued rows drain once a gateway is configured (PUSH_PROVIDER) — the
 * 5-minute beat job does the sending.
 */
export default function DeliveriesPage() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useDeliveries(status, page)

  return (
    <div>
      <div className="mb-4">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          aria-label="Delivery status filter"
          className="w-44"
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="stale">Stale token</option>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : (data?.results ?? []).length === 0 ? (
          <EmptyState
            icon={<IconMegaphone size={22} />}
            title="No deliveries"
            hint="Rows appear as notifications are queued and sent."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(data?.results ?? []).map((d) => (
              <li key={d.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{d.body}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {new Date(d.sent_at).toLocaleString()}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[d.status] ?? 'accent'}>{d.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && (
        <Pagination
          count={data.count}
          page={page}
          pageSize={50}
          onPage={setPage}
          label="deliveries"
        />
      )}
    </div>
  )
}
