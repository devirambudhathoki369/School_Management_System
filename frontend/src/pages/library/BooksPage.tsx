import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  useBookCopies,
  useBooks,
  useLibraries,
  type BookRow,
} from '../../lib/campus'
import { formatMoneyRs } from '../../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import {
  IconLibrary,
  IconLayers,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '../../components/icons'

/** Book catalog per library, with per-title physical copies (accession nos). */
export default function BooksPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const libraries = useLibraries()
  const [libraryId, setLibraryId] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const books = useBooks(libraryId || null, query, page)
  const [editing, setEditing] = useState<BookRow | 'new' | null>(null)
  const [managingCopies, setManagingCopies] = useState<BookRow | null>(null)

  useEffect(() => {
    if (!libraryId && libraries.data?.length) setLibraryId(libraries.data[0].id)
  }, [libraryId, libraries.data])

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/library/books/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'books'] })
      toast.success('Book removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(libraries.data?.length ?? 0) > 1 && (
          <Select
            value={libraryId}
            onChange={(e) => {
              setLibraryId(e.target.value)
              setPage(1)
            }}
            aria-label="Library"
            className="w-48"
          >
            {(libraries.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
        <form
          className="relative min-w-0 flex-1 basis-64"
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setQuery(search)
          }}
        >
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or author…"
            className="pl-9"
            aria-label="Search books"
          />
        </form>
        <Button onClick={() => setEditing('new')} disabled={!libraryId}>
          <IconPlus size={16} /> New book
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {books.isLoading && libraryId ? (
          <SkeletonRows rows={8} />
        ) : (books.data?.results ?? []).length === 0 ? (
          <EmptyState
            icon={<IconLibrary size={22} />}
            title={
              libraries.data?.length === 0
                ? 'No library configured yet'
                : 'No books match'
            }
            hint={
              libraries.data?.length === 0
                ? 'Create the library first under the Libraries tab.'
                : 'Catalog titles, then add their physical copies.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {(books.data?.results ?? []).map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.title}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {[
                      b.personal_author,
                      b.isbn_no && `ISBN ${b.isbn_no}`,
                      b.call_no && `Call ${b.call_no}`,
                      b.price !== '0.00' && formatMoneyRs(b.price),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  onClick={() => setManagingCopies(b)}
                  className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-accent-strong hover:bg-accent-soft"
                >
                  <IconLayers size={15} /> Copies
                </button>
                <button
                  aria-label={`Edit ${b.title}`}
                  onClick={() => setEditing(b)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <button
                  aria-label={`Delete ${b.title}`}
                  onClick={() => {
                    if (window.confirm(`Delete “${b.title}” from the catalog?`))
                      remove.mutate(b.id)
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

      {books.data && (
        <Pagination
          count={books.data.count}
          page={page}
          pageSize={50}
          onPage={setPage}
          label="books"
        />
      )}

      {editing && (
        <BookModal
          book={editing === 'new' ? null : editing}
          libraryId={libraryId}
          onClose={() => setEditing(null)}
        />
      )}
      {managingCopies && (
        <CopiesModal book={managingCopies} onClose={() => setManagingCopies(null)} />
      )}
    </div>
  )
}

function BookModal({
  book,
  libraryId,
  onClose,
}: {
  book: BookRow | null
  libraryId: string
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    title: book?.title ?? '',
    personal_author: book?.personal_author ?? '',
    isbn_no: book?.isbn_no ?? '',
    call_no: book?.call_no ?? '',
    edition: book?.edition ?? '',
    place_and_publisher: book?.place_and_publisher ?? '',
    published_year: book?.published_year ?? '',
    price: book?.price ?? '',
    broad_subject: book?.broad_subject ?? '',
    entry_date_bs: book?.entry_date_bs ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, price: form.price || '0', library: book?.library ?? libraryId }
      return book
        ? api.patch(`/api/v1/library/books/${book.id}/`, payload)
        : api.post('/api/v1/library/books/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'books'] })
      toast.success(book ? 'Book updated.' : 'Book cataloged.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={book ? `Edit ${book.title}` : 'New book'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!form.title.trim()} onClick={() => save.mutate()}>
            {book ? 'Save changes' : 'Add to catalog'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">
          <Input value={form.title} onChange={set('title')} autoFocus />
        </Field>
        <Field label="Author">
          <Input value={form.personal_author} onChange={set('personal_author')} />
        </Field>
        <Field label="Subject">
          <Input value={form.broad_subject} onChange={set('broad_subject')} />
        </Field>
        <Field label="ISBN">
          <Input value={form.isbn_no} onChange={set('isbn_no')} />
        </Field>
        <Field label="Call number">
          <Input value={form.call_no} onChange={set('call_no')} />
        </Field>
        <Field label="Publisher">
          <Input value={form.place_and_publisher} onChange={set('place_and_publisher')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Edition">
            <Input value={form.edition} onChange={set('edition')} />
          </Field>
          <Field label="Year">
            <Input value={form.published_year} onChange={set('published_year')} />
          </Field>
        </div>
        <Field label="Price (drives the lost-book fine)">
          <Input type="number" step="0.01" min="0" value={form.price} onChange={set('price')} />
        </Field>
        <Field label="Entry date (BS)">
          <Input value={form.entry_date_bs} onChange={set('entry_date_bs')} placeholder="2082-01-15" />
        </Field>
      </div>
    </Modal>
  )
}

/** Physical copies of one title; each carries a unique accession number. */
function CopiesModal({ book, onClose }: { book: BookRow; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const copies = useBookCopies(book.id)
  const [accession, setAccession] = useState('')

  const add = useMutation({
    mutationFn: () =>
      api.post('/api/v1/library/copies/', {
        book: book.id,
        accession_no: Number(accession),
        entry_date_bs: book.entry_date_bs,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'copies', book.id] })
      setAccession('')
      toast.success('Copy added.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/library/copies/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'copies', book.id] })
      toast.success('Copy removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const flag = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: string; value: boolean }) =>
      api.patch(`/api/v1/library/copies/${id}/`, { [field]: value }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['library', 'copies', book.id] }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal open onClose={onClose} title={`Copies — ${book.title}`}>
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (accession) add.mutate()
          }}
        >
          <Input
            type="number"
            min="1"
            value={accession}
            onChange={(e) => setAccession(e.target.value)}
            placeholder="Accession no"
            aria-label="Accession number"
            autoFocus
          />
          <Button type="submit" busy={add.isPending} disabled={!accession}>
            <IconPlus size={16} /> Add copy
          </Button>
        </form>

        <ul className="divide-y divide-border rounded-xl border border-border">
          {(copies.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 font-medium tabular-nums">
                #{c.accession_no}
              </span>
              {c.is_lost && <Badge tone="danger">lost</Badge>}
              {c.is_damaged && <Badge tone="warning">damaged</Badge>}
              <button
                onClick={() => flag.mutate({ id: c.id, field: 'is_damaged', value: !c.is_damaged })}
                className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface-sunken"
              >
                {c.is_damaged ? 'undamage' : 'damaged?'}
              </button>
              <button
                onClick={() => flag.mutate({ id: c.id, field: 'is_lost', value: !c.is_lost })}
                className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface-sunken"
              >
                {c.is_lost ? 'found' : 'lost?'}
              </button>
              <button
                aria-label={`Remove copy ${c.accession_no}`}
                onClick={() => remove.mutate(c.id)}
                className="flex size-8 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <IconX size={14} />
              </button>
            </li>
          ))}
          {(copies.data ?? []).length === 0 && !copies.isLoading && (
            <li className="px-4 py-3 text-sm text-ink-muted">
              No copies yet — add accession numbers above.
            </li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
