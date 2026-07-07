import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  useInventoryCategories,
  useInventoryItems,
  type InventoryItem,
} from '../../lib/campus'
import {
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
import { IconPackage, IconPencil, IconPlus, IconTrash } from '../../components/icons'

/**
 * Stock on hand. The level is never stored — it is the signed sum of every
 * movement (purchase +, issue −, wastage −, adjustment signed), so this
 * list is always consistent with the movements register.
 */
export default function StockPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const items = useInventoryItems()
  const categories = useInventoryCategories()
  const [categoryFilter, setCategoryFilter] = useState('')
  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null)
  const [managingCategories, setManagingCategories] = useState(false)

  const rows = useMemo(
    () =>
      (items.data ?? []).filter((i) => !categoryFilter || i.category === categoryFilter),
    [items.data, categoryFilter],
  )

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/inventory/items/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success('Item removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Category filter"
          className="w-48"
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => setManagingCategories(true)}>
          Categories
        </Button>
        <div className="flex-1" />
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New item
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {items.isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconPackage size={22} />}
            title="No items"
            hint="Track lab gear, stationery, sports kit — anything the school owns."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((i) => {
              const stock = i.stock === null ? 0 : Number(i.stock)
              const low =
                i.reorder_level !== null && stock <= Number(i.reorder_level)
              return (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {[i.category_name, i.unit].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {low && <Badge tone="warning">low stock</Badge>}
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      stock < 0 ? 'text-danger' : ''
                    }`}
                  >
                    {stock.toLocaleString('en-IN')}
                    {i.unit && <span className="ml-1 text-xs font-normal text-ink-faint">{i.unit}</span>}
                  </span>
                  <button
                    aria-label={`Edit ${i.name}`}
                    onClick={() => setEditing(i)}
                    className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                  >
                    <IconPencil size={16} />
                  </button>
                  <button
                    aria-label={`Delete ${i.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete item “${i.name}”?`)) remove.mutate(i.id)
                    }}
                    className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
                  >
                    <IconTrash size={16} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {editing && (
        <ItemModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {managingCategories && <CategoriesModal onClose={() => setManagingCategories(false)} />}
    </div>
  )
}

function ItemModal({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const categories = useInventoryCategories()
  const [form, setForm] = useState({
    name: item?.name ?? '',
    category: item?.category ?? '',
    unit: item?.unit ?? '',
    reorder_level: item?.reorder_level ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        category: form.category || null,
        unit: form.unit,
        reorder_level: form.reorder_level || null,
      }
      return item
        ? api.patch(`/api/v1/inventory/items/${item.id}/`, payload)
        : api.post('/api/v1/inventory/items/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success(item ? 'Item updated.' : 'Item created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? `Edit ${item.name}` : 'New item'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
            {item ? 'Save changes' : 'Create item'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={set('name')} autoFocus placeholder="Whiteboard marker" />
        </Field>
        <Field label="Category">
          <Select value={form.category} onChange={set('category')}>
            <option value="">—</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit">
            <Input value={form.unit} onChange={set('unit')} placeholder="pcs / kg / ltr" />
          </Field>
          <Field label="Reorder level" hint="Flags the item when stock falls to this.">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.reorder_level ?? ''}
              onChange={set('reorder_level')}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function CategoriesModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const categories = useInventoryCategories()
  const [name, setName] = useState('')

  const add = useMutation({
    mutationFn: () => api.post('/api/v1/inventory/categories/', { name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'categories'] })
      setName('')
      toast.success('Category added.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/inventory/categories/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success('Category removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal open onClose={onClose} title="Categories">
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) add.mutate()
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stationery"
            aria-label="New category name"
            autoFocus
          />
          <Button type="submit" busy={add.isPending} disabled={!name.trim()}>
            <IconPlus size={16} /> Add
          </Button>
        </form>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {(categories.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <button
                aria-label={`Delete ${c.name}`}
                onClick={() => remove.mutate(c.id)}
                className="flex size-8 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <IconTrash size={14} />
              </button>
            </li>
          ))}
          {(categories.data ?? []).length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-muted">No categories yet.</li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
