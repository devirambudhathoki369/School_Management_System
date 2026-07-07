import TabbedWorkspace from '../../components/TabbedWorkspace'

export default function LibraryLayout() {
  return (
    <TabbedWorkspace
      ariaLabel="Library sections"
      tabs={[
        { to: '/library/books', label: 'Catalog' },
        { to: '/library/circulation', label: 'Circulation' },
        { to: '/library/settings', label: 'Libraries' },
      ]}
    />
  )
}
