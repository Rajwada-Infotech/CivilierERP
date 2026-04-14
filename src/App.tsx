import React, { Suspense, lazy, useState, useEffect, Component } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import Loader from "./components/Loader";
import { Toaster } from "sonner";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

// Static imports
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Maintenance from "./pages/Maintenance";

// Layout
import { AppLayout } from "./components/layout/AppLayout";

// Contexts
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ModuleProvider } from "./contexts/ModuleContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { TaskProvider } from "./contexts/TaskContext";
import { FinYearProvider } from "./contexts/FinYearContext";
import { HsnProvider } from "./contexts/HsnContext";
import { RecordsProvider } from "./contexts/RecordsContext";
import { TdsProvider } from "./contexts/TdsContext";
import { DebitNoteProvider } from "./contexts/DebitNoteContext";
import { BillingTermsProvider } from "./contexts/BillingTermsContext";
import {
  ActivityBrowserProvider,
  useActivityBrowser,
} from "./contexts/ActivityBrowserContext";

// Query Client
import { queryClient } from "./lib/queryClient";

// ─── Page Skeleton (inline route-transition loader) ───────────────────────────
function PageSkeleton() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      {/* Breadcrumb line */}
      <div className="h-4 w-48 rounded-md bg-muted" />
      {/* Page title */}
      <div className="h-6 w-64 rounded-md bg-muted" />
      {/* Card block */}
      <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-9 w-full rounded-lg bg-muted" />
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2 border-t border-border">
          <div className="h-9 w-20 rounded-lg bg-muted" />
          <div className="h-9 w-20 rounded-lg bg-muted" />
        </div>
      </div>
      {/* Table block */}
      <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className="h-4 w-1/4 rounded bg-muted" />
              <div className="h-4 w-1/5 rounded bg-muted" />
              <div className="h-4 w-1/6 rounded bg-muted" />
              <div className="h-4 w-1/6 rounded bg-muted ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Lazy Pages ───────────────────────────────────────────────────────────────
// Main Pages
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Reports = lazy(() => import("./pages/Reports"));
const Widgets = lazy(() => import("./pages/Widgets"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Payment = lazy(() => import("./pages/Payment"));
const Brs = lazy(() => import("./pages/Brs"));
const Records = lazy(() => import("./pages/Records"));
const ReceivedPayment = lazy(() => import("./pages/ReceivedPayment"));

// Task Detail
const TaskDetail = lazy(() => import("./pages/tasks/TaskDetail"));

// Masters
const ContractorMaster = lazy(() => import("./pages/masters/ContractorMaster"));
const SupplierMaster = lazy(() => import("./pages/masters/SupplierMaster"));
const CustomerMaster = lazy(() => import("./pages/masters/CustomerMaster"));
const BankMaster = lazy(() => import("./pages/masters/BankMaster"));
const ExpensesMaster = lazy(() => import("./pages/masters/ExpensesMaster"));
const ItemMaster = lazy(() => import("./pages/masters/ItemMaster"));
const ItemGroupMaster = lazy(() => import("./pages/masters/ItemGroupMaster"));
const HsnMaster = lazy(() => import("./pages/masters/HsnMaster"));
const FinancialYearMaster = lazy(
  () => import("./pages/masters/FinancialYearMaster"),
);
const ChequeMaster = lazy(() => import("./pages/masters/ChequeMaster"));
const GRN = lazy(() => import("./pages/material/GRN"));
const MaterialDashboard = lazy(
  () => import("./pages/material/MaterialDashboard"),
);
const MaterialExpenseBookingMaster = lazy(
  () => import("./pages/material/MaterialExpenseBooking"),
);
const WorkOrderMaster = lazy(() => import("./pages/material/WorkOrderMaster"));
const PurchaseOrderMaster = lazy(
  () => import("./pages/material/PurchaseOrderMaster"),
);
const CardMaster = lazy(() => import("./pages/masters/CardMaster"));
const TdsMaster = lazy(() => import("./pages/masters/TdsMaster"));
const AccountGroupMaster = lazy(
  () => import("./pages/masters/AccountGroupMaster"),
);
const NamedEntryTypeMaster = lazy(
  () => import("./pages/masters/NamedEntryTypeMaster"),
);
const TypeOfDocMaster = lazy(() => import("./pages/masters/TypeOfDocMaster"));
const ActivityMaster = lazy(() => import("./pages/masters/ActivityMaster"));
const DebitNoteMaster = lazy(() => import("./pages/masters/DebitNoteMaster"));
const BillingTermsMaster = lazy(
  () => import("./pages/masters/BillingTermsMaster"),
);
const TCMaster = lazy(() => import("./pages/material/T&CMaster"));
const UnitOfMeasurementMaster = lazy(
  () => import("./pages/material/UnitOfMeasurementMaster"),
);

// Admin Pages
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const Users = lazy(() => import("./pages/Users"));
const MenuRights = lazy(() => import("./pages/admin/MenuRights"));
const WidgetRights = lazy(() => import("./pages/admin/WidgetsRights"));
const FinYearRights = lazy(() => import("./pages/admin/FinYearRights"));
const ApprovalSetup = lazy(() => import("./pages/admin/ApprovalSetup"));
const PostApprovalRights = lazy(
  () => import("./pages/admin/PostApprovalRights"),
);
const ApiIntegrationPage = lazy(() => import("./pages/admin/ApiIntegration"));
const SignaturePage = lazy(() => import("./pages/admin/Signature"));
const SuperAdminProfile = lazy(() => import("./pages/admin/SuperAdminProfile"));
const MetricsDashboard = lazy(() => import("./pages/admin/MetricsDashboard"));
const PasswordResetPage = lazy(
  () => import("./pages/admin/security/PasswordReset"),
);
const ActivityBrowserPage = lazy(
  () => import("./pages/admin/Activitybrowser/ActivityBrowser"),
);

// Admin Masters
const BusinessUnitMaster = lazy(
  () => import("./pages/admin/masters/BusinessUnitMaster"),
);
const ProjectMaster = lazy(() => import("./pages/admin/masters/ProjectMaster"));
const CompanyMaster = lazy(() => import("./pages/admin/masters/CompanyMaster"));

// Communicator Setup
const SmsSetup = lazy(() => import("./pages/admin/Communicator/SmsSetup"));
const EmailSetup = lazy(() => import("./pages/admin/Communicator/EmailSetup"));
const WhatsAppSetup = lazy(
  () => import("./pages/admin/Communicator/WhatsAppSetup"),
);
const GeneralLedgerMaster = lazy(
  () => import("./pages/masters/GeneralLedgerMaster"),
);

// New hierarchy pages
const SuperAdminDashboard = lazy(
  () => import("./pages/superadmin/SuperAdminDashboard"),
);
const AdminControlPanel = lazy(() => import("./pages/admin/AdminControlPanel"));
const UserProfilePage = lazy(() => import("./pages/user/UserProfile"));
const DBADashboard = lazy(() => import("./pages/dba/DBADashboard"));
const ControlPanel = lazy(() => import("./pages/dba/ControlPanel"));
const AdsManager = lazy(() => import("./pages/dba/AdsManager"));
const FollowupDashboard = lazy(() => import("./pages/followup"));
const RemindersManager = lazy(() => import("./pages/dba/RemindersManager"));
const PaymentLogs = lazy(() => import("./pages/dba/PaymentLogs"));

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8">
          <p className="text-destructive font-semibold text-lg">
            Something went wrong
          </p>
          <p className="text-muted-foreground text-sm">{this.state.message}</p>
          <button
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Auth Guard ───────────────────────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const location = useLocation();
  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// ─── Role Guard ───────────────────────────────────────────────────────────────
function RequireRole({
  children,
  allowed,
}: {
  children: React.ReactNode;
  allowed: string[];
}) {
  const { currentUser } = useAuth();
  if (!currentUser || !allowed.includes(currentUser.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// ─── Admin Protected Route ────────────────────────────────────────────────────
const ADMIN_ROLES = ["super_admin", "admin", "dba"] as const;

function AdminRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RequireRole allowed={[...ADMIN_ROLES]}>
        <AppLayout>
          <ErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
          </ErrorBoundary>
        </AppLayout>
      </RequireRole>
    </RequireAuth>
  );
}

// ─── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppLayout>
        <ErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </ErrorBoundary>
      </AppLayout>
    </RequireAuth>
  );
}

// ─── Auth Session Bridge ──────────────────────────────────────────────────────
function AuthSessionBridge({ children }: { children: React.ReactNode }) {
  const { recordLogin, recordLogout } = useActivityBrowser();
  return (
    <AuthProvider recordLogin={recordLogin} recordLogout={recordLogout}>
      {children}
    </AuthProvider>
  );
}

// ─── App Routes ───────────────────────────────────────────────────────────────
function AppRoutes() {
  const { currentUser } = useAuth();
  return (
    <Routes>
      {/* AUTH */}
      <Route
        path="/login"
        element={currentUser ? <Navigate to="/" replace /> : <Login />}
      />

      {/* MAIN */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/transactions"
        element={
          <ProtectedRoute>
            <Transactions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <Reports />
          </ProtectedRoute>
        }
      />
      <Route
        path="/widgets"
        element={
          <ProtectedRoute>
            <Widgets />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks"
        element={
          <ProtectedRoute>
            <Tasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks/:id"
        element={
          <ProtectedRoute>
            <TaskDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payments"
        element={
          <ProtectedRoute>
            <Payment />
          </ProtectedRoute>
        }
      />
      <Route
        path="/received-payments"
        element={
          <ProtectedRoute>
            <ReceivedPayment />
          </ProtectedRoute>
        }
      />
      <Route
        path="/brs"
        element={
          <ProtectedRoute>
            <Brs />
          </ProtectedRoute>
        }
      />
      <Route
        path="/records"
        element={
          <ProtectedRoute>
            <Records />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup"
        element={
          <ProtectedRoute>
            <FollowupDashboard />
          </ProtectedRoute>
        }
      />

      {/* MASTERS */}
      <Route
        path="/masters/contractors"
        element={
          <ProtectedRoute>
            <ContractorMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/suppliers"
        element={
          <ProtectedRoute>
            <SupplierMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/customers"
        element={
          <ProtectedRoute>
            <CustomerMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/banks"
        element={
          <ProtectedRoute>
            <BankMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/expenses"
        element={
          <ProtectedRoute>
            <ExpensesMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/items"
        element={
          <ProtectedRoute>
            <ItemMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/item-groups"
        element={
          <ProtectedRoute>
            <ItemGroupMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/hsn"
        element={
          <ProtectedRoute>
            <HsnMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/financial-year"
        element={
          <ProtectedRoute>
            <FinancialYearMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/cheque"
        element={
          <ProtectedRoute>
            <ChequeMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material"
        element={
          <ProtectedRoute>
            <MaterialDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/grn"
        element={
          <ProtectedRoute>
            <GRN />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/expense-booking"
        element={
          <ProtectedRoute>
            <MaterialExpenseBookingMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/work-order"
        element={
          <ProtectedRoute>
            <WorkOrderMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/amendments"
        element={
          <ProtectedRoute>
            <MaterialDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/purchase-order"
        element={
          <ProtectedRoute>
            <PurchaseOrderMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/t-c-master"
        element={
          <ProtectedRoute>
            <TCMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/card"
        element={
          <ProtectedRoute>
            <CardMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/tds"
        element={
          <ProtectedRoute>
            <TdsMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/account-group"
        element={
          <ProtectedRoute>
            <AccountGroupMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/named-entry-type"
        element={
          <ProtectedRoute>
            <NamedEntryTypeMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/type-of-doc"
        element={
          <ProtectedRoute>
            <TypeOfDocMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/activity"
        element={
          <ProtectedRoute>
            <ActivityMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/general-ledger"
        element={
          <ProtectedRoute>
            <GeneralLedgerMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/debit-note"
        element={
          <ProtectedRoute>
            <DebitNoteMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/billing-terms"
        element={
          <ProtectedRoute>
            <BillingTermsMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/unit-measurement"
        element={
          <ProtectedRoute>
            <UnitOfMeasurementMaster />
          </ProtectedRoute>
        }
      />

      {/* USER */}
      <Route
        path="/user/profile"
        element={
          <ProtectedRoute>
            <UserProfilePage />
          </ProtectedRoute>
        }
      />

      {/* DBA CONSOLE */}
      <Route
        path="/dba"
        element={
          <ProtectedRoute>
            <DBADashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dba/control-panel"
        element={
          <ProtectedRoute>
            <ControlPanel />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dba/ads"
        element={
          <ProtectedRoute>
            <AdsManager />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dba/reminders"
        element={
          <ProtectedRoute>
            <RemindersManager />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dba/payment-logs"
        element={
          <ProtectedRoute>
            <PaymentLogs />
          </ProtectedRoute>
        }
      />

      {/* ADMIN — bare /admin redirects to home */}
      <Route path="/admin" element={<Navigate to="/" replace />} />
      <Route
        path="/admin/dashboard"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/users"
        element={
          <AdminRoute>
            <Users />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/rights/menu"
        element={
          <AdminRoute>
            <MenuRights />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/rights/widgets"
        element={
          <AdminRoute>
            <WidgetRights />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/rights/fin-year"
        element={
          <AdminRoute>
            <FinYearRights />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/approval/setup"
        element={
          <AdminRoute>
            <ApprovalSetup />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/approval/post-rights"
        element={
          <AdminRoute>
            <PostApprovalRights />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/api-integration"
        element={
          <AdminRoute>
            <ApiIntegrationPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/signature"
        element={
          <AdminRoute>
            <SignaturePage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/profile"
        element={
          <AdminRoute>
            <SuperAdminProfile />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/masters/business-unit"
        element={
          <AdminRoute>
            <BusinessUnitMaster />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/masters/project"
        element={
          <AdminRoute>
            <ProjectMaster />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/masters/company"
        element={
          <AdminRoute>
            <CompanyMaster />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/security/password-reset"
        element={
          <AdminRoute>
            <PasswordResetPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/activity-browser"
        element={
          <AdminRoute>
            <ActivityBrowserPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/communicator/sms-setup"
        element={
          <AdminRoute>
            <SmsSetup />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/communicator/email-setup"
        element={
          <AdminRoute>
            <EmailSetup />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/communicator/whatsapp-setup"
        element={
          <AdminRoute>
            <WhatsAppSetup />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/metrics"
        element={
          <AdminRoute>
            <MetricsDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/control-panel"
        element={
          <AdminRoute>
            <AdminControlPanel />
          </AdminRoute>
        }
      />

      {/* SUPER ADMIN */}
      <Route
        path="/superadmin"
        element={
          <AdminRoute>
            <SuperAdminDashboard />
          </AdminRoute>
        }
      />

      {/* MAINTENANCE & 404 */}
      <Route path="/maintenance" element={<Maintenance />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
function App() {
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setInitialLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  if (initialLoading) return <Loader />;

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster richColors position="top-right" />
      <ActivityBrowserProvider>
        <AuthSessionBridge>
          <Router
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <ModuleProvider>
              <ThemeProvider>
                <FinYearProvider>
                  <HsnProvider>
                    <RecordsProvider>
                      <TdsProvider>
                        <DebitNoteProvider>
                          <BillingTermsProvider>
                            <TaskProvider>
                              <AppRoutes />
                            </TaskProvider>
                          </BillingTermsProvider>
                        </DebitNoteProvider>
                      </TdsProvider>
                    </RecordsProvider>
                  </HsnProvider>
                </FinYearProvider>
              </ThemeProvider>
            </ModuleProvider>
          </Router>
        </AuthSessionBridge>
      </ActivityBrowserProvider>
    </QueryClientProvider>
  );
}

export default App;
