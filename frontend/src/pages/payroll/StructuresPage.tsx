import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useStaffStructures } from '../../lib/payroll'
import { formatDateBS, formatMoney, sumAmounts } from '../../lib/format'
import StaffSelect from '../../components/StaffSelect'
import {
  AmountInput,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconPlus, IconSliders } from '../../components/icons'

/**
 * Salary structures: the agreed terms, versioned by effective date. A raise
 * is a NEW row effective from a date — history is never overwritten, so old
 * payslips always reconcile against the terms of their time.
 */

export default function StructuresPage() {
  const [staff, setStaff] = useState('')
  const [adding, setAdding] = useState(false)
  const structures = useStaffStructures(staff || null)
  const rows = structures.data ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <StaffSelect value={staff} onChange={setStaff} autoFocus />
        </div>
        {staff && (
          <Button onClick={() => setAdding(true)}>
            <IconPlus size={16} /> New version
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!staff ? (
          <EmptyState
            icon={<IconSliders size={22} />}
            title="Pick a staff member"
            hint="Their salary terms, newest first. Payroll runs pre-fill from the current version."
          />
        ) : structures.isLoading ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No salary structure yet"
            hint="Payroll runs need the agreed amounts per earning head."
            action={
              <Button onClick={() => setAdding(true)}>
                <IconPlus size={16} /> Set the terms
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((s, i) => {
              const monthly = sumAmounts([s.basic_salary, s.grade, s.allowance, s.extra])
              return (
                <li key={s.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      Effective {formatDateBS(s.effective_from_bs)}
                      {i === 0 && (
                        <span className="ml-2 align-middle">
                          <Badge tone="positive">current</Badge>
                        </span>
                      )}
                    </p>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatMoney(monthly)}<span className="text-xs font-normal text-ink-faint">/month</span>
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    Basic {formatMoney(s.basic_salary)} · Grade {formatMoney(s.grade)} · Allowance{' '}
                    {formatMoney(s.allowance)} · Extra {formatMoney(s.extra)}
                    {Number(s.pf_contribution) > 0 && <> · PF {formatMoney(s.pf_contribution)}</>}
                    {Number(s.insurance) > 0 && <> · Insurance {formatMoney(s.insurance)}</>}
                    {s.pan_no && <> · PAN {s.pan_no}</>}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {adding && staff && <StructureModal staff={staff} onClose={() => setAdding(false)} />}
    </div>
  )
}

function StructureModal({ staff, onClose }: { staff: string; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [basic, setBasic] = useState('')
  const [grade, setGrade] = useState('')
  const [allowance, setAllowance] = useState('')
  const [extra, setExtra] = useState('')
  const [pf, setPf] = useState('')
  const [insurance, setInsurance] = useState('')
  const [pan, setPan] = useState('')

  const save = useMutation({
    mutationFn: () =>
      api.post('/api/v1/payroll/structures/', {
        staff,
        effective_from_bs: effectiveFrom,
        basic_salary: basic || '0',
        grade: grade || '0',
        allowance: allowance || '0',
        extra: extra || '0',
        pf_contribution: pf || '0',
        insurance: insurance || '0',
        pan_no: pan,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'structures'] })
      toast.success('Salary structure saved.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const total = sumAmounts([basic, grade, allowance, extra])

  return (
    <Modal
      open
      onClose={onClose}
      title="New salary structure"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!effectiveFrom || total <= 0}
            onClick={() => save.mutate()}
          >
            Save — Rs. {formatMoney(total)}/month
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Effective from (BS)" hint="Earlier versions stay on record for old payslips.">
          <Input value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} placeholder="2083-04-01" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Basic salary">
            <AmountInput value={basic} onChange={(e) => setBasic(e.target.value)} />
          </Field>
          <Field label="Grade">
            <AmountInput value={grade} onChange={(e) => setGrade(e.target.value)} />
          </Field>
          <Field label="Allowance">
            <AmountInput value={allowance} onChange={(e) => setAllowance(e.target.value)} />
          </Field>
          <Field label="Extra">
            <AmountInput value={extra} onChange={(e) => setExtra(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="PF / month">
            <AmountInput value={pf} onChange={(e) => setPf(e.target.value)} />
          </Field>
          <Field label="Insurance / month">
            <AmountInput value={insurance} onChange={(e) => setInsurance(e.target.value)} />
          </Field>
          <Field label="PAN">
            <Input value={pan} onChange={(e) => setPan(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
