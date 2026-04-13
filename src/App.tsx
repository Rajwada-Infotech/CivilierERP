import React, { Suspense, lazy, useState, useEffect, Component } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { AppLayout } from "@/components/layout/AppLayout";

// Contexts
import { AuthProvider } from "@/contexts/AuthContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TaskProvider } from "@/contexts/TaskContext";
import { FinYearProvider } from "@/contexts/FinYearContext";
import { HsnProvider } from "@/contexts/HsnContext";
import { RecordsProvider } from "@/contexts/RecordsContext";
import { TdsProvider } from "@/contexts/TdsContext";
import { DebitNoteProvider } from "@/contexts/DebitNoteContext";
import { BillingTermsProvider } from "@/contexts/BillingTermsContext";
import {
  ActivityBrowserProvider,
  useActivityBrowser,
} from "@/contexts/ActivityBrowserContext";
import { useAuth } from "@/contexts/AuthContext";

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

// ─── Query Client ─────────────────────────────────────────────────────────────
import { queryClient } from "@/lib/queryClient";

// ─── Auth Guard ───────────────────────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const location = useLocation();
  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}




// ─── Admin Protected Route ────────────────────────────────────────────────────
const ADMIN_ROLES = ["super_admin", "admin", "dba"] as const;

function AdminRoute() {
  return (
    <RequireAuth>
      <AppLayout />
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
// Sits inside ActivityBrowserProvider so it can read recordLogin/recordLogout
// and pass them down as props to AuthProvider — breaking the circular dependency
// that previously caused AuthContext to import useActivityBrowser directly.
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
        <Route index element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/widgets" element={<Widgets />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/payments" element={<Payment />} />
        <Route path="/received-payments" element={<ReceivedPayment />} />
        <Route path="/brs" element={<Brs />} />
        <Route path="/records" element={<Records />} />

        <Route path="/masters/contractors" element={<ContractorMaster />} />
        <Route path="/masters/suppliers" element={<SupplierMaster />} />
        <Route path="/masters/customers" element={<CustomerMaster />} />
        <Route path="/masters/banks" element={<BankMaster />} />
        <Route path="/masters/expenses" element={<ExpensesMaster />} />
        <Route path="/masters/items" element={<ItemMaster />} />
        <Route path="/masters/item-groups" element={<ItemGroupMaster />} />
        <Route path="/masters/hsn" element={<HsnMaster />} />
        <Route path="/masters/financial-year" element={<FinancialYearMaster />} />
        <Route path="/masters/cheque" element={<ChequeMaster />} />
        <Route path="/material/expense-booking" element={<MaterialExpenseBookingMaster />} />
        <Route path="/material/work-order" element={<WorkOrderMaster />} />
        <Route path="/material/amendments" element={<Dashboard />} />
        <Route path="/material/purchase-order" element={<PurchaseOrderMaster />} />
        <Route path="/masters/card" element={<CardMaster />} />
        <Route path="/masters/tds" element={<TdsMaster />} />
        <Route path="/masters/account-group" element={<AccountGroupMaster />} />
        <Route path="/masters/named-entry-type" element={<NamedEntryTypeMaster />} />
        <Route path="/masters/type-of-doc" element={<TypeOfDocMaster />} />
        <Route path="/masters/activity" element={<ActivityMaster />} />
        <Route path="/masters/general-ledger" element={<GeneralLedgerMaster />} />
        <Route path="/masters/debit-note" element={<DebitNoteMaster />} />
        <Route path="/masters/billing-terms" element={<BillingTermsMaster />} />
        <Route path="/material/t-c-master" element={<TCMaster />} />
        <Route path="/material/grn" element={<GRN />} />
        <Route path="/masters/unit-measurement" element={<UnitOfMeasurementMaster />} />
      </Route>

      <Route element={<AdminRoute />}>
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/users" element={<Users />} />
        <Route path="/admin/rights/menu" element={<MenuRights />} />
        <Route path="/admin/rights/widgets" element={<WidgetRights />} />
        <Route path="/admin/rights/fin-year" element={<FinYearRights />} />
        <Route path="/admin/approval/setup" element={<ApprovalSetup />} />
        <Route path="/admin/approval/post-rights" element={<PostApprovalRights />} />
        <Route path="/admin/api-integration" element={<ApiIntegrationPage />} />
        <Route path="/admin/signature" element={<SignaturePage />} />
        <Route path="/admin/profile" element={<SuperAdminProfile />} />
        <Route path="/admin/masters/business-unit" element={<BusinessUnitMaster />} />
        <Route path="/admin/masters/project" element={<ProjectMaster />} />
        <Route path="/admin/masters/company" element={<CompanyMaster />} />
        <Route path="/admin/security/password-reset" element={<PasswordResetPage />} />
        <Route path="/admin/activity-browser" element={<ActivityBrowserPage />} />
        <Route path="/admin/communicator/sms-setup" element={<SmsSetup />} />
        <Route path="/admin/communicator/email-setup" element={<EmailSetup />} />
        <Route path="/admin/communicator/whatsapp-setup" element={<WhatsAppSetup />} />
        <Route path="/admin/metrics" element={<MetricsDashboard />} />
        <Route path="/superadmin" element={<SuperAdminDashboard />} />
        <Route path="/admin/control-panel" element={<AdminControlPanel />} />
      </Route>
      <Route path="/admin" element={<Navigate to="/" replace />} />

      {/* USER PROFILE & DBA already nested above */ }


      {/* Maintenance */}
      <Route path="/maintenance" element={<Maintenance />} />

      {/* 404 */}
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
          <ModuleProvider>
            <ThemeProvider>
              <FinYearProvider>
                <HsnProvider>
                  <RecordsProvider>
                    <TdsProvider>
                      <DebitNoteProvider>
                        <BillingTermsProvider>
                          <TaskProvider>
<Suspense fallback={<Loader />}>
                              <Router
                                future={{
                                  v7_startTransition: true,
                                  v7_relativeSplatPath: true,
                                }}
                              >
                                <AppRoutes />
                              </Router>
                            </Suspense>
                          </TaskProvider>
                        </BillingTermsProvider>
                      </DebitNoteProvider>
                    </TdsProvider>
                  </RecordsProvider>
                </HsnProvider>
              </FinYearProvider>
            </ThemeProvider>
          </ModuleProvider>
        </AuthSessionBridge>
      </ActivityBrowserProvider>
    </QueryClientProvider>
  );
}

export default App;
