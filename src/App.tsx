import React, { Suspense, lazy, useState, useEffect } from "react";
import Loader from "./components/Loader";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Static imports
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

// Layout
import { AppLayout } from "@/components/layout/AppLayout";

// Delay helper
const withDelay = <T,>(importFn: () => Promise<T>, delay = 600): Promise<T> =>
  Promise.all([importFn(), new Promise((res) => setTimeout(res, delay))]).then(
    ([module]) => module,
  );

// Lazy pages
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

// Admin
const AdminDashboard = lazy(() =>
  withDelay(() => import("./pages/admin/AdminDashboard")),
);
const AdminExpenseBooking = lazy(() =>
  withDelay(() => import("./pages/admin/ExpenseBooking")),
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

// ✅ Merged from Abc branch
const ApiIntegrationPage = lazy(() =>
  withDelay(() => import("./pages/admin/ApiIntegration")),
);
const SignaturePage = lazy(() =>
  withDelay(() => import("./pages/admin/Signature")),
);

// Contexts
import { AuthProvider } from "@/contexts/AuthContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TaskProvider } from "@/contexts/TaskContext";
import { FinYearProvider } from "@/contexts/FinYearContext";
import { HsnProvider } from "@/contexts/HsnContext";
import { RecordsProvider } from "@/contexts/RecordsContext";

/* ========================= AUTH GUARD ========================= */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

/* ========================= PROTECTED ROUTE ========================= */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppLayout>
        <Suspense fallback={<Loader />}>{children}</Suspense>
      </AppLayout>
    </RequireAuth>
  );
}

/* ========================= ROUTES ========================= */
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
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
      <Route path="/transactions/expense-booking" element={<ProtectedRoute><ExpenseBooking /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/widgets" element={<ProtectedRoute><Widgets /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
      <Route path="/payments" element={<ProtectedRoute><Payment /></ProtectedRoute>} />
      <Route path="/received-payments" element={<ProtectedRoute><ReceivedPayment /></ProtectedRoute>} />
      <Route path="/brs" element={<ProtectedRoute><Brs /></ProtectedRoute>} />
      <Route path="/records" element={<ProtectedRoute><Records /></ProtectedRoute>} />

      {/* MASTERS */}
      <Route path="/masters/contractors" element={<ProtectedRoute><ContractorMaster /></ProtectedRoute>} />
      <Route path="/masters/suppliers" element={<ProtectedRoute><SupplierMaster /></ProtectedRoute>} />
      <Route path="/masters/customers" element={<ProtectedRoute><CustomerMaster /></ProtectedRoute>} />
      <Route path="/masters/banks" element={<ProtectedRoute><BankMaster /></ProtectedRoute>} />
      <Route path="/masters/expenses" element={<ProtectedRoute><ExpensesMaster /></ProtectedRoute>} />
      <Route path="/masters/items" element={<ProtectedRoute><ItemMaster /></ProtectedRoute>} />
      <Route path="/masters/item-groups" element={<ProtectedRoute><ItemGroupMaster /></ProtectedRoute>} />
      <Route path="/masters/hsn" element={<ProtectedRoute><HsnMaster /></ProtectedRoute>} />
      <Route path="/masters/financial-year" element={<ProtectedRoute><FinancialYearMaster /></ProtectedRoute>} />

      {/* ADMIN */}
      <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/expense-booking" element={<ProtectedRoute><AdminExpenseBooking /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><Users /></ProtectedRoute>} />
      <Route path="/admin/rights/menu" element={<ProtectedRoute><MenuRights /></ProtectedRoute>} />
      <Route path="/admin/rights/widgets" element={<ProtectedRoute><WidgetRights /></ProtectedRoute>} />
      <Route path="/admin/rights/fin-year" element={<ProtectedRoute><FinYearRights /></ProtectedRoute>} />
      <Route path="/admin/approval/setup" element={<ProtectedRoute><ApprovalSetup /></ProtectedRoute>} />
      <Route path="/admin/approval/post-rights" element={<ProtectedRoute><PostApprovalRights /></ProtectedRoute>} />

      {/* ✅ Merged Routes */}
      <Route path="/admin/api-integration" element={<ProtectedRoute><ApiIntegrationPage /></ProtectedRoute>} />
      <Route path="/admin/signature" element={<ProtectedRoute><SignaturePage /></ProtectedRoute>} />

      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/* ========================= APP ROOT ========================= */
function App() {
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setInitialLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  if (initialLoading) return <Loader />;

  return (
    <AuthProvider>
      <ModuleProvider>
        <ThemeProvider>
          <FinYearProvider>
            <HsnProvider>
              <RecordsProvider>
                <TaskProvider>
                  <Router>
                    <AppRoutes />
                  </Router>
                </TaskProvider>
              </RecordsProvider>
            </HsnProvider>
          </FinYearProvider>
        </ThemeProvider>
      </ModuleProvider>
    </AuthProvider>
  );
}

export default App;