import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { useAuth, useMeta } from './context.jsx';
import Login from './pages/Login.jsx';
import Billing from './pages/Billing.jsx';
import { AcceptInvite, ForgotPassword, ResetPassword, Signup } from './pages/AuthPages.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import ContactWorkspace from './pages/ContactWorkspace.jsx';
import { AgentDetail, Agents, Commissions, Notes, Pipeline, SmartLists, Tasks } from './pages/CrmPages.jsx';
import Properties from './pages/Properties.jsx';
import PropertyForm from './pages/PropertyForm.jsx';
import PropertyDetail from './pages/PropertyDetail.jsx';
import { DevUpdates, ProjectFinancials, ProjectList, ProjectUnits, ProjectWorkspace } from './pages/Projects.jsx';
import { SaleDetail, SaleForm, SaleList } from './pages/Sales.jsx';
import Branding from './pages/Branding.jsx';
import Goals from './pages/Goals.jsx';
import WebsiteEditor from './pages/WebsiteEditor.jsx';
import SiteApp from './site/SiteApp.jsx';
import { InstallmentsPage, ReceiptDetail, ReceiptForm, ReceiptList, Receivables } from './pages/Receipts.jsx';
import { CustomerList, CustomerPortalAdmin, CustomerStatement } from './pages/Customers.jsx';
import { AccountStatement, AccountingDashboard, BalanceSheet, ChartOfAccounts, IncomeStatement, Journals, Treasury } from './pages/Accounting.jsx';
import { CreditBook, ExpenseDetail, ExpenseForm, ExpenseList, VendorDetail, VendorLedgerPicker, VendorList } from './pages/Vendors.jsx';
import { EmployeeDocuments, EmployeeProfile, Employees, HrReports, Recruitment, Salary } from './pages/Hrm.jsx';
import Reports from './pages/Reports.jsx';
import { AuditLog, CategorySettings, CommissionRules, CustomFields, LeadStages, NotificationSettings, NotificationsPage, PaymentMethods, PropertySettings, Roles, SystemSettings, Users, LookupSettings } from './pages/Settings.jsx';
import { PortalDashboard, PortalDevelopment, PortalDocuments, PortalLayout, PortalNotifications, PortalOffers, PortalPayments, PortalProperty, PortalConstruction } from './pages/Portal.jsx';
import Security from './pages/Security.jsx';
import { MyAttendance, MyLeave, MyPayroll, MyProfile, MyTasks } from './pages/MySpace.jsx';
import InstallApp from './pages/InstallApp.jsx';
import { AttendanceBoard, Assets, LeaveBoard } from './pages/HrExtras.jsx';
import Content from './pages/Content.jsx';
import Promos from './pages/Promos.jsx';
import PlotMap from './pages/PlotMap.jsx';
import { TenderDetail, TenderList } from './pages/Tenders.jsx';
import ListingApprovals from './pages/ListingApprovals.jsx';
import SeoManager from './pages/SeoManager.jsx';
import PaymentClaims from './pages/PaymentClaims.jsx';
import BotKnowledge from './pages/BotKnowledge.jsx';
import { VendorBids, VendorDashboard, VendorLayout, VendorLedger, VendorPayments, VendorProfile, VendorTenderDetail, VendorTenders } from './pages/VendorPortal.jsx';
import Customer360 from './pages/Customer360.jsx';
import PlatformConsole from './pages/PlatformConsole.jsx';
import MarketingSite from './marketing/Marketing.jsx';
import { VerifyEmail } from './pages/AuthPages.jsx';
import Mortgage from './pages/Mortgage.jsx';
import Documents from './pages/Documents.jsx';
import Integrations from './pages/Integrations.jsx';
import Dialer from './pages/Dialer.jsx';
import Appointments from './pages/Appointments.jsx';
import AIStudio from './pages/AIStudio.jsx';
import Meetings from './pages/Meetings.jsx';
import Recordings from './pages/Recordings.jsx';
import MeetingRoom from './meet/MeetingRoom.jsx';
import { ConstructionOverview, ConstructionProject, EstimatesPage, MaterialsPage, PurchaseOrdersPage, SubcontractsPage } from './pages/Construction.jsx';

/**
 * Main domain (multi-tenant mode): the public website. On a workspace address, or in a single-company install, the same
 * paths keep their old meaning ("/" goes to the company's own /site, /login and /signup are the workspace pages).
 */
function MainGate({ fallback }) {
  const [info, setInfo] = useState(null);
  useEffect(() => { api.get('/api/platform/site').then(setInfo).catch(() => setInfo({ landing: false })); }, []);
  if (!info) return <Loading />;
  return info.landing ? <MarketingSite /> : fallback;
}

/** Route-level permission gate (the API enforces the same rules; this just avoids dead-end pages). */
function Guard({ module, action = 'view', children }) {
  const { can } = useAuth();
  if (module && !can(module, action)) return <div className="empty" style={{ paddingTop: 80 }}><h2>No access</h2><p>Your role doesn’t include permission to {action} {module}.</p></div>;
  return children;
}
/** The Asset Library is shared by HR and Finance. */
function LibraryGuard({ children }) {
  const { can } = useAuth();
  if (!can('hrm', 'view') && !can('accounting', 'view')) return <div className="empty" style={{ paddingTop: 80 }}><h2>No access</h2><p>Your role doesn’t include permission to view the asset library.</p></div>;
  return children;
}
const G = (module, el, action) => <Guard module={module} action={action}>{el}</Guard>;

export default function App() {
  const { user } = useAuth();
  const { meta } = useMeta();
  const loc = useLocation();
  if (loc.pathname.startsWith('/meet/')) return <Routes><Route path="/meet/:code" element={<MeetingRoom />} /></Routes>;
  if (loc.pathname === '/site' || loc.pathname.startsWith('/site/')) return <Routes><Route path="/site/*" element={<SiteApp />} /></Routes>;
  if (loc.pathname.startsWith('/verify-email/')) return <Routes><Route path="/verify-email/:token" element={<VerifyEmail />} /></Routes>;
  if (loc.pathname === '/platform' || loc.pathname.startsWith('/platform/')) return <Routes><Route path="/platform/*" element={<PlatformConsole />} /></Routes>;
  if (user === undefined) return <Loading />;

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<MainGate fallback={<Navigate to="/site" replace />} />} />
        {['/real-estate', '/construction', '/preview', '/pricing', '/contact', '/legal/:slug'].map((p) => <Route key={p} path={p} element={<MainGate fallback={<Navigate to="/login" replace />} />} />)}
        <Route path="/portal/login" element={<Login portal />} />
        <Route path="/vendor/login" element={<Login portal vendor />} />
        <Route path="/login" element={<MainGate fallback={<Login />} />} />
        <Route path="/signup" element={<MainGate fallback={<Signup />} />} />
        <Route path="/forgot-password" element={<MainGate fallback={<ForgotPassword />} />} />
        <Route path="/reset-password/:token" element={<MainGate fallback={<ResetPassword />} />} />
        <Route path="/invite/:token" element={<MainGate fallback={<AcceptInvite />} />} />
        <Route path="*" element={<Navigate to={loc.pathname.startsWith('/portal') ? `/portal/login?next=${encodeURIComponent(loc.pathname)}` : loc.pathname.startsWith('/vendor') ? `/vendor/login?next=${encodeURIComponent(loc.pathname)}` : '/login'} replace />} />
      </Routes>
    );
  }
  if (user.portal && user.vendor_id) {
    return (
      <Routes>
        <Route path="/vendor" element={<VendorLayout />}>
          <Route index element={<VendorDashboard />} /><Route path="payments" element={<VendorPayments />} /><Route path="ledger" element={<VendorLedger />} />
          <Route path="tenders" element={<VendorTenders />} /><Route path="tenders/:id" element={<VendorTenderDetail />} /><Route path="bids" element={<VendorBids />} /><Route path="profile" element={<VendorProfile />} />
        </Route>
        <Route path="*" element={<Navigate to="/vendor" replace />} />
      </Routes>
    );
  }
  if (user.portal) {
    return (
      <Routes>
        <Route path="/portal" element={<PortalLayout />}>
          <Route index element={<PortalDashboard />} /><Route path="property/:id" element={<PortalProperty />} /><Route path="development" element={<PortalDevelopment />} />
          <Route path="payments" element={<PortalPayments />} /><Route path="notifications" element={<PortalNotifications />} /><Route path="documents" element={<PortalDocuments />} /><Route path="offers" element={<PortalOffers />} /><Route path="construction" element={<PortalConstruction />} />
        </Route>
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    );
  }
  if (!meta) return <Loading />;

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/portal/*" element={<Navigate to="/" replace />} />
      <Route path="/vendor/*" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={G('dashboard', <Dashboard />)} />
        {/* CRM */}
        <Route path="contacts" element={G('crm', <Contacts />)} />
        <Route path="leads" element={G('crm', <Contacts type="lead" title="Leads" />)} />
        <Route path="contacts/:id" element={G('crm', <ContactWorkspace />)} />
        <Route path="smart-lists" element={G('crm', <SmartLists />)} />
        <Route path="pipeline" element={G('crm', <Pipeline />)} />
        <Route path="tasks" element={G('crm', <Tasks />)} />
        <Route path="notes" element={G('crm', <Notes />)} />
        <Route path="goals" element={G('crm', <Goals />)} />
        <Route path="agents" element={G('crm', <Agents />)} />
        <Route path="agents/:id" element={G('crm', <AgentDetail />)} />
        <Route path="commissions" element={G('commissions', <Commissions />)} />
        {/* Properties */}
        <Route path="properties" element={G('properties', <Properties />)} />
        <Route path="listings/approvals" element={G('listings', <ListingApprovals />)} />
        <Route path="properties/featured" element={G('properties', <Properties preset="featured" />)} />
        <Route path="properties/draft" element={G('properties', <Properties preset="draft" />)} />
        <Route path="properties/sold" element={G('properties', <Properties preset="sold" />)} />
        <Route path="properties/reserved" element={G('properties', <Properties preset="reserved" />)} />
        <Route path="properties/types" element={G('settings', <PropertySettings />)} />
        <Route path="properties/new" element={G('properties', <PropertyForm />, 'create')} />
        <Route path="properties/:id" element={G('properties', <PropertyDetail />)} />
        <Route path="properties/:id/edit" element={G('properties', <PropertyForm />, 'edit')} />
        {/* Projects */}
        <Route path="projects" element={G('projects', <ProjectList />)} />
        <Route path="projects/construction" element={G('projects', <ProjectList kind="construction" />)} />
        <Route path="projects/development" element={G('projects', <ProjectList development />)} />
        <Route path="projects/units" element={G('projects', <ProjectUnits />)} />
        <Route path="projects/updates" element={G('projects', <DevUpdates />)} />
        <Route path="projects/financials" element={G('accounting', <ProjectFinancials />)} />
        <Route path="projects/map" element={G('properties', <PlotMap />)} />
        <Route path="projects/:id" element={G('projects', <ProjectWorkspace />)} />
        <Route path="mortgage" element={G('crm', <Mortgage />)} />
        <Route path="documents" element={G('crm', <Documents />)} />
        <Route path="dialer" element={G('crm', <Dialer />)} />
        <Route path="appointments" element={G('crm', <Appointments />)} />
        <Route path="ai-studio" element={G('crm', <AIStudio />)} />
        <Route path="meetings" element={G('crm', <Meetings />)} />
        <Route path="recordings" element={G('crm', <Recordings />)} />
        <Route path="settings/integrations" element={G('crm', <Integrations />)} />
        {/* Construction */}
        <Route path="construction" element={G('construction', <ConstructionOverview />)} />
        <Route path="construction/projects/:id" element={G('construction', <ConstructionProject />)} />
        <Route path="construction/estimates" element={G('construction', <EstimatesPage />)} />
        <Route path="construction/purchase-orders" element={G('construction', <PurchaseOrdersPage />)} />
        <Route path="construction/materials" element={G('construction', <MaterialsPage />)} />
        <Route path="construction/subcontracts" element={G('construction', <SubcontractsPage />)} />
        {/* Customers & sales */}
        <Route path="customers" element={G('customers', <CustomerList />)} />
        <Route path="customers/active" element={G('customers', <CustomerList segment="active" />)} />
        <Route path="customers/buyers" element={G('customers', <CustomerList segment="buyers" />)} />
        <Route path="customers/installment" element={G('customers', <CustomerList segment="installment" />)} />
        <Route path="customers/portal" element={G('customers', <CustomerPortalAdmin />, 'edit')} />
        <Route path="customers/:id/360" element={G('customers', <Customer360 />)} />
        <Route path="customers/:id/statement" element={G('customers', <CustomerStatement />)} />
        <Route path="sales" element={G('sales', <SaleList />)} />
        <Route path="sales/construction" element={G('sales', <SaleList kind="construction" />)} />
        <Route path="sales/new" element={G('sales', <SaleForm />, 'create')} />
        <Route path="sales/:id" element={G('sales', <SaleDetail />)} />
        {/* Accounting */}
        <Route path="accounting" element={G('accounting', <AccountingDashboard />)} />
        <Route path="accounting/coa" element={G('accounting', <ChartOfAccounts />)} />
        <Route path="accounting/income-statement" element={G('accounting', <IncomeStatement />)} />
        <Route path="accounting/balance-sheet" element={G('accounting', <BalanceSheet />)} />
        <Route path="accounting/statement" element={G('accounting', <AccountStatement />)} />
        <Route path="accounting/treasury" element={G('accounting', <Treasury />)} />
        <Route path="accounting/banks" element={G('accounting', <Treasury banksOnly />)} />
        <Route path="accounting/journals" element={G('accounting', <Journals />)} />
        <Route path="receipts" element={G('payments', <ReceiptList />)} />
        <Route path="receipts/new" element={G('payments', <ReceiptForm />, 'create')} />
        <Route path="receipts/:id" element={G('payments', <ReceiptDetail />)} />
        <Route path="expenses" element={G('accounting', <ExpenseList />)} />
        <Route path="expenses/new" element={G('accounting', <ExpenseForm />, 'create')} />
        <Route path="expenses/:id" element={G('accounting', <ExpenseDetail />)} />
        {/* Payments */}
        <Route path="payments/claims" element={G('payments', <PaymentClaims />)} />
        <Route path="payments/installments" element={G('payments', <InstallmentsPage />)} />
        <Route path="payments/advance" element={G('payments', <ReceiptList preset="advance" title="Advance payments" />)} />
        <Route path="payments/balloon" element={G('payments', <InstallmentsPage preset="balloon" />)} />
        <Route path="payments/receivables" element={G('payments', <Receivables />)} />
        <Route path="payments/history" element={G('payments', <ReceiptList title="Payment history" />)} />
        {/* Vendors */}
        <Route path="vendors" element={G('vendors', <VendorList />)} />
        <Route path="vendors/tenders" element={G('vendors', <TenderList />)} />
        <Route path="vendors/tenders/:id" element={G('vendors', <TenderDetail />)} />
        <Route path="vendors/ledger" element={G('vendors', <VendorLedgerPicker />)} />
        <Route path="vendors/purchases" element={G('accounting', <ExpenseList vendorsOnly />)} />
        <Route path="vendors/credit-book" element={G('vendors', <CreditBook />)} />
        <Route path="vendors/:id" element={G('vendors', <VendorDetail />)} />
        {/* HRM */}
        <Route path="hrm/employees" element={G('hrm', <Employees />)} />
        <Route path="hrm/employees/:id" element={G('hrm', <EmployeeProfile />)} />
        <Route path="hrm/documents" element={G('hrm', <EmployeeDocuments />)} />
        <Route path="hrm/salary" element={G('hrm', <Salary />)} />
        <Route path="hrm/bonuses" element={G('hrm', <Salary bonuses />)} />
        <Route path="hrm/attendance" element={G('hrm', <AttendanceBoard />)} />
        <Route path="hrm/leave" element={<LeaveBoard />} />
        <Route path="hrm/assets" element={<LibraryGuard><Assets /></LibraryGuard>} />
        <Route path="assets" element={<LibraryGuard><Assets /></LibraryGuard>} />
        <Route path="hrm/recruitment" element={G('hrm', <Recruitment />)} />
        <Route path="hrm/reports" element={G('hrm', <HrReports />)} />
        {/* Reports */}
        <Route path="reports" element={<Navigate to="/reports/Sales" replace />} />
        <Route path="reports/:group" element={G('reports', <Reports />)} />
        {/* Settings */}
        <Route path="settings" element={<Navigate to="/settings/users" replace />} />
        <Route path="settings/users" element={G('settings', <Users />)} />
        <Route path="settings/billing" element={G('settings', <Billing />)} />
        <Route path="settings/roles" element={G('settings', <Roles />)} />
        <Route path="settings/custom-fields" element={G('settings', <CustomFields />)} />
        <Route path="settings/property" element={G('settings', <PropertySettings />)} />
        <Route path="settings/payment-methods" element={G('settings', <PaymentMethods />)} />
        <Route path="settings/lead-stages" element={G('settings', <LeadStages />)} />
        <Route path="settings/categories" element={G('settings', <CategorySettings />)} />
        <Route path="settings/commission-rules" element={G('settings', <CommissionRules />)} />
        <Route path="settings/notifications" element={G('settings', <NotificationSettings />)} />
        <Route path="settings/system" element={G('settings', <SystemSettings />)} />
        <Route path="settings/branding" element={G('settings', <Branding />)} />
        <Route path="settings/audit" element={G('settings', <AuditLog />)} />
        {/* My space — every staff login */}
        <Route path="my" element={<Navigate to="/my/profile" replace />} />
        <Route path="my/profile" element={<MyProfile />} />
        <Route path="my/security" element={<Security />} />
        <Route path="my/install-app" element={<InstallApp />} />
        <Route path="my/attendance" element={<MyAttendance />} />
        <Route path="my/leave" element={<MyLeave />} />
        <Route path="my/payroll" element={<MyPayroll />} />
        <Route path="my/tasks" element={<MyTasks />} />
        <Route path="content" element={G('content', <Content />)} />
        <Route path="customers/promos" element={G('customers', <Promos />, 'edit')} />
        <Route path="website" element={G('website', <WebsiteEditor />)} />
        <Route path="website/seo" element={G('seo', <SeoManager />)} />
        <Route path="website/assistant" element={G('website', <BotKnowledge />)} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="*" element={<div className="empty" style={{ paddingTop: 80 }}><h2>Page not found</h2></div>} />
      </Route>
    </Routes>
  );
}
