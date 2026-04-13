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
      <div className="h-4 w-48 rounded-md bg-muted" />
      <div className="h-6 w-64 rounded-md bg-muted" />
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
  () => import("./pages/masters/BillingTermsmaster"),
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

function AdminRoute() {
  return (
    <RequireAuth>
      <RequireRole allowed={[...ADMIN_ROLES]}>
        <AppLayout />
      </RequireRole>
    </RequireAuth>
  );
}

// ─── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute() {
  return (
    <RequireAuth>
      <AppLayout />
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

      <Route element={<ProtectedRoute />}>
        <Route
          index
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Dashboard />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/transactions"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Transactions />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/reports"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Reports />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/widgets"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Widgets />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/tasks"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Tasks />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/tasks/:id"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <TaskDetail />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/payments"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Payment />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/received-payments"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ReceivedPayment />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/brs"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Brs />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/records"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Records />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/followup"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <FollowupDashboard />
              </Suspense>
            </ErrorBoundary>
          }
        />

        <Route
          path="/masters/contractors"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ContractorMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/suppliers"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <SupplierMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/customers"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <CustomerMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/banks"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <BankMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/expenses"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ExpensesMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/items"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ItemMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/item-groups"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ItemGroupMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/hsn"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <HsnMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/financial-year"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <FinancialYearMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/cheque"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ChequeMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/material/expense-booking"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <MaterialExpenseBookingMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/material/work-order"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <WorkOrderMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/material/amendments"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Dashboard />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/material/purchase-order"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <PurchaseOrderMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/card"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <CardMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/tds"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <TdsMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/account-group"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <AccountGroupMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/named-entry-type"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <NamedEntryTypeMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/type-of-doc"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <TypeOfDocMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/activity"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ActivityMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/general-ledger"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <GeneralLedgerMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/debit-note"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <DebitNoteMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/billing-terms"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <BillingTermsMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/material/t-c-master"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <TCMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/material/grn"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <GRN />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/masters/unit-measurement"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <UnitOfMeasurementMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/user/profile"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <UserProfilePage />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/dba"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <DBADashboard />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/dba/control-panel"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ControlPanel />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/dba/ads"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <AdsManager />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/dba/reminders"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <RemindersManager />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/dba/payment-logs"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <PaymentLogs />
              </Suspense>
            </ErrorBoundary>
          }
        />
      </Route>

      <Route path="/admin" element={<Navigate to="/" replace />} />
      <Route element={<AdminRoute />}>
        <Route
          path="/admin/dashboard"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <AdminDashboard />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/users"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Users />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/rights/menu"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <MenuRights />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/rights/widgets"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <WidgetRights />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/rights/fin-year"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <FinYearRights />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/approval/setup"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ApprovalSetup />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/approval/post-rights"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <PostApprovalRights />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/api-integration"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ApiIntegrationPage />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/signature"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <SignaturePage />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/profile"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <SuperAdminProfile />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/masters/business-unit"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <BusinessUnitMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/masters/project"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ProjectMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/masters/company"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <CompanyMaster />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/security/password-reset"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <PasswordResetPage />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/activity-browser"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <ActivityBrowserPage />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/communicator/sms-setup"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <SmsSetup />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/communicator/email-setup"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <EmailSetup />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/communicator/whatsapp-setup"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <WhatsAppSetup />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/metrics"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <MetricsDashboard />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/superadmin"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <SuperAdminDashboard />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin/control-panel"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <AdminControlPanel />
              </Suspense>
            </ErrorBoundary>
          }
        />
      </Route>

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
