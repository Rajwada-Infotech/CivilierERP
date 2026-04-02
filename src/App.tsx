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

// ─── Delay Helper ─────────────────────────────────────────────────────────────
const withDelay = <T,>(importFn: () => Promise<T>, delay = 600): Promise<T> =>
  Promise.all([importFn(), new Promise((res) => setTimeout(res, delay))]).then(
    ([module]) => module,
  );

// ─── Lazy Pages ───────────────────────────────────────────────────────────────

// Main Pages
const Dashboard = lazy(() => withDelay(() => import("./pages/Dashboard")));
const Reports = lazy(() => withDelay(() => import("./pages/Reports")));
const Widgets = lazy(() => withDelay(() => import("./pages/Widgets")));
const Tasks = lazy(() => withDelay(() => import("./pages/Tasks")));
const Transactions = lazy(() =>
  withDelay(() => import("./pages/Transactions")),
);
const Payment = lazy(() => withDelay(() => import("./pages/Payment")));
const Brs = lazy(() => withDelay(() => import("./pages/Brs")));
const ExpenseBooking = lazy(() =>
  withDelay(() => import("./pages/ExpenseBooking")),
);
const Records = lazy(() => withDelay(() => import("./pages/Records")));
const ReceivedPayment = lazy(() =>
  withDelay(() => import("./pages/ReceivedPayment")),
);

// Task Detail
const TaskDetail = lazy(() =>
  withDelay(() => import("./pages/tasks/TaskDetail")),
);

// Masters
const ContractorMaster = lazy(() =>
  withDelay(() => import("./pages/masters/ContractorMaster")),
);
const SupplierMaster = lazy(() =>
  withDelay(() => import("./pages/masters/SupplierMaster")),
);
const CustomerMaster = lazy(() =>
  withDelay(() => import("./pages/masters/CustomerMaster")),
);
const BankMaster = lazy(() =>
  withDelay(() => import("./pages/masters/BankMaster")),
);
const ExpensesMaster = lazy(() =>
  withDelay(() => import("./pages/masters/ExpensesMaster")),
);
const ItemMaster = lazy(() =>
  withDelay(() => import("./pages/masters/ItemMaster")),
);
const ItemGroupMaster = lazy(() =>
  withDelay(() => import("./pages/masters/ItemGroupMaster")),
);
const HsnMaster = lazy(() =>
  withDelay(() => import("./pages/masters/HsnMaster")),
);
const FinancialYearMaster = lazy(() =>
  withDelay(() => import("./pages/masters/FinancialYearMaster")),
);
const ChequeMaster = lazy(() =>
  withDelay(() => import("./pages/masters/ChequeMaster")),
);
const MaterialExpenseBookingMaster = lazy(() =>
  withDelay(() => import("./pages/material/MaterialExpenseBooking")),
);
const WorkOrderMaster = lazy(() =>
  withDelay(() => import("./pages/material/WorkOrderMaster")),
);
const PurchaseOrderMaster = lazy(() =>
  withDelay(() => import("./pages/material/PurchaseOrderMaster")),
);
const CardMaster = lazy(() =>
  withDelay(() => import("./pages/masters/CardMaster")),
);
const TdsMaster = lazy(() =>
  withDelay(() => import("./pages/masters/TdsMaster")),
);
const AccountGroupMaster = lazy(() =>
  withDelay(() => import("./pages/masters/AccountGroupMaster")),
);
const NamedEntryTypeMaster = lazy(() =>
  withDelay(() => import("./pages/masters/NamedEntryTypeMaster")),
);
const TypeOfDocMaster = lazy(() =>
  withDelay(() => import("./pages/masters/TypeOfDocMaster")),
);
const ActivityMaster = lazy(() =>
  withDelay(() => import("./pages/masters/ActivityMaster")),
);
const DebitNoteMaster = lazy(() =>
  withDelay(() => import("./pages/masters/DebitNoteMaster")),
);
const BillingTermsMaster = lazy(() =>
  withDelay(() => import("./pages/masters/BillingTermsmaster")),
);

const UnitOfMeasurementMaster = lazy(() =>
  withDelay(() => import("./pages/material/UnitOfMeasurementMaster")),
);

// Admin Pages
const AdminDashboard = lazy(() =>
  withDelay(() => import("./pages/admin/AdminDashboard")),
);
// FIX: AdminExpenseBooking points to the existing ExpenseBooking page (no admin/ExpenseBooking file exists)
const AdminExpenseBooking = lazy(() =>
  withDelay(() => import("./pages/ExpenseBooking")),
);
const Users = lazy(() => withDelay(() => import("./pages/Users")));
const MenuRights = lazy(() =>
  withDelay(() => import("./pages/admin/MenuRights")),
);
const WidgetRights = lazy(() =>
  withDelay(() => import("./pages/admin/WidgetsRights")),
);
const FinYearRights = lazy(() =>
  withDelay(() => import("./pages/admin/FinYearRights")),
);
const ApprovalSetup = lazy(() =>
  withDelay(() => import("./pages/admin/ApprovalSetup")),
);
const PostApprovalRights = lazy(() =>
  withDelay(() => import("./pages/admin/PostApprovalRights")),
);
const ApiIntegrationPage = lazy(() =>
  withDelay(() => import("./pages/admin/ApiIntegration")),
);
const SignaturePage = lazy(() =>
  withDelay(() => import("./pages/admin/Signature")),
);
const SuperAdminProfile = lazy(() =>
  withDelay(() => import("./pages/admin/SuperAdminProfile")),
);
const PasswordResetPage = lazy(() =>
  withDelay(() => import("./pages/admin/security/PasswordReset")),
);
const ActivityBrowserPage = lazy(() =>
  withDelay(() => import("./pages/admin/ActivityBrowser")),
);

// Admin Masters
const BusinessUnitMaster = lazy(() =>
  withDelay(() => import("./pages/admin/masters/BusinessUnitMaster")),
);
const ProjectMaster = lazy(() =>
  withDelay(() => import("./pages/admin/masters/ProjectMaster")),
);
const CompanyMaster = lazy(() =>
  withDelay(() => import("./pages/admin/masters/CompanyMaster")),
);

// Communicator Setup
const SmsSetup = lazy(() =>
  withDelay(() => import("./pages/admin/Communicator/SmsSetup")),
);
const EmailSetup = lazy(() =>
  withDelay(() => import("./pages/admin/Communicator/EmailSetup")),
);
const WhatsAppSetup = lazy(() =>
  withDelay(() => import("./pages/admin/Communicator/WhatsAppSetup")),
);
const GeneralLedgerMaster = lazy(() =>
  withDelay(() => import("./pages/masters/GeneralLedgerMaster")),
);
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
          <p className="text-destructive font-semibold text-lg">Something went wrong</p>
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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ─── Auth Guard ───────────────────────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// ─── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppLayout>
        <ErrorBoundary>
          <Suspense fallback={<Loader />}>{children}</Suspense>
        </ErrorBoundary>
      </AppLayout>
    </RequireAuth>
  );
}

// ─── Auth Session Bridge ──────────────────────────────────────────────────────
function AuthSessionBridge({ children }: { children: React.ReactNode }) {
  const { recordLogin, recordLogout } = useActivityBrowser();
  return (
    <AuthProvider onLoginSuccess={recordLogin} onLogoutSuccess={recordLogout}>
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
        path="/transactions/expense-booking"
        element={
          <ProtectedRoute>
            <ExpenseBooking />
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
            <Dashboard />
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

      {/* ADMIN */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/expense-booking"
        element={
          <ProtectedRoute>
            <AdminExpenseBooking />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <Users />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/rights/menu"
        element={
          <ProtectedRoute>
            <MenuRights />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/rights/widgets"
        element={
          <ProtectedRoute>
            <WidgetRights />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/rights/fin-year"
        element={
          <ProtectedRoute>
            <FinYearRights />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/approval/setup"
        element={
          <ProtectedRoute>
            <ApprovalSetup />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/approval/post-rights"
        element={
          <ProtectedRoute>
            <PostApprovalRights />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/api-integration"
        element={
          <ProtectedRoute>
            <ApiIntegrationPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/signature"
        element={
          <ProtectedRoute>
            <SignaturePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/profile"
        element={
          <ProtectedRoute>
            <SuperAdminProfile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/masters/business-unit"
        element={
          <ProtectedRoute>
            <BusinessUnitMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/masters/project"
        element={
          <ProtectedRoute>
            <ProjectMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/masters/company"
        element={
          <ProtectedRoute>
            <CompanyMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/security/password-reset"
        element={
          <ProtectedRoute>
            <PasswordResetPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/activity-browser"
        element={
          <ProtectedRoute>
            <ActivityBrowserPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/communicator/sms-setup"
        element={
          <ProtectedRoute>
            <SmsSetup />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/communicator/email-setup"
        element={
          <ProtectedRoute>
            <EmailSetup />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/communicator/whatsapp-setup"
        element={
          <ProtectedRoute>
            <WhatsAppSetup />
          </ProtectedRoute>
        }
      />

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
                            <Router>
                              <AppRoutes />
                            </Router>
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
