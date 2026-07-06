/**
 * Formatting helpers shared by every module page.
 *
 * Money is Nepali rupees with lakh/crore digit grouping (12,34,567.00) —
 * that is how every school here reads amounts; western grouping looks wrong
 * on a fee receipt. Amounts arrive from DRF as decimal STRINGS and must stay
 * exact, so parsing goes through Number only for display, never arithmetic
 * that feeds back into the API.
 */

const NPR = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (Number.isNaN(n)) return '—'
  return NPR.format(n)
}

export function formatMoneyRs(value: string | number | null | undefined): string {
  const formatted = formatMoney(value)
  return formatted === '—' ? formatted : `Rs. ${formatted}`
}

/** Sum decimal strings safely for DISPLAY (2dp money never overflows a double). */
export function sumAmounts(values: Array<string | number | null | undefined>): number {
  return values.reduce<number>((acc, v) => {
    const n = typeof v === 'string' ? Number(v) : (v ?? 0)
    return acc + (Number.isNaN(n) ? 0 : n)
  }, 0)
}

/** Bikram Sambat months, 1-indexed. The academic year starts in Baishakh. */
export const BS_MONTHS = [
  'Baishakh',
  'Jestha',
  'Ashadh',
  'Shrawan',
  'Bhadra',
  'Ashwin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
] as const

/** Distinct short forms — plain 3-letter truncation collides
 *  (Ashadh/Ashwin would both read "Ash"). */
export const BS_MONTHS_SHORT = [
  'Bai', 'Jes', 'Asar', 'Shra', 'Bha', 'Aswin', 'Kar', 'Man', 'Pou', 'Mag', 'Fal', 'Cha',
] as const

export function bsMonthName(month: number): string {
  return BS_MONTHS[month - 1] ?? `Month ${month}`
}

export function bsMonthShort(month: number): string {
  return BS_MONTHS_SHORT[month - 1] ?? `M${month}`
}

/** "2082-03-21" -> "21 Ashadh 2082" for headers and receipts. */
export function formatDateBS(dateBs: string | null | undefined): string {
  if (!dateBs) return '—'
  const [y, m, d] = dateBs.split('-').map(Number)
  if (!y || !m || !d) return dateBs
  return `${d} ${bsMonthName(m)} ${y}`
}

/** Receipt numbers print zero-padded, the way the legacy books show them. */
export function formatReceiptNo(serial: number | null | undefined): string {
  return serial == null ? '—' : String(serial).padStart(5, '0')
}
