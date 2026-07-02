import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

type Health = { status: string; checks: Record<string, boolean> }

/**
 * Placeholder dashboard proving the full stack: it calls the Django health
 * endpoint through the API client. Real widgets replace the cards as
 * domain modules land.
 */
export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await api.get<Health>('/health/')).data,
  })

  const apiStatus = isLoading ? 'Checking…' : isError ? 'Unreachable' : data?.status

  const cards = [
    { label: 'API', value: apiStatus ?? '—' },
    { label: 'Database', value: data?.checks.database ? 'Connected' : '—' },
    { label: 'Cache', value: data?.checks.cache ? 'Connected' : '—' },
    { label: 'Version', value: 'v0.1.0' },
  ]

  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm text-ink-muted">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold capitalize">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-border bg-surface p-8 text-center text-ink-muted">
        Domain modules (Academics, People, Billing, …) will populate this
        dashboard as they are built.
      </div>
    </div>
  )
}
