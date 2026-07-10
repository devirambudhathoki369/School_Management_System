import TabbedWorkspace from '../../components/TabbedWorkspace'

export default function DevicesLayout() {
  return (
    <TabbedWorkspace
      ariaLabel="Device sections"
      tabs={[
        { to: '/devices/registry', label: 'Registry' },
        { to: '/devices/users', label: 'Device users' },
        { to: '/devices/punches', label: 'Punch log' },
      ]}
    />
  )
}
