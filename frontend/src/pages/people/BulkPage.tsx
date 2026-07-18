import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { fetchAllPages } from '../../lib/billing'
import ClassPicker from '../../components/ClassPicker'
import {
  Button,
  EmptyState,
  Input,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconPlus, IconTrash, IconStudents } from '../../components/icons'

/**
 * Bulk tools (legacy Enrollment → Bulk): enroll a whole class of new
 * students in one grid, or mass-edit an existing class's fields. Both are
 * clerk-speed screens — tab through cells, one save at the end.
 */

type Mode = 'enroll' | 'update'

interface DraftRow {
  key: number
  first_name: string
  last_name: string
  gender: string
  roll_no: string
  contact: string
}

interface StudentRow {
  id: string
  full_name: string
  gender: string
  status: string
  roll_no: string
  contact: string
}

let rowKey = 1
const blankRow = (): DraftRow => ({
  key: rowKey++, first_name: '', last_name: '', gender: 'male', roll_no: '', contact: '',
})

export default function BulkPage() {
  const [mode, setMode] = useState<Mode>('enroll')
  const [classId, setClassId] = useState('')

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-1 rounded-lg bg-surface-sunken p-1">
          {(['enroll', 'update'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`h-9 rounded-md px-3.5 text-sm font-medium transition-colors ${
                mode === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {m === 'enroll' ? 'Bulk enroll' : 'Bulk update'}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto sm:w-[420px]">
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} />
        </div>
      </div>
      {!classId ? (
        <EmptyState
          icon={<IconStudents size={22} />}
          title="Pick a class"
          hint={
            mode === 'enroll'
              ? 'New students enroll into it in one grid.'
              : 'Its students load for mass editing.'
          }
        />
      ) : mode === 'enroll' ? (
        <EnrollGrid classId={classId} />
      ) : (
        <UpdateGrid classId={classId} />
      )}
    </div>
  )
}

function EnrollGrid({ classId }: { classId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<DraftRow[]>(() => [blankRow(), blankRow(), blankRow()])

  const patch = (key: number, field: keyof DraftRow, value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)))

  const filled = rows.filter((r) => r.first_name.trim() || r.last_name.trim())

  const enroll = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ enrolled: number }>('/api/v1/people/students/bulk-enroll/', {
          class_info: classId,
          rows: filled.map(({ key: _key, ...rest }) => rest),
        })
      ).data,
    onSuccess: (res) => {
      toast.success(`${res.enrolled} students enrolled.`)
      setRows([blankRow(), blankRow(), blankRow()])
      queryClient.invalidateQueries({ queryKey: ['people'] })
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">#</th>
              <th className="px-2 py-2.5 text-left font-medium">First name *</th>
              <th className="px-2 py-2.5 text-left font-medium">Last name *</th>
              <th className="px-2 py-2.5 text-left font-medium">Gender</th>
              <th className="px-2 py-2.5 text-left font-medium">Roll</th>
              <th className="px-2 py-2.5 text-left font-medium">Contact</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5 text-ink-faint">{i + 1}</td>
                <td className="px-1.5 py-1">
                  <Input value={r.first_name} onChange={(e) => patch(r.key, 'first_name', e.target.value)} className="h-9" />
                </td>
                <td className="px-1.5 py-1">
                  <Input value={r.last_name} onChange={(e) => patch(r.key, 'last_name', e.target.value)} className="h-9" />
                </td>
                <td className="px-1.5 py-1">
                  <Select value={r.gender} onChange={(e) => patch(r.key, 'gender', e.target.value)} className="h-9 w-28">
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </Select>
                </td>
                <td className="px-1.5 py-1">
                  <Input value={r.roll_no} onChange={(e) => patch(r.key, 'roll_no', e.target.value)} className="h-9 w-20" />
                </td>
                <td className="px-1.5 py-1">
                  <Input value={r.contact} onChange={(e) => patch(r.key, 'contact', e.target.value)} className="h-9 w-36" />
                </td>
                <td className="px-1.5 py-1">
                  <button
                    aria-label="Remove row"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    className="flex size-8 items-center justify-center rounded-md text-ink-faint hover:text-danger"
                  >
                    <IconTrash size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" onClick={() => setRows((rs) => [...rs, blankRow()])}>
          <IconPlus size={16} /> Add row
        </Button>
        <Button
          className="ml-auto"
          busy={enroll.isPending}
          disabled={filled.length === 0}
          onClick={() => enroll.mutate()}
        >
          Enroll {filled.length || ''} students
        </Button>
      </div>
    </div>
  )
}

function UpdateGrid({ classId }: { classId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const students = useQuery({
    queryKey: ['people', 'students', 'bulk', classId],
    queryFn: () =>
      fetchAllPages<StudentRow>('/api/v1/people/students/', { class_info: classId }),
  })
  const [draft, setDraft] = useState<Record<string, Partial<StudentRow>>>({})

  useEffect(() => setDraft({}), [classId])

  const patch = (id: string, field: keyof StudentRow, value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], [field]: value } }))

  const changes = useMemo(() => {
    const rows = students.data ?? []
    const out: Array<{ id: string; fields: Partial<StudentRow> }> = []
    for (const [id, fields] of Object.entries(draft)) {
      const base = rows.find((r) => r.id === id)
      if (!base) continue
      const delta: Partial<StudentRow> = {}
      for (const [k, v] of Object.entries(fields) as [keyof StudentRow, string][]) {
        if (v !== base[k]) delta[k] = v
      }
      if (Object.keys(delta).length) out.push({ id, fields: delta })
    }
    return out
  }, [draft, students.data])

  const save = useMutation({
    mutationFn: async () => {
      for (const change of changes) {
        await api.patch(`/api/v1/people/students/${change.id}/`, change.fields)
      }
      return changes.length
    },
    onSuccess: (n) => {
      toast.success(`${n} students updated.`)
      setDraft({})
      queryClient.invalidateQueries({ queryKey: ['people'] })
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const rows = students.data ?? []
  if (students.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <SkeletonRows rows={8} />
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState icon={<IconStudents size={22} />} title="No students in this class" />
  }
  const val = (r: StudentRow, k: keyof StudentRow) =>
    (draft[r.id]?.[k] as string | undefined) ?? r[k]

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Student</th>
              <th className="px-2 py-2.5 text-left font-medium">Roll</th>
              <th className="px-2 py-2.5 text-left font-medium">Contact</th>
              <th className="px-2 py-2.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5 font-medium">{r.full_name}</td>
                <td className="px-1.5 py-1">
                  <Input value={val(r, 'roll_no')} onChange={(e) => patch(r.id, 'roll_no', e.target.value)} className="h-9 w-20" />
                </td>
                <td className="px-1.5 py-1">
                  <Input value={val(r, 'contact')} onChange={(e) => patch(r.id, 'contact', e.target.value)} className="h-9 w-40" />
                </td>
                <td className="px-1.5 py-1">
                  <Select value={val(r, 'status')} onChange={(e) => patch(r.id, 'status', e.target.value)} className="h-9 w-36">
                    <option value="running">Running</option>
                    <option value="passed_out">Passed out</option>
                    <option value="dropped_out">Dropped out</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end">
        <Button busy={save.isPending} disabled={changes.length === 0} onClick={() => save.mutate()}>
          Save {changes.length || ''} changes
        </Button>
      </div>
    </div>
  )
}
