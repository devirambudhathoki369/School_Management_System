import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Paginated, StudentRow } from '../../lib/billing'
import { type Certificate, type CertificateData } from '../../lib/exams'
import StudentPicker from '../../components/StudentPicker'
import { PrintMirror } from '../billing/ReceiptSheet'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconAward, IconPlus, IconPrinter } from '../../components/icons'

/**
 * Character certificates: issue with a server-allocated serial
 * (`n/billing-year`, the legacy shape), keep an immutable register, and
 * reprint any certificate verbatim from its snapshotted `data` — the row
 * never re-reads live student data, so an old certificate reprints exactly
 * as it was issued.
 */

const PAGE_SIZE = 50

export default function CertificatesPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [issuing, setIssuing] = useState(false)
  const [openCert, setOpenCert] = useState<Certificate | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['exams', 'certificates', search, page],
    queryFn: async () =>
      (
        await api.get<Paginated<Certificate>>('/api/v1/examinations/certificates/', {
          params: { page, search: search || undefined },
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  const rows = data?.results ?? []

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search serial or student name…"
          aria-label="Search certificates"
          className="sm:w-80"
        />
        <div className="sm:ml-auto">
          <Button onClick={() => setIssuing(true)}>
            <IconPlus size={16} /> Issue certificate
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconAward size={22} />}
            title={search ? 'No certificates match' : 'No certificates issued yet'}
            hint={search ? 'Try a serial number or a name.' : 'Issue the first one above.'}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((cert) => (
              <li key={cert.id}>
                <button
                  onClick={() => setOpenCert(cert)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium capitalize">
                      {cert.data.name || cert.student_name || '—'}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {cert.data.class ? `Class ${cert.data.class} · ` : ''}
                      issued {cert.data.issue_date || '—'} BS
                    </span>
                  </span>
                  <Badge tone="accent">SC {cert.serial_no}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        count={data?.count ?? 0}
        onPage={setPage}
        label="certificates"
      />

      {issuing && (
        <IssueModal
          onClose={() => setIssuing(false)}
          onIssued={(cert) => {
            setIssuing(false)
            setOpenCert(cert)
          }}
        />
      )}
      {openCert && (
        <CertificateSheetModal cert={openCert} onClose={() => setOpenCert(null)} />
      )}
    </div>
  )
}

const EMPTY: CertificateData = {}

function IssueModal({
  onClose,
  onIssued,
}: {
  onClose: () => void
  onIssued: (cert: Certificate) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [data, setData] = useState<CertificateData>(EMPTY)

  function patch(changes: Partial<CertificateData>) {
    setData((d) => ({ ...d, ...changes }))
  }

  // Prefill what the roster knows; everything stays editable — the print is
  // a legal document and registrars routinely adjust wording.
  function onPickStudent(row: StudentRow | null) {
    setStudent(row)
    if (row) patch({ name: row.full_name })
  }

  const issue = useMutation({
    mutationFn: async () =>
      (
        await api.post<Certificate>('/api/v1/examinations/certificates/', {
          student: student?.id ?? null,
          data,
        })
      ).data,
    onSuccess: (cert) => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'certificates'] })
      toast.success(`Certificate SC ${cert.serial_no} issued.`)
      onIssued(cert)
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = (data.name ?? '').trim().length > 0

  return (
    <Modal open title="Issue character certificate" onClose={onClose} wide>
      <div className="grid gap-3">
        <Field label="Student (optional — links the record)">
          <StudentPicker value={student} onChange={onPickStudent} placeholder="Search student…" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={data.name ?? ''} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Father / guardian name">
            <Input
              value={data.guardian_name ?? ''}
              onChange={(e) => patch({ guardian_name: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Permanent address">
          <Input value={data.address ?? ''} onChange={(e) => patch({ address: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Studied from (BS)">
            <Input
              value={data.from_date ?? ''}
              onChange={(e) => patch({ from_date: e.target.value })}
              placeholder="2078"
            />
          </Field>
          <Field label="To (BS)">
            <Input
              value={data.to_date ?? ''}
              onChange={(e) => patch({ to_date: e.target.value })}
              placeholder="2082"
            />
          </Field>
          <Field label="Class passed">
            <Input value={data.class ?? ''} onChange={(e) => patch({ class: e.target.value })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Exam year (BS)">
            <Input
              value={data.exam_year ?? ''}
              onChange={(e) => patch({ exam_year: e.target.value })}
            />
          </Field>
          <Field label="Division / GPA">
            <Input
              value={data.result ?? ''}
              onChange={(e) => patch({ result: e.target.value })}
              placeholder="3.90"
            />
          </Field>
          <Field label="Conduct remarks">
            <Input
              value={data.remarks ?? ''}
              onChange={(e) => patch({ remarks: e.target.value })}
              placeholder="Good"
            />
          </Field>
        </div>
        <Field label="Date of birth">
          <Input
            value={data.birth_date ?? ''}
            onChange={(e) => patch({ birth_date: e.target.value })}
            placeholder="2065-01-15 (B.S.)"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Symbol no.">
            <Input
              value={data.symbol_no ?? ''}
              onChange={(e) => patch({ symbol_no: e.target.value })}
            />
          </Field>
          <Field label="Regd no.">
            <Input
              value={data.regd_no ?? ''}
              onChange={(e) => patch({ regd_no: e.target.value })}
            />
          </Field>
          <Field label="Date of issue (BS)">
            <Input
              value={data.issue_date ?? ''}
              onChange={(e) => patch({ issue_date: e.target.value })}
              placeholder="2083-03-17"
            />
          </Field>
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || issue.isPending} onClick={() => issue.mutate()}>
            {issue.isPending ? 'Issuing…' : 'Issue with next serial'}
          </Button>
        </div>
        <p className="text-xs text-ink-faint">
          The serial number is allocated by the server for the current fiscal year and
          cannot be chosen — issue, then print.
        </p>
      </div>
    </Modal>
  )
}

function CertificateSheetModal({
  cert,
  onClose,
}: {
  cert: Certificate
  onClose: () => void
}) {
  return (
    <Modal open title={`Certificate SC ${cert.serial_no}`} onClose={onClose} wide>
      <div className="rounded-xl border border-border bg-surface p-2 sm:p-4">
        <CertificateSheet cert={cert} />
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={() => window.print()}>
          <IconPrinter size={16} /> Print certificate
        </Button>
      </div>
      <PrintMirror>
        <CertificateSheet cert={cert} print />
      </PrintMirror>
    </Modal>
  )
}

/** The certificate itself — legacy wording, snapshot data only. */
function CertificateSheet({ cert, print = false }: { cert: Certificate; print?: boolean }) {
  const { account } = useAuth()
  const school = account?.school
  const d = cert.data
  const line = (value: string | undefined, minWidth = '6rem') => (
    <span
      className="inline-block border-b border-dotted border-current px-1 text-center font-semibold uppercase"
      style={{ minWidth }}
    >
      {value || ' '}
    </span>
  )

  return (
    <div className={`${print ? 'p-10' : 'p-4 sm:p-8'} bg-white text-black`}>
      <header className="mb-2 text-center">
        <h1 className="text-xl font-bold uppercase tracking-wide">{school?.name}</h1>
        {school?.address && <p className="text-sm">{school.address}</p>}
        {school?.contact && <p className="text-xs">Tel: {school.contact}</p>}
      </header>
      <div className="mb-6 mt-4 text-center">
        <span className="inline-block border-b-2 border-double border-black px-6 pb-1 text-lg font-bold uppercase tracking-widest">
          Character Certificate
        </span>
      </div>
      <div className="mb-4 flex justify-between text-sm">
        <span>SC No.: <span className="font-semibold">{cert.serial_no}</span></span>
      </div>
      <p className="text-justify text-[15px] leading-8">
        <span className="mr-10" />
        This is to certify that Mr./Mrs./Miss {line(d.name, '14rem')}, son/daughter of
        Mr./Mrs. {line(d.guardian_name, '12rem')}, permanent resident of{' '}
        {line(d.address, '12rem')} was a student of this school from {line(d.from_date, '4rem')}{' '}
        B.S. to {line(d.to_date, '4rem')} B.S. He/She passed the annual examination of class{' '}
        {line(d.class, '4rem')} held in {line(d.exam_year, '4rem')} B.S. with{' '}
        {line(d.result, '4rem')} division/Grade Point Average (GPA). His/Her date of birth is{' '}
        {line(d.birth_date, '10rem')} according to our school record. He/She bears a good moral
        character and his/her performance was {line(d.remarks, '6rem')} while at this school.
        We wish him/her every success in life.
      </p>
      <div className="mt-6 flex flex-col gap-2 text-sm">
        <span>Symbol No.: {line(d.symbol_no)}</span>
        <span>Regd No.: {line(d.regd_no)}</span>
        <span>Date of Issue: {line(d.issue_date)}</span>
      </div>
      <footer className="mt-14 flex items-end justify-between text-sm">
        <span className="border-t border-black px-4 pt-1">Class Teacher</span>
        <span className="border-t border-black px-4 pt-1">Principal</span>
      </footer>
    </div>
  )
}
