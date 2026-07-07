import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  useBookCopies,
  useBooks,
  useLibraries,
  useOpenLoans,
  type LoanRow,
} from '../../lib/campus'
import { useCalendar, type StudentRow } from '../../lib/billing'
import { formatDateBS, formatMoneyRs } from '../../lib/format'
import StudentPicker from '../../components/StudentPicker'
import StaffSelect from '../../components/StaffSelect'
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
import { IconLibrary, IconPlus, IconSearch } from '../../components/icons'

/**
 * Circulation desk: what's out, issue a copy, take a return. Fines are
 * entered by the librarian at return; the library's per-day rate and the
 * book's price are shown beside the field so the arithmetic is visible.
 */
export default function CirculationPage() {
  const loans = useOpenLoans()
  const calendar = useCalendar()
  const [issuing, setIssuing] = useState(false)
  const [returning, setReturning] = useState<LoanRow | null>(null)
  const today = calendar.data?.today_bs ?? ''

  const rows = loans.data ?? []

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {loans.isLoading ? 'Loading…' : `${rows.length} cop${rows.length === 1 ? 'y' : 'ies'} out`}
        </p>
        <Button onClick={() => setIssuing(true)}>
          <IconPlus size={16} /> Issue a book
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {loans.isLoading ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconLibrary size={22} />}
            title="Nothing is out"
            hint="Issue a copy to a student or staff member."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((l) => {
              const overdue = today && l.due_date_bs < today
              return (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <LoanLabel loan={l} />
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      issued {formatDateBS(l.issued_date_bs)} · due {formatDateBS(l.due_date_bs)}
                    </p>
                  </div>
                  {overdue && <Badge tone="danger">overdue</Badge>}
                  <Button variant="secondary" onClick={() => setReturning(l)}>
                    Return
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {issuing && <IssueModal onClose={() => setIssuing(false)} />}
      {returning && <ReturnModal loan={returning} onClose={() => setReturning(null)} />}
    </div>
  )
}

function LoanLabel({ loan }: { loan: LoanRow }) {
  return (
    <>
      {loan.book_title} #{loan.copy_accession}
      {loan.borrower_name && <span className="text-ink-muted"> → {loan.borrower_name}</span>}
    </>
  )
}

function IssueModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const libraries = useLibraries()
  const calendar = useCalendar()
  const libraryId = libraries.data?.[0]?.id ?? ''
  const [bookSearch, setBookSearch] = useState('')
  const [bookQuery, setBookQuery] = useState('')
  const books = useBooks(libraryId || null, bookQuery, 1)
  const [bookId, setBookId] = useState('')
  const copies = useBookCopies(bookId || null)
  const openLoans = useOpenLoans()
  const [copyId, setCopyId] = useState('')
  const [borrowerKind, setBorrowerKind] = useState<'student' | 'staff'>('student')
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [staffId, setStaffId] = useState('')
  const [issued, setIssued] = useState('')
  const [due, setDue] = useState('')

  const outCopyIds = useMemo(
    () => new Set((openLoans.data ?? []).map((l) => l.copy)),
    [openLoans.data],
  )
  const availableCopies = (copies.data ?? []).filter(
    (c) => !c.is_lost && !outCopyIds.has(c.id),
  )
  const effectiveIssued = issued || calendar.data?.today_bs || ''

  const issue = useMutation({
    mutationFn: () =>
      api.post('/api/v1/library/loans/', {
        copy: copyId,
        student: borrowerKind === 'student' ? student?.id : null,
        staff: borrowerKind === 'staff' ? staffId : null,
        issued_date_bs: effectiveIssued,
        due_date_bs: due,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'loans'] })
      toast.success('Book issued.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid =
    copyId &&
    effectiveIssued &&
    due &&
    (borrowerKind === 'student' ? !!student : !!staffId)

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Issue a book"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={issue.isPending} disabled={!valid} onClick={() => issue.mutate()}>
            Issue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault()
            setBookQuery(bookSearch)
            setBookId('')
            setCopyId('')
          }}
        >
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <Input
            value={bookSearch}
            onChange={(e) => setBookSearch(e.target.value)}
            placeholder="Search the catalog, press Enter…"
            className="pl-9"
            aria-label="Search books"
            autoFocus
          />
        </form>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Book">
            <Select
              value={bookId}
              onChange={(e) => {
                setBookId(e.target.value)
                setCopyId('')
              }}
            >
              <option value="">
                {books.isFetching ? 'Searching…' : 'Choose a title…'}
              </option>
              {(books.data?.results ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Copy" hint={bookId ? `${availableCopies.length} available` : undefined}>
            <Select value={copyId} onChange={(e) => setCopyId(e.target.value)} disabled={!bookId}>
              <option value="">{bookId ? 'Choose a copy…' : 'Pick a book first'}</option>
              {availableCopies.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.accession_no}
                  {c.is_damaged ? ' (damaged)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
          {(
            [
              ['student', 'Student'],
              ['staff', 'Staff'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setBorrowerKind(value)}
              className={`h-9 flex-1 rounded-lg text-sm font-medium transition-colors ${
                borrowerKind === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {borrowerKind === 'student' ? (
          <StudentPicker value={student} onChange={setStudent} />
        ) : (
          <StaffSelect value={staffId} onChange={setStaffId} />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Issued (BS)">
            <Input value={effectiveIssued} onChange={(e) => setIssued(e.target.value)} />
          </Field>
          <Field label="Due (BS)">
            <Input value={due} onChange={(e) => setDue(e.target.value)} placeholder="2082-04-15" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function ReturnModal({ loan, onClose }: { loan: LoanRow; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const libraries = useLibraries()
  const calendar = useCalendar()
  const [returned, setReturned] = useState('')
  const [fine, setFine] = useState(loan.fine_amount !== '0.00' ? loan.fine_amount : '')
  const [remarks, setRemarks] = useState(loan.remarks)
  const effectiveReturned = returned || calendar.data?.today_bs || ''
  const finePerDay = libraries.data?.[0]?.fine_per_day

  const doReturn = useMutation({
    mutationFn: () =>
      api.patch(`/api/v1/library/loans/${loan.id}/`, {
        returned_date_bs: effectiveReturned,
        fine_amount: fine || '0',
        remarks,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'loans'] })
      toast.success('Return recorded.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Return book"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={doReturn.isPending} disabled={!effectiveReturned} onClick={() => doReturn.mutate()}>
            Record return
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          Issued {formatDateBS(loan.issued_date_bs)} · due {formatDateBS(loan.due_date_bs)}.
        </p>
        <Field label="Returned (BS)">
          <Input value={effectiveReturned} onChange={(e) => setReturned(e.target.value)} autoFocus />
        </Field>
        <Field
          label="Fine"
          hint={
            finePerDay && finePerDay !== '0.00'
              ? `Library rate: ${formatMoneyRs(finePerDay)} per late day.`
              : undefined
          }
        >
          <Input
            type="number"
            step="0.01"
            min="0"
            value={fine}
            onChange={(e) => setFine(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Remarks">
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Condition notes…" />
        </Field>
      </div>
    </Modal>
  )
}
