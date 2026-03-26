import React, { useState, useEffect, Suspense } from "react";
import Loader from "./components/Loader";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

// Layout
import { AppLayout } from "@/components/layout/AppLayout";

// Main Pages
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import Widgets from "./pages/Widgets";
import Tasks from "./pages/Tasks";
import Transactions from "./pages/Transactions";
import Payment from "./pages/Payment";
import Brs from "./pages/Brs";
import ExpenseBooking from "./pages/ExpenseBooking";
import Records from "./pages/Records";
import ReceivedPayment from "./pages/ReceivedPayment";

// Masters
import ContractorMaster from "./pages/masters/ContractorMaster";
import SupplierMaster from "./pages/masters/SupplierMaster";
import CustomerMaster from "./pages/masters/CustomerMaster";

import BankMaster from "./pages/masters/BankMaster";
import ExpensesMaster from "./pages/masters/ExpensesMaster";
import ItemMaster from "./pages/masters/ItemMaster";
import ItemGroupMaster from "./pages/masters/ItemGroupMaster";
import HsnMaster from "./pages/masters/HsnMaster";

// Admin
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminExpenseBooking from "./pages/admin/ExpenseBooking";
import Users from "./pages/Users";
import MenuRights from "./pages/admin/MenuRights";
import WidgetRights from "./pages/admin/WidgetsRights";
import FinYearRights from "./pages/admin/FinYearRights";
import ApprovalSetup from "./pages/admin/ApprovalSetup";
import PostApprovalRights from "./pages/admin/PostApprovalRights";

// Contexts
import { AuthProvider } from "@/contexts/AuthContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TaskProvider } from "@/contexts/TaskContext";
import { FinYearProvider } from "@/contexts/FinYearContext";
import { HsnProvider } from "@/contexts/HsnContext";
import { RecordsProvider } from "@/contexts/RecordsContext";

/* =========================
   AUTH GUARD
========================= */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

/* =========================
   PROTECTED ROUTE WRAPPER
========================= */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppLayout>{children}</AppLayout>
    </RequireAuth>
  );
}

/* =========================
   ROUTES
========================= */
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

      {/* 404 — always shown, no auth gate */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/* =========================
   APP ROOT
========================= */
function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 500); // Initial splash screen for 1 second

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return <Loader />;
  }

  return (
    <Suspense fallback={<Loader />}>
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
    </Suspense>
  );
}

export default App;

