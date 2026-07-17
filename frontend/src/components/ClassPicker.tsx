import { useEffect, useState } from 'react'
import {
  defaultYearId,
  useAcademicYearsFull,
  useClassesOfYear,
  useYearPointersFull,
  type ClassInfoFull,
} from '../lib/academics'
import { Field, Select } from './ui'

/**
 * Year → class cascade. "Current year" is resolved through the school's
 * year pointers (invariant A2), so the default selection is the year classes
 * are actually running in — not just the newest row.
 */
export default function ClassPicker({
  classId,
  onChange,
  initialYearId,
  currentLabel,
  allowAnyClass = false,
  yearId: controlledYearId,
}: {
  classId: string
  onChange: (classId: string, cls: ClassInfoFull | null) => void
  /** Pre-select this year (e.g. the student's enrolment year when editing). */
  initialYearId?: string
  /** Shown as a fallback option when classId isn't in the selected year. */
  currentLabel?: string
  /** Adds an "All classes" empty option instead of a required placeholder. */
  allowAnyClass?: boolean
  /**
   * Controlled mode: the page already owns a year filter. The embedded year
   * select is hidden and the class list follows this year instead — without
   * this, a page shows two "Academic year" controls that can disagree.
   */
  yearId?: string
}) {
  const controlled = controlledYearId !== undefined
  const years = useAcademicYearsFull()
  const pointers = useYearPointersFull()
  const [ownYearId, setOwnYearId] = useState(initialYearId ?? '')
  const yearId = controlled ? controlledYearId : ownYearId
  const classes = useClassesOfYear(yearId || null)

  useEffect(() => {
    if (!controlled && !ownYearId && years.data) {
      setOwnYearId(initialYearId || defaultYearId(years.data, pointers.data))
    }
  }, [controlled, ownYearId, years.data, pointers.data, initialYearId])

  const rows = [...(classes.data ?? [])].sort((a, b) => a.label.localeCompare(b.label))
  const known = rows.some((c) => c.id === classId)

  // Controlled year changed under a selected class: a class from another year
  // would silently filter the page down to nothing, so clear the selection.
  useEffect(() => {
    if (controlled && classId && classes.isSuccess && !known && !currentLabel) {
      onChange('', null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled, classId, classes.isSuccess, known, currentLabel])

  if (controlled) {
    return (
      <Field label="Class">
        <Select
          value={classId}
          onChange={(e) => {
            const cls = rows.find((c) => c.id === e.target.value) ?? null
            onChange(e.target.value, cls)
          }}
          disabled={!yearId}
        >
          <option value="">
            {!yearId
              ? 'Pick a year first'
              : classes.isLoading
                ? 'Loading classes…'
                : allowAnyClass
                  ? 'All classes'
                  : 'Choose a class…'}
          </option>
          {!known && classId && currentLabel && (
            <option value={classId}>{currentLabel}</option>
          )}
          {rows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Academic year">
        <Select
          value={yearId}
          onChange={(e) => {
            setOwnYearId(e.target.value)
            onChange('', null)
          }}
        >
          <option value="">
            {years.isLoading ? 'Loading years…' : 'Choose a year…'}
          </option>
          {(years.data ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
              {y.closed ? ' (closed)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Class">
        <Select
          value={classId}
          onChange={(e) => {
            const cls = rows.find((c) => c.id === e.target.value) ?? null
            onChange(e.target.value, cls)
          }}
          disabled={!yearId}
        >
          <option value="">
            {!yearId
              ? 'Pick a year first'
              : classes.isLoading
                ? 'Loading classes…'
                : allowAnyClass
                  ? 'All classes'
                  : 'Choose a class…'}
          </option>
          {!known && classId && currentLabel && (
            <option value={classId}>{currentLabel}</option>
          )}
          {rows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}
