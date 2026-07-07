import TabbedWorkspace from '../../components/TabbedWorkspace'

export default function InventoryLayout() {
  return (
    <TabbedWorkspace
      ariaLabel="Inventory sections"
      tabs={[
        { to: '/inventory/stock', label: 'Stock' },
        { to: '/inventory/movements', label: 'Movements' },
      ]}
    />
  )
}
