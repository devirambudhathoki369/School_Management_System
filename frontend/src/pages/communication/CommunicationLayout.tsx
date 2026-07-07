import TabbedWorkspace from '../../components/TabbedWorkspace'

export default function CommunicationLayout() {
  return (
    <TabbedWorkspace
      ariaLabel="Communication sections"
      tabs={[
        { to: '/communication/notices', label: 'Notices' },
        { to: '/communication/calendar', label: 'Calendar' },
        { to: '/communication/templates', label: 'Templates' },
        { to: '/communication/deliveries', label: 'Delivery log' },
      ]}
    />
  )
}
