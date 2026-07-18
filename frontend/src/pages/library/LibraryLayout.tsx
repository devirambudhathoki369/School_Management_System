import TabbedWorkspace from '../../components/TabbedWorkspace'

export default function LibraryLayout() {
  return (
    <TabbedWorkspace
      ariaLabel="Library sections"
      tabs={[
        { to: '/library/books', label: 'Catalog' },
        { to: '/library/circulation', label: 'Circulation' },
        { to: '/library/reports', label: 'Reports' },
        { to: '/library/barcodes', label: 'Barcodes' },
        { to: '/library/settings', label: 'Libraries' },
      ]}
    />
  )
}
