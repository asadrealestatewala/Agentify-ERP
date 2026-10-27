import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './api.js';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import StaffGate from './pages/StaffGate.jsx';
import Layout from './components/Layout.jsx';
import { Card, Empty, Loading } from './components/ui.jsx';
import { useAuth, useMeta } from './context.jsx';
import Login from './pages/Login.jsx';
const Billing = lazy(() => import('./pages/Billing.jsx'));
import { AcceptInvite, ForgotPassword, ResetPassword, Signup } from './pages/AuthPages.jsx';
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Contacts = lazy(() => import('./pages/Contacts.jsx'));
const ContactWorkspace = lazy(() => import('./pages/ContactWorkspace.jsx'));
const AgentDetail = lazy(() => import('./pages/CrmPages.jsx').then((m) => ({ default: m.AgentDetail })));
const Agents = lazy(() => import('./pages/CrmPages.jsx').then((m) => ({ default: m.Agents })));
const Commissions = lazy(() => import('./pages/CrmPages.jsx').then((m) => ({ default: m.Commissions })));
const Notes = lazy(() => import('./pages/CrmPages.jsx').then((m) => ({ default: m.Notes })));
const Pipeline = lazy(() => import('./pages/CrmPages.jsx').then((m) => ({ default: m.Pipeline })));
const SmartLists = lazy(() => import('./pages/CrmPages.jsx').then((m) => ({ default: m.SmartLists })));
const Tasks = lazy(() => import('./pages/CrmPages.jsx').then((m) => ({ default: m.Tasks })));
const Properties = lazy(() => import('./pages/Properties.jsx'));
const PropertyForm = lazy(() => import('./pages/PropertyForm.jsx'));
const PropertyDetail = lazy(() => import('./pages/PropertyDetail.jsx'));
const DevUpdates = lazy(() => import('./pages/Projects.jsx').then((m) => ({ default: m.DevUpdates })));
const ProjectFinancials = lazy(() => import('./pages/Projects.jsx').then((m) => ({ default: m.ProjectFinancials })));
const ProjectList = lazy(() => import('./pages/Projects.jsx').then((m) => ({ default: m.ProjectList })));
const ProjectUnits = lazy(() => import('./pages/Projects.jsx').then((m) => ({ default: m.ProjectUnits })));
const ProjectWorkspace = lazy(() => import('./pages/Projects.jsx').then((m) => ({ default: m.ProjectWorkspace })));
const SaleDetail = lazy(() => import('./pages/Sales.jsx').then((m) => ({ default: m.SaleDetail })));
const SaleForm = lazy(() => import('./pages/Sales.jsx').then((m) => ({ default: m.SaleForm })));
const SaleList = lazy(() => import('./pages/Sales.jsx').then((m) => ({ default: m.SaleList })));
const Branding = lazy(() => import('./pages/Branding.jsx'));
const Goals = lazy(() => import('./pages/Goals.jsx'));
const SiteApp = lazy(() => import('./site/SiteApp.jsx'));
const WebsiteStudio = lazy(() => import('./pages/website/WebsiteStudio.jsx'));
const InstallmentsPage = lazy(() => import('./pages/Receipts.jsx').then((m) => ({ default: m.InstallmentsPage })));
const ReceiptDetail = lazy(() => import('./pages/Receipts.jsx').then((m) => ({ default: m.ReceiptDetail })));
const ReceiptForm = lazy(() => import('./pages/Receipts.jsx').then((m) => ({ default: m.ReceiptForm })));
const ReceiptList = lazy(() => import('./pages/Receipts.jsx').then((m) => ({ default: m.ReceiptList })));
const Receivables = lazy(() => import('./pages/Receipts.jsx').then((m) => ({ default: m.Receivables })));
const CustomerList = lazy(() => import('./pages/Customers.jsx').then((m) => ({ default: m.CustomerList })));
const CustomerPortalAdmin = lazy(() => import('./pages/Customers.jsx').then((m) => ({ default: m.CustomerPortalAdmin })));
const CustomerStatement = lazy(() => import('./pages/Customers.jsx').then((m) => ({ default: m.CustomerStatement })));
const AccountStatement = lazy(() => import('./pages/Accounting.jsx').then((m) => ({ default: m.AccountStatement })));
const AccountingDashboard = lazy(() => import('./pages/Accounting.jsx').then((m) => ({ default: m.AccountingDashboard })));
const BalanceSheet = lazy(() => import('./pages/Accounting.jsx').then((m) => ({ default: m.BalanceSheet })));
const ChartOfAccounts = lazy(() => import('./pages/Accounting.jsx').then((m) => ({ default: m.ChartOfAccounts })));
const IncomeStatement = lazy(() => import('./pages/Accounting.jsx').then((m) => ({ default: m.IncomeStatement })));
const Journals = lazy(() => import('./pages/Accounting.jsx').then((m) => ({ default: m.Journals })));
const Treasury = lazy(() => import('./pages/Accounting.jsx').then((m) => ({ default: m.Treasury })));
const CreditBook = lazy(() => import('./pages/Vendors.jsx').then((m) => ({ default: m.CreditBook })));
const ExpenseDetail = lazy(() => import('./pages/Vendors.jsx').then((m) => ({ default: m.ExpenseDetail })));
const ExpenseForm = lazy(() => import('./pages/Vendors.jsx').then((m) => ({ default: m.ExpenseForm })));
const ExpenseList = lazy(() => import('./pages/Vendors.jsx').then((m) => ({ default: m.ExpenseList })));
const VendorDetail = lazy(() => import('./pages/Vendors.jsx').then((m) => ({ default: m.VendorDetail })));
const VendorLedgerPicker = lazy(() => import('./pages/Vendors.jsx').then((m) => ({ default: m.VendorLedgerPicker })));
const VendorList = lazy(() => import('./pages/Vendors.jsx').then((m) => ({ default: m.VendorList })));
const EmployeeDocuments = lazy(() => import('./pages/Hrm.jsx').then((m) => ({ default: m.EmployeeDocuments })));
const EmployeeProfile = lazy(() => import('./pages/Hrm.jsx').then((m) => ({ default: m.EmployeeProfile })));
const Employees = lazy(() => import('./pages/Hrm.jsx').then((m) => ({ default: m.Employees })));
const HrReports = lazy(() => import('./pages/Hrm.jsx').then((m) => ({ default: m.HrReports })));
const Recruitment = lazy(() => import('./pages/Hrm.jsx').then((m) => ({ default: m.Recruitment })));
const Salary = lazy(() => import('./pages/Hrm.jsx').then((m) => ({ default: m.Salary })));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const AuditLog = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.AuditLog })));
const CategorySettings = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.CategorySettings })));
const CommissionRules = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.CommissionRules })));
const CustomFields = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.CustomFields })));
const LeadStages = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.LeadStages })));
const NotificationSettings = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.NotificationSettings })));
const NotificationsPage = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.NotificationsPage })));
const PaymentMethods = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.PaymentMethods })));
const PropertySettings = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.PropertySettings })));
const Roles = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.Roles })));
const SystemSettings = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.SystemSettings })));
const Users = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.Users })));
const LookupSettings = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.LookupSettings })));
const PortalDashboard = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalDashboard })));
const PortalDevelopment = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalDevelopment })));
const PortalDocuments = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalDocuments })));
const PortalLayout = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalLayout })));
const PortalNotifications = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalNotifications })));
const PortalOffers = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalOffers })));
const PortalPayments = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalPayments })));
const PortalProperty = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalProperty })));
const PortalConstruction = lazy(() => import('./pages/Portal.jsx').then((m) => ({ default: m.PortalConstruction })));
const Security = lazy(() => import('./pages/Security.jsx'));
const MyAttendance = lazy(() => import('./pages/MySpace.jsx').then((m) => ({ default: m.MyAttendance })));
const MyLeave = lazy(() => import('./pages/MySpace.jsx').then((m) => ({ default: m.MyLeave })));
const MyPayroll = lazy(() => import('./pages/MySpace.jsx').then((m) => ({ default: m.MyPayroll })));
const MyProfile = lazy(() => import('./pages/MySpace.jsx').then((m) => ({ default: m.MyProfile })));
const MyTasks = lazy(() => import('./pages/MySpace.jsx').then((m) => ({ default: m.MyTasks })));
const MyLocation = lazy(() => import('./pages/FieldLocation.jsx').then((m) => ({ default: m.MyLocation })));
const FieldCoverage = lazy(() => import('./pages/FieldLocation.jsx').then((m) => ({ default: m.FieldCoverage })));
const InstallApp = lazy(() => import('./pages/InstallApp.jsx'));
const TrainingLibrary = lazy(() => import('./pages/TrainingLibrary.jsx'));
const AttendanceBoard = lazy(() => import('./pages/HrExtras.jsx').then((m) => ({ default: m.AttendanceBoard })));
const Assets = lazy(() => import('./pages/HrExtras.jsx').then((m) => ({ default: m.Assets })));
const LeaveBoard = lazy(() => import('./pages/HrExtras.jsx').then((m) => ({ default: m.LeaveBoard })));
const MyOnboarding = lazy(() => import('./pages/Onboarding.jsx').then((m) => ({ default: m.MyOnboarding })));
const OnboardingDetail = lazy(() => import('./pages/Onboarding.jsx').then((m) => ({ default: m.OnboardingDetail })));
const OnboardingHome = lazy(() => import('./pages/Onboarding.jsx').then((m) => ({ default: m.OnboardingHome })));
const WhatsNew = lazy(() => import('./pages/WhatsNew.jsx'));
const Content = lazy(() => import('./pages/Content.jsx'));
const Promos = lazy(() => import('./pages/Promos.jsx'));
const PlotMap = lazy(() => import('./pages/PlotMap.jsx'));
const TenderDetail = lazy(() => import('./pages/Tenders.jsx').then((m) => ({ default: m.TenderDetail })));
const TenderList = lazy(() => import('./pages/Tenders.jsx').then((m) => ({ default: m.TenderList })));
const ListingApprovals = lazy(() => import('./pages/ListingApprovals.jsx'));
const SeoManager = lazy(() => import('./pages/SeoManager.jsx'));
const PaymentClaims = lazy(() => import('./pages/PaymentClaims.jsx'));
const BotKnowledge = lazy(() => import('./pages/BotKnowledge.jsx'));
const VendorBids = lazy(() => import('./pages/VendorPortal.jsx').then((m) => ({ default: m.VendorBids })));
const VendorDashboard = lazy(() => import('./pages/VendorPortal.jsx').then((m) => ({ default: m.VendorDashboard })));
const VendorLayout = lazy(() => import('./pages/VendorPortal.jsx').then((m) => ({ default: m.VendorLayout })));
const VendorLedger = lazy(() => import('./pages/VendorPortal.jsx').then((m) => ({ default: m.VendorLedger })));
const VendorPayments = lazy(() => import('./pages/VendorPortal.jsx').then((m) => ({ default: m.VendorPayments })));
const VendorProfile = lazy(() => import('./pages/VendorPortal.jsx').then((m) => ({ default: m.VendorProfile })));
const VendorTenderDetail = lazy(() => import('./pages/VendorPortal.jsx').then((m) => ({ default: m.VendorTenderDetail })));
const VendorTenders = lazy(() => import('./pages/VendorPortal.jsx').then((m) => ({ default: m.VendorTenders })));
const Customer360 = lazy(() => import('./pages/Customer360.jsx'));
const PlatformConsole = lazy(() => import('./pages/PlatformConsole.jsx'));
const MarketingSite = lazy(() => import('./marketing/Marketing.jsx'));
import { VerifyEmail } from './pages/AuthPages.jsx';
const Mortgage = lazy(() => import('./pages/Mortgage.jsx'));
const Documents = lazy(() => import('./pages/Documents.jsx'));
const Integrations = lazy(() => import('./pages/Integrations.jsx'));
const WebsiteIntegrations = lazy(() => import('./pages/WebsiteIntegrations.jsx'));
const PaymentGateways = lazy(() => import('./pages/PaymentGateways.jsx'));
const EmailSettings = lazy(() => import('./pages/EmailSettings.jsx'));
const LeadRouting = lazy(() => import('./pages/LeadRouting.jsx'));
const Sequences = lazy(() => import('./pages/Sequences.jsx'));
const WhatsApp = lazy(() => import('./pages/WhatsApp.jsx'));
const WhatsAppSettings = lazy(() => import('./pages/WhatsAppSettings.jsx'));
const Conversion = lazy(() => import('./pages/Conversion.jsx'));
const Dialer = lazy(() => import('./pages/Dialer.jsx'));
const Appointments = lazy(() => import('./pages/Appointments.jsx'));
const AIStudio = lazy(() => import('./pages/AIStudio.jsx'));
const Meetings = lazy(() => import('./pages/Meetings.jsx'));
const Recordings = lazy(() => import('./pages/Recordings.jsx'));
const MeetingRoom = lazy(() => import('./meet/MeetingRoom.jsx'));
const ConstructionOverview = lazy(() => import('./pages/Construction.jsx').then((m) => ({ default: m.ConstructionOverview })));
const ConstructionProject = lazy(() => import('./pages/Construction.jsx').then((m) => ({ default: m.ConstructionProject })));
const EstimatesPage = lazy(() => import('./pages/Construction.jsx').then((m) => ({ default: m.EstimatesPage })));
const MaterialsPage = lazy(() => import('./pages/Construction.jsx').then((m) => ({ default: m.MaterialsPage })));
const PurchaseOrdersPage = lazy(() => import('./pages/Construction.jsx').then((m) => ({ default: m.PurchaseOrdersPage })));
const SubcontractsPage = lazy(() => import('./pages/Construction.jsx').then((m) => ({ default: m.SubcontractsPage })));

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

/** The website studio is the only website editor. People who can only view get a short note instead of a read-only editor. */
function WebsiteHome() {
  const { can } = useAuth();
  return can('website', 'edit') ? <Suspense fallback={<Loading />}><WebsiteStudio /></Suspense> : <Card title="Website"><Empty icon="globe" title="You can view the website but not edit it" hint="Ask an administrator for website edit access to use the editor." action={<a className="btn" href="/site" target="_blank" rel="noreferrer">View the website</a>} /></Card>;
}

/** The home page: a free website account has no dashboard, so it opens on the website editor. */
function Home() {
  const [site, setSite] = useState(null);
  useEffect(() => { api.get('/api/billing/status').then((b) => setSite(b.product === 'website')).catch(() => setSite(false)); }, []);
  if (site === null) return <Loading />;
  return site ? <Navigate to="/website" replace /> : G('dashboard', <Dashboard />);
}

export default function App() {
  const { user } = useAuth();
  const { meta } = useMeta();
  const loc = useLocation();
  if (loc.pathname.startsWith('/meet/')) return <Suspense fallback={<Loading />}><Routes><Route path="/meet/:code" element={<MeetingRoom />} /></Routes></Suspense>;
  if (loc.pathname === '/site' || loc.pathname.startsWith('/site/')) return <Suspense fallback={<Loading />}><Routes><Route path="/site/*" element={<SiteApp />} /></Routes></Suspense>;
  if (loc.pathname.startsWith('/verify-email/')) return <Routes><Route path="/verify-email/:token" element={<VerifyEmail />} /></Routes>;
  if (loc.pathname === '/platform' || loc.pathname.startsWith('/platform/')) return <Suspense fallback={<Loading />}><Routes><Route path="/platform/*" element={<PlatformConsole />} /></Routes></Suspense>;
  if (user === undefined) return <Loading />;

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<MainGate fallback={<Navigate to="/site" replace />} />} />
        {['/real-estate', '/construction', '/preview', '/pricing', '/contact', '/delete-account', '/download-app', '/legal/:slug'].map((p) => <Route key={p} path={p} element={<MainGate fallback={<Navigate to="/login" replace />} />} />)}
        <Route path="/portal/login" element={<Login portal />} />
        <Route path="/vendor/login" element={<Login portal vendor />} />
        <Route path="/login" element={<MainGate fallback={<Login />} />} />
        <Route path="/signup" element={<MainGate fallback={<Signup />} />} />
        <Route path="/forgot-password" element={<MainGate fallback={<ForgotPassword />} />} />
        <Route path="/reset-password/:token" element={<MainGate fallback={<ResetPassword />} />} />
        <Route path="/invite/:token" element={<MainGate fallback={<AcceptInvite />} />} />
        <Route path="/:slug" element={<StaffGate />} />
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
        <Route index element={<Home />} />
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
        <Route path="training" element={<TrainingLibrary />} />
        <Route path="settings/integrations" element={G('crm', <Integrations />)} />
        <Route path="settings/payment-gateways" element={G('settings', <PaymentGateways />)} />
        <Route path="settings/email" element={G('settings', <EmailSettings />)} />
        <Route path="settings/whatsapp" element={G('settings', <WhatsAppSettings />)} />
        <Route path="whatsapp" element={G('crm', <WhatsApp />)} />
        <Route path="settings/lead-routing" element={G('crm', <LeadRouting />)} />
        <Route path="sequences" element={G('crm', <Sequences />)} />
        <Route path="leads/conversion" element={G('crm', <Conversion />)} />
        <Route path="settings/website-integrations" element={G('website', <WebsiteIntegrations />)} />
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
        <Route path="hrm/onboarding" element={G('hrm', <OnboardingHome />)} />
        <Route path="hrm/onboarding/:id" element={<OnboardingDetail />} />
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
        <Route path="whats-new" element={<WhatsNew />} />
        <Route path="my/attendance" element={<MyAttendance />} />
        <Route path="my/leave" element={<MyLeave />} />
        <Route path="my/payroll" element={<MyPayroll />} />
        <Route path="my/tasks" element={<MyTasks />} />
        <Route path="my/location" element={<MyLocation />} />
        <Route path="field" element={<FieldCoverage />} />
        <Route path="my/onboarding" element={<MyOnboarding />} />
        <Route path="content" element={G('content', <Content />)} />
        <Route path="customers/promos" element={G('customers', <Promos />, 'edit')} />
        <Route path="website" element={G('website', <WebsiteHome />)} />
        <Route path="website/classic" element={<Navigate to="/website" replace />} />
        <Route path="website/visual" element={<Navigate to="/website" replace />} />
        <Route path="website/seo" element={G('seo', <SeoManager />)} />
        <Route path="website/assistant" element={G('website', <BotKnowledge />)} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="*" element={<div className="empty" style={{ paddingTop: 80 }}><h2>Page not found</h2></div>} />
      </Route>
    </Routes>
  );
}
