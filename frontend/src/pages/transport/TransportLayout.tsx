import TabbedWorkspace from '../../components/TabbedWorkspace'

export default function TransportLayout() {
  return (
    <TabbedWorkspace
      ariaLabel="Transport sections"
      tabs={[
        { to: '/transport/stations', label: 'Stations' },
        { to: '/transport/riders', label: 'Riders' },
      ]}
    />
  )
}
