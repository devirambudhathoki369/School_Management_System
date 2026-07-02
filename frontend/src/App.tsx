import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './layouts/AppShell'
import DashboardPage from './pages/DashboardPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Route>
    </Routes>
  )
}
