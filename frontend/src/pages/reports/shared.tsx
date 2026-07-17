import { useEffect, useState, type ReactNode } from 'react'
import {
  defaultYearId,
  useAcademicYearsFull,
  useYearPointersFull,
} from '../../lib/academics'
import { useAuth } from '../../lib/auth'
import { downloadCsv } from '../../lib/csv'
import { Button, EmptyState, Field, Select, SkeletonRows } from '../../components/ui'
import { IconDownload, IconPrinter } from '../../components/icons'
import { PrintMirror } from '../billing/ReceiptSheet'

/**
 * Shared frame for every report tab: filters on top, action row (print /
 * CSV), summary chips, then a horizontally-scrollable table that doubles
 * as the letterhead print sheet through the #print-root pipeline.
 */

/** Academic-year dropdown pre-selected to the school's running year (A2). */
export function useYearFilter(): [string, (id: string) => void, ReactNode] {
  const years = useAcademicYearsFull()
  const pointers = useYearPointersFull()
  const [yearId, setYearId] = useState('')
  useEffect(() => {
    if (!yearId && years.data) setYearId(defaultYearId(years.data, pointers.data))
  }, [yearId, years.data, pointers.data])
  const control = (
    <Field label="Academic year">
      <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
        <option value="">{years.isLoading ? 'Loading years…' : 'Choose a year…'}</option>
        {(years.data ?? []).map((y) => (
          <option key={y.id} value={y.id}>
            {y.name}
            {y.closed ? ' (closed)' : ''}
          </option>
        ))}
      </Select>
    </Field>
  )
  return [yearId, setYearId, control]
}

export type Col<Row> = {
  key: string
  label: string
  align?: 'right'
  render: (row: Row) => ReactNode
  /** Raw value for CSV export; defaults to render output when a string. */
  csv?: (row: Row) => unknown
}

export function ReportTable<Row>({
  columns,
  rows,
  rowKey,
  footer,
  highlightLast = false,
}: {
  columns: Array<Col<Row>>
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  footer?: ReactNode
  highlightLast?: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2.5 font-semibold ${col.align === 'right' ? 'text-right' : ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={`border-b border-border/60 last:border-0 hover:bg-surface-sunken/40 ${
                highlightLast && i === rows.length - 1 ? 'bg-surface-sunken/70 font-semibold' : ''
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 ${col.align === 'right' ? 'text-right tabular-nums' : ''}`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  )
}

export function ReportActions<Row>({
  title,
  columns,
  rows,
  onPrint,
  disabled,
}: {
  title: string
  columns: Array<Col<Row>>
  rows: Row[]
  onPrint: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        onClick={() =>
          downloadCsv(
            title.toLowerCase().replace(/\s+/g, '-'),
            columns.map((c) => c.label),
            rows.map((row) =>
              columns.map((c) => {
                if (c.csv) return c.csv(row)
                const rendered = c.render(row)
                return typeof rendered === 'string' || typeof rendered === 'number'
                  ? rendered
                  : ''
              }),
            ),
          )
        }
        disabled={disabled || rows.length === 0}
      >
        <IconDownload size={15} /> CSV
      </Button>
      <Button variant="secondary" onClick={onPrint} disabled={disabled || rows.length === 0}>
        <IconPrinter size={15} /> Print
      </Button>
    </div>
  )
}

/** Letterhead print sheet: school header + report title + meta line + table. */
export function ReportPrintSheet<Row>({
  title,
  meta,
  columns,
  rows,
  rowKey,
  totals,
}: {
  title: string
  meta?: string
  columns: Array<Col<Row>>
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  totals?: Array<{ label: string; value: ReactNode }>
}) {
  const { account } = useAuth()
  const school = account?.school
  return (
    <PrintMirror>
      <div className="bg-white p-6 text-[12px] leading-snug text-black">
        <header className="border-b-2 border-black pb-3 text-center">
          <h1 className="text-lg font-bold uppercase tracking-wide">{school?.name}</h1>
          {school?.address && <p>{school.address}</p>}
          <p className="text-xs">
            {school?.contact && <>Tel: {school.contact}</>}
            {school?.pan_no && <> · PAN: {school.pan_no}</>}
          </p>
          <p className="mt-2 text-sm font-semibold uppercase">{title}</p>
          {meta && <p className="text-xs">{meta}</p>}
        </header>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-y border-black text-left">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`py-1.5 pr-2 font-semibold ${col.align === 'right' ? 'text-right' : ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row, i)} className="border-b border-dotted border-black/40">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-1 pr-2 align-top ${col.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && totals.length > 0 && (
            <tfoot>
              <tr className="border-t border-black font-bold">
                <td colSpan={columns.length} className="py-1.5">
                  <div className="flex flex-wrap justify-end gap-x-8">
                    {totals.map((t) => (
                      <span key={t.label}>
                        {t.label}: {t.value}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        <footer className="mt-8 flex justify-between text-xs">
          <p>Printed from School ERP</p>
          <p className="border-t border-black px-6 pt-1">Authorised signature</p>
        </footer>
      </div>
    </PrintMirror>
  )
}

export function ReportBody({
  loading,
  empty,
  emptyTitle,
  emptyHint,
  truncated,
  children,
}: {
  loading: boolean
  empty: boolean
  emptyTitle: string
  emptyHint: string
  truncated?: boolean
  children: ReactNode
}) {
  if (loading)
    return (
      <div className="rounded-xl border border-border bg-surface">
        <SkeletonRows rows={8} />
      </div>
    )
  if (empty)
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState title={emptyTitle} hint={emptyHint} />
      </div>
    )
  return (
    <div className="page-enter">
      {truncated && (
        <p className="mb-2 rounded-lg bg-warning-soft px-3 py-2 text-xs font-medium text-warning">
          Large result — showing the first rows only. Totals cover everything;
          narrow the filters to see the rest.
        </p>
      )}
      {children}
    </div>
  )
}
