import { useAuth } from '../lib/auth'
import { IconAlert, IconMegaphone } from '../components/icons'

/**
 * Support & guides (legacy Support/Guides leaves): how a school reaches the
 * vendor, plus the ground rules every desk should know. Static by design —
 * a help channel must render even when everything else is on fire.
 */
export default function SupportPage() {
  const { account } = useAuth()
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <IconMegaphone size={18} /> Vendor support
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Something broken, blocked or billing-related? The CentEducation team
          answers fastest on the phone during office hours.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Phone</dt>
            <dd className="mt-0.5 font-semibold">082-590530</dd>
          </div>
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Email</dt>
            <dd className="mt-0.5 font-semibold">support@centeducation.com</dd>
          </div>
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Office hours</dt>
            <dd className="mt-0.5 font-semibold">Sun–Fri · 10:00–17:00</dd>
          </div>
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Your school</dt>
            <dd className="mt-0.5 truncate font-semibold">{account?.school?.name}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <IconAlert size={18} /> Before you call
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
          <li>
            Money looks wrong? Check <strong>Reports → Transactions</strong> and the
            student&apos;s ledger first — receipts are immutable, so the trail is
            always there.
          </li>
          <li>
            A menu is missing? Permissions are per-module — an admin can grant it
            under <strong>Enrollment → Staff</strong>.
          </li>
          <li>
            Year-end questions (closing, promotion, carry-forward) are one-way
            doors — call before clicking, not after.
          </li>
          <li>
            Include your school name and the exact screen title in every request;
            it halves the back-and-forth.
          </li>
        </ul>
      </div>
    </div>
  )
}
