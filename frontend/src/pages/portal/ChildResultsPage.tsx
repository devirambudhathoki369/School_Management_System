import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { useChildResults, type PortalChild, type ResultExam } from '../../lib/portal'
import { formatDateBS } from '../../lib/format'
import { Badge, EmptyState, Skeleton } from '../../components/ui'
import { IconChevronDown, IconClipboard } from '../../components/icons'

/** Published exams only (E1) — newest first, expandable per-subject marks. */
export default function ChildResultsPage() {
  const { childId } = useParams()
  const child = useOutletContext<PortalChild>()
  const results = useChildResults(childId!)

  if (results.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    )
  }
  const exams = results.data?.exams ?? []
  if (exams.length === 0) {
    return (
      <EmptyState
        icon={<IconClipboard size={22} />}
        title="No published results yet"
        hint={`Results appear here as soon as the school publishes ${child.first_name}'s marks.`}
      />
    )
  }
  return (
    <div className="space-y-3">
      {exams.map((exam) => (
        <ExamCard key={exam.exam_id} exam={exam} />
      ))}
    </div>
  )
}

function ExamCard({ exam }: { exam: ResultExam }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{exam.exam_name}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {exam.academic_year_name} · published {formatDateBS(exam.published_date_bs)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">
            {exam.percentage != null ? `${exam.percentage}%` : '—'}
          </p>
          <Badge tone={exam.all_passed ? 'positive' : 'danger'}>
            {exam.all_passed ? 'Passed' : 'Needs attention'}
          </Badge>
        </div>
        <IconChevronDown
          size={16}
          className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 text-xs text-ink-muted">
            <span>
              Total <span className="font-semibold text-ink">{exam.total}</span> /{' '}
              {exam.full_marks}
            </span>
            {exam.position_in_section != null && (
              <span>
                Section rank <span className="font-semibold text-ink">{exam.position_in_section}</span>
              </span>
            )}
            {exam.position_in_class != null && (
              <span>
                Class rank <span className="font-semibold text-ink">{exam.position_in_class}</span>
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-border bg-surface-sunken text-left text-xs text-ink-faint">
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-3 py-2 text-right font-medium">Theory</th>
                  <th className="px-3 py-2 text-right font-medium">Practical</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">FM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {exam.subjects.map((subject) => (
                  <tr
                    key={subject.subject}
                    className={subject.passed ? '' : 'text-danger'}
                  >
                    <td className="px-4 py-2">
                      {subject.subject}
                      {subject.absent && (
                        <span className="ml-2 align-middle">
                          <Badge tone="warning">absent</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {subject.theory ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {subject.practical ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {subject.total}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                      {subject.full_marks}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
