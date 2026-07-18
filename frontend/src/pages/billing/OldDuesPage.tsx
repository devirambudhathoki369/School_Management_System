import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAcademicYearsFull } from '../../lib/academics'
import { currentBillingYear, useBillingYears, useCalendar } from '../../lib/billing'
import { useStudentLedgersReport } from '../../lib/reports'
import ClassPicker from '../../components/ClassPicker'
import {
  AmountInput,
  Button,
  EmptyState,
  Field,
  Input,
  Money,
  Select,
  SkeletonRows,
  StatCard,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconWallet } from '../../components/icons'

/**
 * Old-dues posting (legacy leaf): balances students carried from BEFORE the
 * system, charged as one OLD_DUES line each. The grid shows each student's
 * current balance so double-posting is obvious at a glance.
 */
export default function OldDuesPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const years = useAcademicYearsFull()
  const calendar = useCalendar()
  const billingYears = useBillingYears()
  const [yearId, setYearId] = useState('')
  const [classId, setClassId] = useState('')
  const [dateBs, setDateBs] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [remarks, setRemarks] = useState<Record<string, string>>({})

  const ledgers = useStudentLedgersReport(
    { academic_year: yearId, class_info: classId },
    !!yearId && !!classId,
  )
  const billingYear = currentBillingYear(billingYears.data, calendar.data?.today_bs)
  const effectiveDate = dateBs || calendar.data?.today_bs || ''

  const rows = ledgers.data?.rows ?? []
  const toPost = useMemo(
    () =>
      rows
        .map((r) => ({
          student: r.student_id,
          amount: (amounts[r.student_id] || '').trim(),
          remarks: (remarks[r.student_id] || '').trim(),
        }))
        .filter((e) => e.amount && Number(e.amount) > 0),
    [rows, amounts, remarks],
  )
  const totalToPost = toPost.reduce((s, e) => s + Number(e.amount), 0)

  const post = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ posted: number }>('/api/v1/billing/charges/post-old-dues/', {
          academic_year: yearId,
          billing_year: billingYear!.id,
          date_bs: effectiveDate,
          entries: toPost,
        })
      ).data,
    onSuccess: (res) => {
      toast.success(`${res.posted} old-dues charges posted.`)
      setAmounts({})
      setRemarks({})
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Academic year">
          <Select
            value={yearId}
            onChange={(e) => {
              setYearId(e.target.value)
              setClassId('')
            }}
          >
            <option value="">
              {years.isLoading ? 'Loading years…' : 'Choose a year…'}
            </option>
            {(years.data ?? []).map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.closed ? ' (closed)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <ClassPicker
          classId={classId}
          onChange={(id) => setClassId(id)}
          yearId={yearId}
        />
        <Field label="Posting date (BS)">
          <Input
            value={dateBs}
            onChange={(e) => setDateBs(e.target.value)}
            placeholder={calendar.data?.today_bs ?? 'YYYY-MM-DD'}
          />
        </Field>
        <Field label="Fiscal year">
          <Input value={billingYear?.name ?? '—'} disabled />
        </Field>
      </div>

      {toPost.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
          <StatCard label="Students to charge" value={toPost.length} tone="accent" icon={<IconWallet size={16} />} />
          <StatCard label="Old dues total" value={<Money value={totalToPost} />} tone="warning" />
        </div>
      )}

      {!yearId || !classId ? (
        <EmptyState
          icon={<IconWallet size={22} />}
          title="Pick a year and a class"
          hint="Enter each student's pre-system balance; blank rows are skipped."
        />
      ) : ledgers.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={8} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconWallet size={22} />} title="No students in this class" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Student</th>
                  <th className="px-3 py-2.5 text-right font-medium">Current balance</th>
                  <th className="px-3 py-2.5 text-right font-medium">Old dues (Rs.)</th>
                  <th className="px-3 py-2.5 text-left font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.student_id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      <Money value={r.balance} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <AmountInput
                        value={amounts[r.student_id] ?? ''}
                        onChange={(e) =>
                          setAmounts((a) => ({ ...a, [r.student_id]: e.target.value }))
                        }
                        className="ml-auto h-9 w-32 text-right"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={remarks[r.student_id] ?? ''}
                        onChange={(e) =>
                          setRemarks((m) => ({ ...m, [r.student_id]: e.target.value }))
                        }
                        placeholder="Optional"
                        className="h-9"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              busy={post.isPending}
              disabled={toPost.length === 0 || !billingYear || !effectiveDate}
              onClick={() => post.mutate()}
            >
              Post {toPost.length || ''} old-dues {toPost.length === 1 ? 'charge' : 'charges'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
