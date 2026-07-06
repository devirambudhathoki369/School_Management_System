import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  useAcademicYears,
  useFeeTitles,
  useStudentDiscounts,
  type StandingDiscount,
  type StudentRow,
} from '../../lib/billing'
import { formatMoney } from '../../lib/format'
import StudentPicker from '../../components/StudentPicker'
import {
  AmountInput,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconPencil, IconPercent, IconPlus, IconTrash } from '../../components/icons'

/**
 * Standing discounts (D-rules): recurring per-student concessions applied
 * automatically at receipt time. When both a percentage and a flat amount
 * are set, the PERCENTAGE wins — the flat value is only a cached derivation
 * (verified against 18,902 legacy rows).
 */

export default function DiscountsPage() {
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [editing, setEditing] = useState<StandingDiscount | 'new' | null>(null)
  const toast = useToast()
  const queryClient = useQueryClient()

  const discounts = useStudentDiscounts(student?.id ?? null)
  const titles = useFeeTitles()
  const titleName = useMemo(() => {
    const map = new Map((titles.data ?? []).map((t) => [t.id, t.name]))
    return (id: string | null) => (id === null ? 'Transport (bus fee)' : (map.get(id) ?? '—'))
  }, [titles.data])

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/billing/discounts/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'discounts'] })
      toast.success('Discount removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <StudentPicker value={student} onChange={setStudent} placeholder="Find the student…" autoFocus />
        </div>
        {student && (
          <Button onClick={() => setEditing('new')}>
            <IconPlus size={16} /> New discount
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!student ? (
          <EmptyState
            icon={<IconPercent size={22} />}
            title="Pick a student"
            hint="Standing discounts apply automatically every time a receipt is collected for the student."
          />
        ) : discounts.isLoading ? (
          <SkeletonRows rows={4} />
        ) : (discounts.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<IconPercent size={22} />}
            title={`No discounts for ${student.full_name}`}
            action={
              <Button onClick={() => setEditing('new')}>
                <IconPlus size={16} /> Grant a discount
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {discounts.data!.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{titleName(d.fee_title)}</p>
                  {d.remarks && <p className="mt-0.5 truncate text-xs text-ink-muted">{d.remarks}</p>}
                </div>
                <Badge tone="positive">
                  {d.percentage !== null
                    ? `${Number(d.percentage)}%`
                    : `Rs. ${formatMoney(d.flat_amount)}`}
                </Badge>
                <button
                  aria-label="Edit discount"
                  onClick={() => setEditing(d)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <button
                  aria-label="Delete discount"
                  onClick={() => {
                    if (window.confirm(`Remove this discount on ${titleName(d.fee_title)}?`))
                      remove.mutate(d.id)
                  }}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && student && (
        <DiscountModal
          student={student}
          discount={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function DiscountModal({
  student,
  discount,
  onClose,
}: {
  student: StudentRow
  discount: StandingDiscount | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const titles = useFeeTitles()
  const years = useAcademicYears()

  const TRANSPORT = '__transport__'
  const [feeTitle, setFeeTitle] = useState(discount ? (discount.fee_title ?? TRANSPORT) : '')
  const [percentage, setPercentage] = useState(discount?.percentage ?? '')
  const [flat, setFlat] = useState(discount?.flat_amount ?? '')
  const [academicYear, setAcademicYear] = useState(discount?.academic_year ?? '')
  const [remarks, setRemarks] = useState(discount?.remarks ?? '')

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        student: student.id,
        fee_title: feeTitle === TRANSPORT ? null : feeTitle,
        percentage: percentage === '' ? null : percentage,
        flat_amount: flat === '' ? null : flat,
        academic_year: academicYear || null,
        remarks,
      }
      if (discount) return api.patch(`/api/v1/billing/discounts/${discount.id}/`, payload)
      return api.post('/api/v1/billing/discounts/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'discounts'] })
      toast.success(discount ? 'Discount updated.' : `Discount granted to ${student.full_name}.`)
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = feeTitle !== '' && (percentage !== '' || flat !== '')

  return (
    <Modal
      open
      onClose={onClose}
      title={discount ? 'Edit discount' : `Discount for ${student.full_name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {discount ? 'Save changes' : 'Grant discount'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Applies to">
          <Select value={feeTitle} onChange={(e) => setFeeTitle(e.target.value)} autoFocus>
            <option value="">Choose a fee…</option>
            <option value={TRANSPORT}>Transport (bus fee)</option>
            {(titles.data ?? [])
              .filter((t) => t.kind === 'regular')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Percentage (%)">
            <AmountInput value={percentage ?? ''} onChange={(e) => setPercentage(e.target.value)} max="100" />
          </Field>
          <Field label="Flat amount (Rs.)">
            <AmountInput value={flat ?? ''} onChange={(e) => setFlat(e.target.value)} />
          </Field>
        </div>
        {percentage !== '' && flat !== '' && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            Both set: the percentage wins at receipt time; the flat amount is ignored.
          </p>
        )}

        <Field label="Academic year" hint="Leave open-ended to keep the discount across years.">
          <Select value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}>
            <option value="">Every year</option>
            {(years.data ?? [])
              .filter((y) => !y.closed)
              .map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
          </Select>
        </Field>

        <Field label="Remarks">
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Scholarship, sibling, staff ward…" />
        </Field>
      </div>
    </Modal>
  )
}
