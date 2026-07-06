import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { bsMonthName, formatDateBS, formatMoney, formatReceiptNo } from '../lib/format'
import { Badge, Money, Skeleton, StatCard } from '../components/ui'
import {
  IconArrowRight,
  IconBilling,
  IconCalendar,
  IconReceipt,
  IconStudents,
  IconWallet,
} from '../components/icons'

/**
 * The day-start snapshot. One API round trip; blocks appear only when the
 * server granted them (permission gating is server-side — a staff account
 * without billing simply receives no finance block).
 */

interface TrendPoint {
  year_month: string
  month: number
  collected: string
}

interface DashboardData {
  date_bs: string
  school: string
  students?: { running: number; male: number; female: number }
  staff?: { employed: number }
  finance?: {
    dues_outstanding: string
    collected_today: string
    receipts_today: number
    collected_this_month: string
    trend: TrendPoint[]
  }
  attendance?: { marked: number; present: number; absent: number }
  recent_receipts?: Array<{
    id: string
    receipt_no: number | null
    name: string
    date_bs: string
    mode: string
    total_paid: string
  }>
}

export default function DashboardPage() {
  const { account } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: async () => (await api.get<DashboardData>('/api/v1/reports/dashboard/')).data,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }
  if (!data) return null

  const granted = new Set(account?.permissions ?? [])
  const can = (code: string) => granted.has(`${code}.view`) || granted.has(`${code}.manage`)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{data.school}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Here is where the school stands today.</p>
        </div>
        <Badge tone="accent">
          <IconCalendar size={13} className="mr-1.5" />
          {formatDateBS(data.date_bs)}
        </Badge>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.students && (
          <StatCard
            label="Running students"
            value={data.students.running.toLocaleString('en-IN')}
            detail={`${data.students.male.toLocaleString('en-IN')} boys · ${data.students.female.toLocaleString('en-IN')} girls`}
            icon={<IconStudents size={16} />}
          />
        )}
        {data.finance && (
          <>
            <StatCard
              label="Dues outstanding"
              value={<Money value={data.finance.dues_outstanding} />}
              detail="charges minus receipts and discounts"
              icon={<IconWallet size={16} />}
            />
            <StatCard
              label="Collected today"
              value={<Money value={data.finance.collected_today} />}
              detail={`${data.finance.receipts_today} receipt${data.finance.receipts_today === 1 ? '' : 's'} issued`}
              icon={<IconReceipt size={16} />}
            />
          </>
        )}
        {data.staff && (
          <StatCard label="Staff employed" value={data.staff.employed.toLocaleString('en-IN')} />
        )}
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        {/* Collection trend */}
        {data.finance && (
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5 lg:col-span-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Fee collections — last 6 months</h3>
              <p className="text-xs text-ink-faint">Rs., by BS month</p>
            </div>
            <TrendChart points={data.finance.trend} />
          </section>
        )}

        <div className="space-y-4">
          {/* Attendance today */}
          {data.attendance && <AttendanceCard attendance={data.attendance} />}

          {/* Quick actions */}
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold">Quick actions</h3>
            <div className="space-y-1.5">
              {can('billing') && <QuickLink to="/billing/collect" label="Collect a payment" />}
              {can('billing') && <QuickLink to="/billing/receipts" label="Browse receipts" />}
              {can('students') && <QuickLink to="/students" label="Find a student" />}
              {can('accounting') && <QuickLink to="/accounting/vouchers" label="Enter a voucher" />}
            </div>
          </section>
        </div>
      </div>

      {/* Recent receipts */}
      {data.recent_receipts && data.recent_receipts.length > 0 && (
        <section className="mt-4 rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold">Latest receipts</h3>
            <Link
              to="/billing/receipts"
              className="flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline"
            >
              View all <IconArrowRight size={13} />
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {data.recent_receipts.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                  <IconBilling size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-ink-muted">
                    #{formatReceiptNo(r.receipt_no)} · {formatDateBS(r.date_bs)} · {r.mode}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatMoney(r.total_paid)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-10 items-center justify-between rounded-lg border border-border px-3 text-sm font-medium text-ink transition-colors hover:border-accent hover:bg-accent-soft/40"
    >
      {label}
      <IconArrowRight size={14} className="text-ink-faint" />
    </Link>
  )
}

function AttendanceCard({
  attendance,
}: {
  attendance: NonNullable<DashboardData['attendance']>
}) {
  const { marked, present, absent } = attendance
  const rate = marked > 0 ? Math.round((present / marked) * 100) : 0
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-sm font-semibold">Attendance today</h3>
      {marked === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No classes marked yet today.</p>
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{rate}%</p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken"
            role="img"
            aria-label={`${present} present of ${marked} marked`}
          >
            <div className="h-full rounded-full bg-positive" style={{ width: `${rate}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {present.toLocaleString('en-IN')} present · {absent.toLocaleString('en-IN')} absent ·{' '}
            {marked.toLocaleString('en-IN')} marked
          </p>
        </>
      )}
    </section>
  )
}

/**
 * Single-series bar chart, inline SVG. Mark spec: thin bars with 4px
 * rounded tops anchored to the baseline, recessive gridlines, direct label
 * on the current month only, per-bar hover tooltip. One series — the title
 * names it, so there is no legend; an sr-only table carries the data for
 * assistive tech.
 */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 210
  const PAD = { top: 24, right: 8, bottom: 26, left: 8 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const values = points.map((p) => Number(p.collected) || 0)
  const max = Math.max(...values)
  const empty = max <= 0

  if (empty) {
    return (
      <p className="flex h-48 items-center justify-center text-sm text-ink-muted">
        No collections recorded in the last six months.
      </p>
    )
  }

  const slot = plotW / points.length
  const barW = Math.min(56, slot * 0.55)
  const x = (i: number) => PAD.left + slot * i + (slot - barW) / 2
  const y = (v: number) => PAD.top + plotH * (1 - v / max)
  const gridLines = [0.5, 1]

  function barPath(i: number, v: number) {
    const bx = x(i)
    const by = y(v)
    const h = PAD.top + plotH - by
    const r = Math.min(4, h, barW / 2)
    const base = PAD.top + plotH
    return `M ${bx} ${base} L ${bx} ${by + r} Q ${bx} ${by} ${bx + r} ${by} L ${bx + barW - r} ${by} Q ${bx + barW} ${by} ${bx + barW} ${by + r} L ${bx + barW} ${base} Z`
  }

  return (
    <div className="relative mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly fee collections">
        {/* recessive grid */}
        {gridLines.map((g) => (
          <line
            key={g}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(max * g)}
            y2={y(max * g)}
            stroke="var(--color-border)"
            strokeDasharray="3 4"
            strokeWidth="1"
          />
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--color-border)"
          strokeWidth="1"
        />

        {points.map((p, i) => {
          const current = i === points.length - 1
          return (
            <g key={p.year_month}>
              <path
                d={barPath(i, values[i])}
                fill="var(--color-accent-strong)"
                opacity={hover === null ? (current ? 1 : 0.55) : hover === i ? 1 : 0.35}
              />
              {/* hit target wider than the mark */}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {/* direct label: current month only */}
              {current && values[i] > 0 && (
                <text
                  x={x(i) + barW / 2}
                  y={y(values[i]) - 8}
                  textAnchor="middle"
                  className="fill-ink text-[12px] font-semibold tabular-nums"
                >
                  {formatMoney(values[i])}
                </text>
              )}
              <text
                x={PAD.left + slot * i + slot / 2}
                y={H - 8}
                textAnchor="middle"
                className={`text-[11px] ${hover === i ? 'fill-ink font-medium' : 'fill-ink-muted'}`}
              >
                {bsMonthName(p.month).slice(0, 3)}
              </text>
            </g>
          )
        })}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs shadow-lg"
          style={{ left: `${((x(hover) + barW / 2) / W) * 100}%` }}
        >
          <span className="font-medium">{bsMonthName(points[hover].month)}</span>{' '}
          <span className="tabular-nums">Rs. {formatMoney(values[hover])}</span>
        </div>
      )}

      {/* data table for assistive tech */}
      <table className="sr-only">
        <caption>Fee collections by month</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.year_month}>
              <th scope="row">{bsMonthName(p.month)}</th>
              <td>Rs. {formatMoney(values[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
