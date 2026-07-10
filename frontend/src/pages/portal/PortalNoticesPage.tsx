import { useNotices } from '../../lib/portal'
import { formatDateBS } from '../../lib/format'
import { EmptyState, Skeleton } from '../../components/ui'
import { IconMegaphone } from '../../components/icons'

export default function PortalNoticesPage() {
  const notices = useNotices()

  if (notices.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    )
  }
  const items = notices.data?.notices ?? []
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconMegaphone size={22} />}
        title="No notices"
        hint="School announcements will appear here."
      />
    )
  }
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Notices</h2>
      {items.map((notice) => (
        <article key={notice.id} className="overflow-hidden rounded-xl border border-border bg-surface">
          {notice.image && (
            <img
              src={notice.image}
              alt=""
              loading="lazy"
              className="max-h-72 w-full object-cover"
            />
          )}
          <div className="p-4">
            <p className="text-xs text-ink-muted">{formatDateBS(notice.date_bs)}</p>
            <h3 className="mt-1 text-[15px] font-semibold">{notice.title}</h3>
            {notice.description && (
              <p className="mt-1.5 whitespace-pre-line text-sm text-ink-muted">
                {notice.description}
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
