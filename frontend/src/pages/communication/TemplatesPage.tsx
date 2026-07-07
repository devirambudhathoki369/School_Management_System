import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { TEMPLATE_KINDS, useTemplates, type MessageTemplateRow } from '../../lib/campus'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconPencil, IconPlus } from '../../components/icons'

/** Message templates the notification jobs merge per recipient. */
export default function TemplatesPage() {
  const templates = useTemplates()
  const [editing, setEditing] = useState<MessageTemplateRow | 'new' | null>(null)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New template
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {templates.isLoading ? (
          <SkeletonRows rows={4} />
        ) : (templates.data ?? []).length === 0 ? (
          <EmptyState
            title="No templates yet"
            hint="Write the SMS/push wording for dues, results and attendance."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(templates.data ?? []).map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <Badge tone="accent">
                    {TEMPLATE_KINDS.find(([v]) => v === t.kind)?.[1] ?? t.kind}
                  </Badge>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{t.body}</p>
                </div>
                <button
                  aria-label="Edit template"
                  onClick={() => setEditing(t)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <TemplateModal
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function TemplateModal({
  template,
  onClose,
}: {
  template: MessageTemplateRow | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState(template?.kind ?? 'dues')
  const [body, setBody] = useState(template?.body ?? '')

  const save = useMutation({
    mutationFn: () =>
      template
        ? api.patch(`/api/v1/communication/templates/${template.id}/`, { kind, body })
        : api.post('/api/v1/communication/templates/', { kind, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communication', 'templates'] })
      toast.success('Template saved.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={template ? 'Edit template' : 'New template'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!body.trim()} onClick={() => save.mutate()}>
            Save template
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {TEMPLATE_KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Body">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-shadow placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
            placeholder="Dear guardian, …"
          />
        </Field>
      </div>
    </Modal>
  )
}
