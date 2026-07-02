import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './layouts/AppShell'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import StudentsPage from './pages/StudentsPage'
import { useAuth } from './lib/auth'

function RequireAuth() {
  const { account, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-ink-muted">
        Restoring session…
      </div>
    )
  }
  if (!account) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return <Outlet />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/students" element={<StudentsPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
