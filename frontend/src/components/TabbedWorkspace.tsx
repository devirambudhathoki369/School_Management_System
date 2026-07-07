import { NavLink, Outlet } from 'react-router-dom'

/** Standard module frame: horizontal pill tabs over a routed outlet. */
export default function TabbedWorkspace({
  tabs,
  ariaLabel,
  maxWidth = 'max-w-5xl',
}: {
  tabs: Array<{ to: string; label: string }>
  ariaLabel: string
  maxWidth?: string
}) {
  return (
    <div className={`mx-auto ${maxWidth}`}>
      <nav aria-label={ariaLabel} className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-xl bg-surface-sunken p-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `flex h-9 items-center whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </div>
  )
}
