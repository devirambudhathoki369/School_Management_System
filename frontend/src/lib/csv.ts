/** Client-side CSV export for report tables (Excel-friendly UTF-8 BOM). */

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
) {
  const body = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
