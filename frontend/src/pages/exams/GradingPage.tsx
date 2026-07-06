import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  SCHEME_LABEL,
  useGradingSchemes,
  type GradeBand,
  type GradingScheme,
} from '../../lib/exams'
import {
  AmountInput,
  Button,
  EmptyState,
  Input,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconPlus, IconSliders, IconTrash } from '../../components/icons'

/**
 * Grading bands: how a score range reads on a marksheet (remarks, letter
 * grades or divisions). One scheme per type per school; the national GPA
 * bands are built into the engine — these are the school's own labels.
 */

const TYPES: GradingScheme['type'][] = ['number', 'grading', 'division']

export default function GradingPage() {
  const schemes = useGradingSchemes()

  if (schemes.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <SkeletonRows rows={6} />
      </div>
    )
  }

  const byType = new Map((schemes.data ?? []).map((s) => [s.type, s]))

  return (
    <div className="grid items-start gap-5 lg:grid-cols-3">
      {TYPES.map((type) => (
        <SchemePanel key={type} type={type} scheme={byType.get(type) ?? null} />
      ))}
    </div>
  )
}

function SchemePanel({ type, scheme }: { type: GradingScheme['type']; scheme: GradingScheme | null }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [bands, setBands] = useState<GradeBand[]>(scheme?.bands ?? [])
  const [dirty, setDirty] = useState(false)

  function patch(index: number, changes: Partial<GradeBand>) {
    setDirty(true)
    setBands((bs) => bs.map((b, i) => (i === index ? { ...b, ...changes } : b)))
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        type,
        bands: bands.map(({ min_score, max_score, remarks }) => ({ min_score, max_score, remarks })),
      }
      if (scheme) return api.patch(`/api/v1/examinations/grading-schemes/${scheme.id}/`, payload)
      return api.post('/api/v1/examinations/grading-schemes/', payload)
    },
    onSuccess: () => {
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['exams', 'grading-schemes'] })
      toast.success(`${SCHEME_LABEL[type]} bands saved.`)
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = bands.every(
    (b) => b.min_score !== '' && b.max_score !== '' && Number(b.min_score) <= Number(b.max_score) && b.remarks.trim(),
  )

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{SCHEME_LABEL[type]}</h2>
        <Button
          variant="secondary"
          onClick={() => {
            setDirty(true)
            setBands((bs) => [...bs, { min_score: '', max_score: '', remarks: '' }])
          }}
        >
          <IconPlus size={15} /> Band
        </Button>
      </div>

      {bands.length === 0 ? (
        <EmptyState
          icon={<IconSliders size={20} />}
          title="No bands"
          hint="e.g. 80–100 “Distinction”"
        />
      ) : (
        <ul className="divide-y divide-border">
          {bands.map((band, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-2.5">
              <AmountInput
                value={band.min_score}
                aria-label="Minimum score"
                placeholder="Min"
                className="w-16 px-2"
                onChange={(e) => patch(i, { min_score: e.target.value })}
              />
              <span className="text-ink-faint">–</span>
              <AmountInput
                value={band.max_score}
                aria-label="Maximum score"
                placeholder="Max"
                className="w-16 px-2"
                onChange={(e) => patch(i, { max_score: e.target.value })}
              />
              <Input
                value={band.remarks}
                aria-label="Label"
                placeholder="Label"
                onChange={(e) => patch(i, { remarks: e.target.value })}
              />
              <button
                aria-label="Remove band"
                onClick={() => {
                  setDirty(true)
                  setBands((bs) => bs.filter((_, j) => j !== i))
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <IconTrash size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {dirty && (
        <div className="border-t border-border px-4 py-3">
          <Button className="w-full" busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            Save {SCHEME_LABEL[type].toLowerCase()}
          </Button>
        </div>
      )}
    </section>
  )
}
