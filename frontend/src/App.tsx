import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './layouts/AppShell'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import StudentsPage from './pages/StudentsPage'
import BillingLayout from './pages/billing/BillingLayout'
import CollectPage from './pages/billing/CollectPage'
import ReceiptsPage from './pages/billing/ReceiptsPage'
import FeesPage from './pages/billing/FeesPage'
import BatchesPage from './pages/billing/BatchesPage'
import DiscountsPage from './pages/billing/DiscountsPage'
import AccountingLayout from './pages/accounting/AccountingLayout'
import VouchersPage from './pages/accounting/VouchersPage'
import NewVoucherPage from './pages/accounting/NewVoucherPage'
import TrialBalancePage from './pages/accounting/TrialBalancePage'
import StatementPage from './pages/accounting/StatementPage'
import LedgersPage from './pages/accounting/LedgersPage'
import ExamsLayout from './pages/exams/ExamsLayout'
import ExamsPage from './pages/exams/ExamsPage'
import SheetsPage from './pages/exams/SheetsPage'
import MarksPage from './pages/exams/MarksPage'
import SchedulePage from './pages/exams/SchedulePage'
import GradingPage from './pages/exams/GradingPage'
import PayrollLayout from './pages/payroll/PayrollLayout'
import PaySalaryPage from './pages/payroll/PaySalaryPage'
import RunPayrollPage from './pages/payroll/RunPayrollPage'
import PaymentsPage from './pages/payroll/PaymentsPage'
import PostingsPage from './pages/payroll/PostingsPage'
import LedgerPage from './pages/payroll/LedgerPage'
import StructuresPage from './pages/payroll/StructuresPage'
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
          <Route path="/billing" element={<BillingLayout />}>
            <Route index element={<Navigate to="collect" replace />} />
            <Route path="collect" element={<CollectPage />} />
            <Route path="receipts" element={<ReceiptsPage />} />
            <Route path="fees" element={<FeesPage />} />
            <Route path="batches" element={<BatchesPage />} />
            <Route path="discounts" element={<DiscountsPage />} />
          </Route>
          <Route path="/accounting" element={<AccountingLayout />}>
            <Route index element={<Navigate to="vouchers" replace />} />
            <Route path="vouchers" element={<VouchersPage />} />
            <Route path="new" element={<NewVoucherPage />} />
            <Route path="trial-balance" element={<TrialBalancePage />} />
            <Route path="statement" element={<StatementPage />} />
            <Route path="ledgers" element={<LedgersPage />} />
          </Route>
          <Route path="/exams" element={<ExamsLayout />}>
            <Route index element={<Navigate to="list" replace />} />
            <Route path="list" element={<ExamsPage />} />
            <Route path="sheets" element={<SheetsPage />} />
            <Route path="sheets/:sheetId/marks" element={<MarksPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="grading" element={<GradingPage />} />
          </Route>
          <Route path="/payroll" element={<PayrollLayout />}>
            <Route index element={<Navigate to="pay" replace />} />
            <Route path="pay" element={<PaySalaryPage />} />
            <Route path="run" element={<RunPayrollPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="postings" element={<PostingsPage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="structures" element={<StructuresPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
