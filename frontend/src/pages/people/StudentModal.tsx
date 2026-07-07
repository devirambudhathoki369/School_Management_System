import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { GENDERS, STUDENT_STATUSES, type StudentFull } from '../../lib/people'
import ClassPicker from '../../components/ClassPicker'
import {
  Button,
  Field,
  Input,
  Modal,
  Select,
  apiErrorMessage,
  useToast,
} from '../../components/ui'

/**
 * Create/edit a student. One form for both paths so enrolment and later
 * corrections stay consistent. The class picker carries the academic year:
 * the enrolment year is always the chosen class's year (never free-typed).
 */
export default function StudentModal({
  student,
  onClose,
  onSaved,
}: {
  student: StudentFull | null
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    first_name: student?.first_name ?? '',
    middle_name: student?.middle_name ?? '',
    last_name: student?.last_name ?? '',
    gender: student?.gender ?? '',
    birth_date_bs: student?.birth_date_bs ?? '',
    blood_group: student?.blood_group ?? '',
    ethnicity: student?.ethnicity ?? '',
    status: student?.status ?? 'running',
    roll_no: student?.roll_no ?? '',
    symbol_no: student?.symbol_no ?? '',
    regd_no: student?.regd_no ?? '',
    emis: student?.emis ?? '',
    rfid_card: student?.rfid_card ?? '',
    contact: student?.contact ?? '',
    email: student?.email ?? '',
    address: student?.address ?? '',
    previous_school: student?.previous_school ?? '',
    remarks: student?.remarks ?? '',
  })
  const [classId, setClassId] = useState(student?.class_info ?? '')
  const [yearId, setYearId] = useState(student?.academic_year ?? '')

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, class_info: classId, academic_year: yearId }
      if (student) {
        return (await api.patch<StudentFull>(`/api/v1/people/students/${student.id}/`, payload)).data
      }
      return (await api.post<StudentFull>('/api/v1/people/students/', payload)).data
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      toast.success(student ? 'Student updated.' : 'Student enrolled.')
      onSaved?.(saved.id)
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid =
    form.first_name.trim() && form.last_name.trim() && form.gender && classId && yearId

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={student ? `Edit ${student.first_name} ${student.last_name}` : 'Enrol a student'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {student ? 'Save changes' : 'Enrol student'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Identity
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="First name">
              <Input value={form.first_name} onChange={set('first_name')} autoFocus />
            </Field>
            <Field label="Middle name">
              <Input value={form.middle_name} onChange={set('middle_name')} />
            </Field>
            <Field label="Last name">
              <Input value={form.last_name} onChange={set('last_name')} />
            </Field>
            <Field label="Gender">
              <Select value={form.gender} onChange={set('gender')}>
                <option value="">Choose…</option>
                {GENDERS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Birth date (BS)">
              <Input value={form.birth_date_bs} onChange={set('birth_date_bs')} placeholder="2070-01-15" />
            </Field>
            <Field label="Blood group">
              <Input value={form.blood_group} onChange={set('blood_group')} placeholder="A+" />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Enrolment
          </h3>
          <div className="space-y-3">
            <ClassPicker
              classId={classId}
              initialYearId={student?.academic_year}
              currentLabel={student?.class_label}
              onChange={(id, cls) => {
                setClassId(id)
                if (cls?.academic_year) setYearId(cls.academic_year)
                else if (student && id === student.class_info) setYearId(student.academic_year)
              }}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Status">
                <Select value={form.status} onChange={set('status')}>
                  {STUDENT_STATUSES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Roll no">
                <Input value={form.roll_no} onChange={set('roll_no')} />
              </Field>
              <Field label="Symbol no">
                <Input value={form.symbol_no} onChange={set('symbol_no')} />
              </Field>
              <Field label="Registration no">
                <Input value={form.regd_no} onChange={set('regd_no')} />
              </Field>
              <Field label="EMIS">
                <Input value={form.emis} onChange={set('emis')} />
              </Field>
              <Field label="RFID card">
                <Input value={form.rfid_card} onChange={set('rfid_card')} />
              </Field>
              <Field label="Ethnicity" className="col-span-2">
                <Input value={form.ethnicity} onChange={set('ethnicity')} />
              </Field>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Contact
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Phone">
              <Input value={form.contact} onChange={set('contact')} inputMode="tel" />
            </Field>
            <Field label="Email">
              <Input value={form.email} onChange={set('email')} type="email" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input value={form.address} onChange={set('address')} />
            </Field>
            <Field label="Previous school">
              <Input value={form.previous_school} onChange={set('previous_school')} />
            </Field>
            <Field label="Remarks">
              <Input value={form.remarks} onChange={set('remarks')} />
            </Field>
          </div>
        </section>
      </div>
    </Modal>
  )
}
