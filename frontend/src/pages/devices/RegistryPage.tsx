import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useDevices, type Device } from '../../lib/devices'
import { Badge, Button, EmptyState, SkeletonRows, apiErrorMessage, useToast } from '../../components/ui'
import { IconScan } from '../../components/icons'

/** Every enrolled ZKTeco device: liveness, counters, and a buffered-punch
 * re-upload (the device answers the queued command on its next poll). */
export default function RegistryPage() {
  const devices = useDevices()

  if (devices.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <SkeletonRows rows={4} />
      </div>
    )
  }
  const rows = devices.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<IconScan size={22} />}
        title="No devices enrolled"
        hint="Point a ZKTeco device's push server at this system and it registers itself on first contact."
      />
    )
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((device) => (
        <DeviceCard key={device.id} device={device} />
      ))}
    </div>
  )
}

function lastSeenLabel(iso: string | null): { text: string; live: boolean } {
  if (!iso) return { text: 'never seen', live: false }
  const minutes = (Date.now() - new Date(iso).getTime()) / 60_000
  if (minutes < 10) return { text: 'online', live: true }
  if (minutes < 90) return { text: `seen ${Math.round(minutes)} min ago`, live: false }
  return { text: `seen ${new Date(iso).toLocaleString()}`, live: false }
}

function DeviceCard({ device }: { device: Device }) {
  const toast = useToast()
  const pull = useMutation({
    mutationFn: () => api.post(`/api/v1/devices/devices/${device.id}/pull-logs/`),
    onSuccess: () =>
      toast.success('Re-upload queued — the device sends its logs on the next poll.'),
    onError: (error) => toast.error(apiErrorMessage(error)),
  })
  const seen = lastSeenLabel(device.last_seen)

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {device.alias || device.device_type || 'Device'}
          </p>
          <p className="mt-0.5 font-mono text-xs text-ink-muted">{device.serial_number}</p>
        </div>
        <Badge tone={seen.live ? 'positive' : 'neutral'}>{seen.text}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-ink-muted sm:grid-cols-4">
        <Metric label="Users" value={device.user_count} />
        <Metric label="Punches" value={device.trans_count} />
        <Metric label="Fingerprints" value={device.fp_count} />
        <Metric label="Faces" value={device.face_count} />
      </dl>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="truncate text-xs text-ink-faint">
          {[device.firmware && `fw ${device.firmware}`, device.ip_address]
            .filter(Boolean)
            .join(' · ') || '—'}
        </p>
        <Button variant="secondary" busy={pull.isPending} onClick={() => pull.mutate()}>
          Pull logs
        </Button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  )
}
