import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Paginated, StudentRow } from '../lib/billing'
import { IconSearch, IconSpinner, IconX } from './icons'

/**
 * Async student combobox: type-ahead against the paginated students API,
 * keyboard navigable (up/down/enter/escape), 44px touch rows. The selected
 * student is shown as a clearable chip in place of the input.
 */
export default function StudentPicker({
  value,
  onChange,
  placeholder = 'Search student by name or roll no…',
  autoFocus = false,
}: {
  value: StudentRow | null
  onChange: (student: StudentRow | null) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ['students', 'picker', debounced],
    queryFn: async () =>
      (
        await api.get<Paginated<StudentRow>>('/api/v1/people/students/', {
          params: { search: debounced },
        })
      ).data,
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  })
  const results = data?.results ?? []

  if (value) {
    return (
      <div className="flex h-11 items-center justify-between gap-2 rounded-lg border border-accent bg-accent-soft/40 px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.full_name}</p>
          <p className="truncate text-xs text-ink-muted">
            {value.class_label}
            {value.roll_no ? ` · Roll ${value.roll_no}` : ''}
          </p>
        </div>
        <button
          type="button"
          aria-label="Clear selected student"
          onClick={() => onChange(null)}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface hover:text-ink"
        >
          <IconX size={16} />
        </button>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-faint">
        {isFetching ? <IconSpinner size={16} /> : <IconSearch size={16} />}
      </div>
      <input
        value={text}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-label="Search students"
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            onChange(results[active])
            setOpen(false)
            setText('')
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none transition-shadow placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
      />

      {open && debounced.length >= 2 && (
        <ul className="absolute z-30 mt-1.5 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg">
          {results.length === 0 && !isFetching && (
            <li className="px-4 py-3 text-sm text-ink-muted">No students match “{debounced}”.</li>
          )}
          {results.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onChange(s)
                  setOpen(false)
                  setText('')
                }}
                className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                  i === active ? 'bg-accent-soft/60' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.full_name}</span>
                  <span className="block truncate text-xs text-ink-muted">{s.class_label}</span>
                </span>
                {s.roll_no && (
                  <span className="shrink-0 text-xs text-ink-faint">Roll {s.roll_no}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
