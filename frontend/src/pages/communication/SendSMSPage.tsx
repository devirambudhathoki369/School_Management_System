import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import ClassPicker from '../../components/ClassPicker'
import {
  Button,
  Field,
  Input,
  Select,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconMegaphone } from '../../components/icons'

/**
 * Outbound SMS (legacy Send Bulk SMS / Send Dues Reminder). Every send logs
 * to Deliveries; until an SMS gateway is configured the console provider
 * records them without transmitting — swap providers in settings, not code.
 */
export default function SendSMSPage() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <FreeFormCard />
      <DuesReminderCard />
    </div>
  )
}

function FreeFormCard() {
  const toast = useToast()
  const [audience, setAudience] = useState<'class' | 'staff' | 'numbers'>('class')
  const [classId, setClassId] = useState('')
  const [numbers, setNumbers] = useState('')
  const [message, setMessage] = useState('')

  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ sent: number }>('/api/v1/communication/sms/send/', {
          message,
          ...(audience === 'class' ? { class_info: classId } : {}),
          ...(audience === 'staff' ? { staff: true } : {}),
          ...(audience === 'numbers'
            ? { numbers: numbers.split(/[\n,]/).map((n) => n.trim()).filter(Boolean) }
            : {}),
        })
      ).data,
    onSuccess: (res) => {
      toast.success(`${res.sent} messages handed to the SMS provider.`)
      setMessage('')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const ready =
    message.trim() &&
    (audience === 'staff' ||
      (audience === 'class' && classId) ||
      (audience === 'numbers' && numbers.trim()))

  return (
    <div className="self-start rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <IconMegaphone size={18} /> Send bulk SMS
      </h3>
      <div className="mt-3 space-y-3">
        <Field label="Send to">
          <Select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
            <option value="class">Guardians of a class</option>
            <option value="staff">All staff</option>
            <option value="numbers">Specific numbers</option>
          </Select>
        </Field>
        {audience === 'class' && (
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} />
        )}
        {audience === 'numbers' && (
          <Field label="Numbers" hint="Comma or newline separated">
            <textarea
              value={numbers}
              onChange={(e) => setNumbers(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
          </Field>
        )}
        <Field label="Message">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={480}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-faint">{message.length}/480</span>
          <Button busy={send.isPending} disabled={!ready} onClick={() => send.mutate()}>
            Send SMS
          </Button>
        </div>
      </div>
    </div>
  )
}

function DuesReminderCard() {
  const toast = useToast()
  const [classId, setClassId] = useState('')
  const [minDues, setMinDues] = useState('1000')
  const [template, setTemplate] = useState('')

  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ sent: number; students: number }>(
          '/api/v1/communication/sms/dues-reminder/',
          {
            ...(classId ? { class_info: classId } : {}),
            min_dues: minDues || '1',
            ...(template.trim() ? { template } : {}),
          },
        )
      ).data,
    onSuccess: (res) =>
      toast.success(`${res.students} guardians reminded (${res.sent} SMS).`),
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="self-start rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-base font-semibold">Dues reminders</h3>
      <p className="mt-0.5 text-xs text-ink-muted">
        One templated SMS per student owing above the threshold. Leave the
        class empty to sweep the whole school.
      </p>
      <div className="mt-3 space-y-3">
        <ClassPicker classId={classId} onChange={(id) => setClassId(id)} allowAnyClass />
        <Field label="Minimum dues (Rs.)">
          <Input
            type="number"
            value={minDues}
            onChange={(e) => setMinDues(e.target.value)}
          />
        </Field>
        <Field label="Template" hint="{name} and {dues} fill in per student; blank uses the default">
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={3}
            placeholder="Dear guardian, {name}'s outstanding dues are Rs. {dues}…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </Field>
        <div className="flex justify-end">
          <Button busy={send.isPending} onClick={() => send.mutate()}>
            Send reminders
          </Button>
        </div>
      </div>
    </div>
  )
}
