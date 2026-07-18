import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './layouts/AppShell'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import PeopleLayout from './pages/people/PeopleLayout'
import StudentsPage from './pages/people/StudentsPage'
import StudentProfilePage from './pages/people/StudentProfilePage'
import StaffPage from './pages/people/StaffPage'
import BulkPage from './pages/people/BulkPage'
import AcademicsLayout from './pages/academics/AcademicsLayout'
import ClassesPage from './pages/academics/ClassesPage'
import SubjectsPage from './pages/academics/SubjectsPage'
import StructurePage from './pages/academics/StructurePage'
import CohortBatchesPage from './pages/academics/BatchesPage'
import YearsPage from './pages/academics/YearsPage'
import HomeworkPage from './pages/homework/HomeworkPage'
import CommunicationLayout from './pages/communication/CommunicationLayout'
import NoticesPage from './pages/communication/NoticesPage'
import CalendarPage from './pages/communication/CalendarPage'
import TemplatesPage from './pages/communication/TemplatesPage'
import SendSMSPage from './pages/communication/SendSMSPage'
import DeliveriesPage from './pages/communication/DeliveriesPage'
import LibraryLayout from './pages/library/LibraryLayout'
import BooksPage from './pages/library/BooksPage'
import CirculationPage from './pages/library/CirculationPage'
import LibSettingsPage from './pages/library/LibSettingsPage'
import TransportLayout from './pages/transport/TransportLayout'
import StationsPage from './pages/transport/StationsPage'
import RidersPage from './pages/transport/RidersPage'
import InventoryLayout from './pages/inventory/InventoryLayout'
import StockPage from './pages/inventory/StockPage'
import MovementsPage from './pages/inventory/MovementsPage'
import BillingLayout from './pages/billing/BillingLayout'
import CollectPage from './pages/billing/CollectPage'
import ReceiptsPage from './pages/billing/ReceiptsPage'
import FeesPage from './pages/billing/FeesPage'
import BatchesPage from './pages/billing/BatchesPage'
import DiscountsPage from './pages/billing/DiscountsPage'
import OldDuesPage from './pages/billing/OldDuesPage'
import AccountingLayout from './pages/accounting/AccountingLayout'
import VouchersPage from './pages/accounting/VouchersPage'
import NewVoucherPage from './pages/accounting/NewVoucherPage'
import TrialBalancePage from './pages/accounting/TrialBalancePage'
import { BalanceSheetPage, CashFlowPage, ProfitLossPage } from './pages/accounting/FinancialStatementsPage'
import FiscalYearsPage from './pages/accounting/FiscalYearsPage'
import DevicesLayout from './pages/devices/DevicesLayout'
import RegistryPage from './pages/devices/RegistryPage'
import DeviceUsersPage from './pages/devices/DeviceUsersPage'
import PunchLogPage from './pages/devices/PunchLogPage'
import AuditLogPage from './pages/audit/AuditLogPage'
import ResultsPage from './pages/exams/ResultsPage'
import FinalResultsPage from './pages/exams/FinalResultsPage'
import ActivitiesPage from './pages/exams/ActivitiesPage'
import NewsPage from './pages/communication/NewsPage'
import StatementPage from './pages/accounting/StatementPage'
import LedgersPage from './pages/accounting/LedgersPage'
import AttendanceLayout from './pages/attendance/AttendanceLayout'
import MarkClassPage from './pages/attendance/MarkClassPage'
import DayOverviewPage from './pages/attendance/DayOverviewPage'
import StaffAttendancePage from './pages/attendance/StaffAttendancePage'
import ExamsLayout from './pages/exams/ExamsLayout'
import ExamsPage from './pages/exams/ExamsPage'
import EntryCardsPage from './pages/exams/EntryCardsPage'
import SeatPlanPage from './pages/exams/SeatPlanPage'
import CertificatesPage from './pages/exams/CertificatesPage'
import SheetsPage from './pages/exams/SheetsPage'
import MarksPage from './pages/exams/MarksPage'
import SchedulePage from './pages/exams/SchedulePage'
import GradingPage from './pages/exams/GradingPage'
import PayrollLayout from './pages/payroll/PayrollLayout'
import PaySalaryPage from './pages/payroll/PaySalaryPage'
import RunPayrollPage from './pages/payroll/RunPayrollPage'
import PaymentsPage from './pages/payroll/PaymentsPage'
import SalarySheetPage from './pages/payroll/SalarySheetPage'
import PostingsPage from './pages/payroll/PostingsPage'
import LedgerPage from './pages/payroll/LedgerPage'
import StructuresPage from './pages/payroll/StructuresPage'
import ReportsLayout, { ReportsIndex } from './pages/reports/ReportsLayout'
import TransactionsReportPage from './pages/reports/TransactionsReportPage'
import PostingsReportPage from './pages/reports/PostingsReportPage'
import DuesReportPage from './pages/reports/DuesReportPage'
import LedgersReportPage from './pages/reports/LedgersReportPage'
import IncomePlanPage from './pages/reports/IncomePlanPage'
import DiscountsReportPage from './pages/reports/DiscountsReportPage'
import OpeningBalancesPage from './pages/reports/OpeningBalancesPage'
import AdmissionsReportPage from './pages/reports/AdmissionsReportPage'
import StaffReportPage from './pages/reports/StaffReportPage'
import TransportReportPage from './pages/reports/TransportReportPage'
import HomeworkReportPage from './pages/reports/HomeworkReportPage'
import AttendanceReportPage from './pages/reports/AttendanceReportPage'
import IntegrityReportPage from './pages/reports/IntegrityReportPage'
import DemographicsPage from './pages/reports/DemographicsPage'
import { useAuth } from './lib/auth'
import { ForcedPasswordChange } from './components/ChangePassword'
import PortalShell from './layouts/PortalShell'
import PortalHome from './pages/portal/PortalHome'
import PortalNoticesPage from './pages/portal/PortalNoticesPage'
import PortalCalendarPage from './pages/portal/PortalCalendarPage'
import ChildLayout from './pages/portal/ChildLayout'
import ChildAttendancePage from './pages/portal/ChildAttendancePage'
import ChildResultsPage from './pages/portal/ChildResultsPage'
import ChildFeesPage from './pages/portal/ChildFeesPage'
import ChildHomeworkPage from './pages/portal/ChildHomeworkPage'

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
  if (account.password_change_required) {
    // Temp credentials (e.g. office-issued portal logins) never reach the
    // workspace — the holder must set their own password first.
    return <ForcedPasswordChange />
  }
  return <Outlet />
}

/** Guardians and students live in the portal; staff-side roles in the
 * console. Each side bounces the other's principal — never blended. */
const FAMILY_ROLES = new Set(['guardian', 'student'])

function RequireFamily() {
  const { account } = useAuth()
  if (!account || !FAMILY_ROLES.has(account.role)) {
    return <Navigate to="/dashboard" replace />
  }
  return <Outlet />
}

function RequireStaffSide() {
  const { account } = useAuth()
  if (account && FAMILY_ROLES.has(account.role)) {
    return <Navigate to="/portal" replace />
  }
  return <Outlet />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<RequireFamily />}>
          <Route element={<PortalShell />}>
            <Route path="/portal" element={<PortalHome />} />
            <Route path="/portal/notices" element={<PortalNoticesPage />} />
            <Route path="/portal/calendar" element={<PortalCalendarPage />} />
            <Route path="/portal/children/:childId" element={<ChildLayout />}>
              <Route index element={<Navigate to="attendance" replace />} />
              <Route path="attendance" element={<ChildAttendancePage />} />
              <Route path="results" element={<ChildResultsPage />} />
              <Route path="fees" element={<ChildFeesPage />} />
              <Route path="homework" element={<ChildHomeworkPage />} />
            </Route>
          </Route>
        </Route>
        <Route element={<RequireStaffSide />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/students" element={<Navigate to="/people/students" replace />} />
          <Route path="/people" element={<PeopleLayout />}>
            <Route index element={<Navigate to="students" replace />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="students/:studentId" element={<StudentProfilePage />} />
            <Route path="staff" element={<StaffPage />} />
            <Route path="bulk" element={<BulkPage />} />
          </Route>
          <Route path="/academics" element={<AcademicsLayout />}>
            <Route index element={<Navigate to="classes" replace />} />
            <Route path="classes" element={<ClassesPage />} />
            <Route path="subjects" element={<SubjectsPage />} />
            <Route path="structure" element={<StructurePage />} />
            <Route path="batches" element={<CohortBatchesPage />} />
            <Route path="years" element={<YearsPage />} />
          </Route>
          <Route path="/homework" element={<HomeworkPage />} />
          <Route path="/communication" element={<CommunicationLayout />}>
            <Route index element={<Navigate to="notices" replace />} />
            <Route path="notices" element={<NoticesPage />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="sms" element={<SendSMSPage />} />
            <Route path="deliveries" element={<DeliveriesPage />} />
          </Route>
          <Route path="/library" element={<LibraryLayout />}>
            <Route index element={<Navigate to="books" replace />} />
            <Route path="books" element={<BooksPage />} />
            <Route path="circulation" element={<CirculationPage />} />
            <Route path="settings" element={<LibSettingsPage />} />
          </Route>
          <Route path="/transport" element={<TransportLayout />}>
            <Route index element={<Navigate to="stations" replace />} />
            <Route path="stations" element={<StationsPage />} />
            <Route path="riders" element={<RidersPage />} />
          </Route>
          <Route path="/inventory" element={<InventoryLayout />}>
            <Route index element={<Navigate to="stock" replace />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="movements" element={<MovementsPage />} />
          </Route>
          <Route path="/billing" element={<BillingLayout />}>
            <Route index element={<Navigate to="collect" replace />} />
            <Route path="collect" element={<CollectPage />} />
            <Route path="receipts" element={<ReceiptsPage />} />
            <Route path="fees" element={<FeesPage />} />
            <Route path="batches" element={<BatchesPage />} />
            <Route path="discounts" element={<DiscountsPage />} />
            <Route path="old-dues" element={<OldDuesPage />} />
          </Route>
          <Route path="/accounting" element={<AccountingLayout />}>
            <Route index element={<Navigate to="vouchers" replace />} />
            <Route path="vouchers" element={<VouchersPage />} />
            <Route path="new" element={<NewVoucherPage />} />
            <Route path="trial-balance" element={<TrialBalancePage />} />
            <Route path="profit-loss" element={<ProfitLossPage />} />
            <Route path="balance-sheet" element={<BalanceSheetPage />} />
            <Route path="cash-flow" element={<CashFlowPage />} />
            <Route path="statement" element={<StatementPage />} />
            <Route path="ledgers" element={<LedgersPage />} />
            <Route path="fiscal-years" element={<FiscalYearsPage />} />
          </Route>
          <Route path="/devices" element={<DevicesLayout />}>
            <Route index element={<Navigate to="registry" replace />} />
            <Route path="registry" element={<RegistryPage />} />
            <Route path="users" element={<DeviceUsersPage />} />
            <Route path="punches" element={<PunchLogPage />} />
          </Route>
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/reports" element={<ReportsLayout />}>
            <Route index element={<ReportsIndex />} />
            <Route path="transactions" element={<TransactionsReportPage />} />
            <Route path="postings" element={<PostingsReportPage />} />
            <Route path="dues" element={<DuesReportPage />} />
            <Route path="ledgers" element={<LedgersReportPage />} />
            <Route path="income-plan" element={<IncomePlanPage />} />
            <Route path="discounts" element={<DiscountsReportPage />} />
            <Route path="opening-balances" element={<OpeningBalancesPage />} />
            <Route path="admissions" element={<AdmissionsReportPage />} />
            <Route path="staff" element={<StaffReportPage />} />
            <Route path="transport" element={<TransportReportPage />} />
            <Route path="homework" element={<HomeworkReportPage />} />
            <Route path="attendance" element={<AttendanceReportPage />} />
            <Route path="demographics" element={<DemographicsPage />} />
            <Route path="integrity" element={<IntegrityReportPage />} />
          </Route>
          <Route path="/attendance" element={<AttendanceLayout />}>
            <Route index element={<Navigate to="mark" replace />} />
            <Route path="mark" element={<MarkClassPage />} />
            <Route path="day" element={<DayOverviewPage />} />
            <Route path="staff" element={<StaffAttendancePage />} />
          </Route>
          <Route path="/exams" element={<ExamsLayout />}>
            <Route index element={<Navigate to="list" replace />} />
            <Route path="list" element={<ExamsPage />} />
            <Route path="sheets" element={<SheetsPage />} />
            <Route path="sheets/:sheetId/marks" element={<MarksPage />} />
            <Route path="results" element={<ResultsPage />} />
            <Route path="final" element={<FinalResultsPage />} />
            <Route path="activities" element={<ActivitiesPage />} />
            <Route path="entry-cards" element={<EntryCardsPage />} />
            <Route path="seat-plan" element={<SeatPlanPage />} />
            <Route path="certificates" element={<CertificatesPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="grading" element={<GradingPage />} />
          </Route>
          <Route path="/payroll" element={<PayrollLayout />}>
            <Route index element={<Navigate to="pay" replace />} />
            <Route path="pay" element={<PaySalaryPage />} />
            <Route path="run" element={<RunPayrollPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="sheet" element={<SalarySheetPage />} />
            <Route path="postings" element={<PostingsPage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="structures" element={<StructuresPage />} />
          </Route>
        </Route>
        </Route>
      </Route>
    </Routes>
  )
}
