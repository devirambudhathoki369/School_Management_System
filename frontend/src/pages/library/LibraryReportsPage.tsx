import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useBooks, useBookCopies, useLibraries } from '../../lib/campus'
import { useAuth } from '../../lib/auth'
import { PrintMirror } from '../billing/ReceiptSheet'
import { formatMoney } from '../../lib/format'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonRows,
  StatCard,
  apiErrorMessage,
} from '../../components/ui'
import { IconLibrary, IconPrinter } from '../../components/icons'

/**
 * Library reports (the eight legacy leaves off one endpoint) and barcode
 * sheets for accession numbers (Code 39 — any laser printer, any scanner).
 */

const KINDS = [
  ['overall', 'Overall'],
  ['daily', 'Daily'],
  ['issued_students', 'Issued to students'],
  ['issued_teachers', 'Issued to teachers'],
  ['counts', 'Issued/returned counts'],
  ['operation', 'Book operations'],
  ['fine', 'Fines'],
] as const

interface LoanReportRow {
  id: string
  accession_no: number
  book: string
  borrower: string
  borrower_type: string
  issued_date_bs: string
  due_date_bs: string
  returned_date_bs: string
  fine: string
}

function useLibraryReport(kind: string, params: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ['library', 'report', kind, params],
    queryFn: async () =>
      (
        await api.get<Record<string, unknown>>('/api/v1/library/report/', {
          params: { kind, ...params },
        })
      ).data,
  })
}

export default function LibraryReportsPage() {
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('overall')
  const [fromBs, setFromBs] = useState('')
  const [toBs, setToBs] = useState('')
  const windowed = ['daily', 'counts', 'operation'].includes(kind)
  const report = useLibraryReport(kind, {
    from_bs: windowed && fromBs ? fromBs : undefined,
    to_bs: windowed && toBs ? toBs : undefined,
  })

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Report" className="sm:w-64">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {windowed && (
          <>
            <Field label="From (BS)" className="sm:w-40">
              <Input value={fromBs} onChange={(e) => setFromBs(e.target.value)} placeholder="today" />
            </Field>
            <Field label="To (BS)" className="sm:w-40">
              <Input value={toBs} onChange={(e) => setToBs(e.target.value)} placeholder="today" />
            </Field>
          </>
        )}
        <Button variant="secondary" className="sm:ml-auto" onClick={() => window.print()}>
          <IconPrinter size={16} /> Print
        </Button>
      </div>

      {report.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={6} />
        </div>
      ) : report.isError ? (
        <EmptyState title="Report failed" hint={apiErrorMessage(report.error)} />
      ) : (
        <ReportBody kind={kind} data={report.data as never} />
      )}
    </div>
  )
}

function LoanTable({ rows, title }: { rows: LoanReportRow[]; title?: string }) {
  if (!rows.length) return <EmptyState icon={<IconLibrary size={22} />} title="No rows" />
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      {title && <p className="px-4 pt-3 text-sm font-semibold">{title}</p>}
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Acc. no</th>
            <th className="px-3 py-2.5 text-left font-medium">Book</th>
            <th className="px-3 py-2.5 text-left font-medium">Borrower</th>
            <th className="px-3 py-2.5 text-left font-medium">Issued</th>
            <th className="px-3 py-2.5 text-left font-medium">Due</th>
            <th className="px-3 py-2.5 text-left font-medium">Returned</th>
            <th className="px-3 py-2.5 text-right font-medium">Fine</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2 tabular-nums">#{r.accession_no}</td>
              <td className="px-3 py-2 font-medium">{r.book}</td>
              <td className="px-3 py-2">
                {r.borrower}
                <span className="ml-1 text-xs text-ink-faint">({r.borrower_type})</span>
              </td>
              <td className="px-3 py-2">{r.issued_date_bs}</td>
              <td className="px-3 py-2">{r.due_date_bs}</td>
              <td className="px-3 py-2">{r.returned_date_bs || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {Number(r.fine) > 0 ? formatMoney(r.fine) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportBody({ kind, data }: { kind: string; data: Record<string, never> }) {
  if (kind === 'overall') {
    const rows = (data.rows ?? []) as Array<{
      library: string
      titles: number
      copies: number
      issued_now: number
      available: number
      loans_ever: number
      fines_collected: string
    }>
    if (!rows.length) return <EmptyState title="No libraries configured" />
    return (
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.library}>
            <p className="mb-2 text-sm font-semibold">{r.library}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Titles" value={r.titles} tone="accent" />
              <StatCard label="Copies" value={r.copies} />
              <StatCard label="Issued now" value={r.issued_now} tone="warning" />
              <StatCard label="Available" value={r.available} tone="positive" />
              <StatCard label="Loans ever" value={r.loans_ever} />
              <StatCard label="Fines collected" value={`Rs. ${formatMoney(r.fines_collected)}`} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (kind === 'daily') {
    return (
      <div className="space-y-4">
        <LoanTable rows={(data.issued ?? []) as LoanReportRow[]} title="Issued" />
        <LoanTable rows={(data.returned ?? []) as LoanReportRow[]} title="Returned" />
      </div>
    )
  }
  if (kind === 'counts') {
    const rows = (data.rows ?? []) as Array<{ date_bs: string; issued: number; returned: number }>
    if (!rows.length) return <EmptyState title="No activity in the window" />
    return (
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[380px] text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Date (BS)</th>
              <th className="px-3 py-2.5 text-right font-medium">Issued</th>
              <th className="px-3 py-2.5 text-right font-medium">Returned</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date_bs} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2">{r.date_bs}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.issued}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.returned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (kind === 'fine') {
    return (
      <div className="space-y-3">
        <StatCard
          label="Total fines"
          value={`Rs. ${formatMoney((data.total ?? '0') as string)}`}
          tone="warning"
        />
        <LoanTable rows={(data.rows ?? []) as LoanReportRow[]} />
      </div>
    )
  }
  return <LoanTable rows={(data.rows ?? []) as LoanReportRow[]} />
}

// ------------------------------------------------------------- barcodes

/** Code 39 patterns for digits (n = narrow, w = wide; bars/spaces alternate,
 *  starting and ending with a bar). Accession numbers are numeric. */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', '*': 'nwnnwnwnn',
}

function Code39({ value, height = 40 }: { value: string; height?: number }) {
  const chars = `*${value}*`.split('')
  const narrow = 1.6
  const wide = narrow * 2.5
  let x = 0
  const rects: Array<{ x: number; w: number }> = []
  for (const ch of chars) {
    const pattern = CODE39[ch]
    if (!pattern) continue
    pattern.split('').forEach((unit, i) => {
      const w = unit === 'w' ? wide : narrow
      if (i % 2 === 0) rects.push({ x, w })
      x += w
    })
    x += narrow // inter-character gap
  }
  return (
    <svg width={x} height={height} role="img" aria-label={`Barcode ${value}`}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={0} width={r.w} height={height} fill="black" />
      ))}
    </svg>
  )
}

export function BarcodesPage() {
  const { account } = useAuth()
  const libraries = useLibraries()
  const [libraryId, setLibraryId] = useState('')
  const [search, setSearch] = useState('')
  const books = useBooks(libraryId || null, search, 1)
  const [bookId, setBookId] = useState('')
  const copies = useBookCopies(bookId || null)
  const book = books.data?.results.find((b) => b.id === bookId)

  const sheet = (
    <div className="flex flex-wrap gap-3 bg-white p-4">
      {(copies.data ?? []).map((c) => (
        <div key={c.id} className="border border-black p-2 text-center text-black">
          <p className="mb-1 max-w-[220px] truncate text-[10px] font-semibold">
            {account?.school?.name} · {book?.title}
          </p>
          <Code39 value={String(c.accession_no)} />
          <p className="mt-0.5 text-[11px] tabular-nums">#{c.accession_no}</p>
        </div>
      ))}
    </div>
  )

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Library">
          <Select
            value={libraryId}
            onChange={(e) => {
              setLibraryId(e.target.value)
              setBookId('')
            }}
          >
            <option value="">Choose…</option>
            {(libraries.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Find title">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" />
        </Field>
        <Field label="Book">
          <Select value={bookId} onChange={(e) => setBookId(e.target.value)} disabled={!libraryId}>
            <option value="">Choose…</option>
            {(books.data?.results ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {!bookId ? (
        <EmptyState
          icon={<IconLibrary size={22} />}
          title="Pick a book"
          hint="One barcode label prints per physical copy."
        />
      ) : copies.isLoading ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <Button variant="secondary" onClick={() => window.print()}>
              <IconPrinter size={16} /> Print {(copies.data ?? []).length} labels
            </Button>
          </div>
          <div className="rounded-xl border border-border bg-surface-sunken">{sheet}</div>
          <PrintMirror>{sheet}</PrintMirror>
        </>
      )}
    </div>
  )
}
