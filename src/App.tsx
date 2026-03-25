import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import ExpenseBooking from "./pages/ExpenseBooking";

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

      {/* PROTECTED */}
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppLayout>
              <Routes>
                {/* MAIN */}
                <Route path="/" element={<Dashboard />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/transactions/expense-booking" element={<ExpenseBooking />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/widgets" element={<Widgets />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/payments" element={<Payment />} />

                {/* MASTERS */}
                <Route path="/masters/contractors" element={<ContractorMaster />} />
                <Route path="/masters/suppliers" element={<SupplierMaster />} />
                <Route path="/masters/customers" element={<CustomerMaster />} />
                <Route path="/masters/banks" element={<BankMaster />} />
                <Route path="/masters/expenses" element={<ExpensesMaster />} />
                <Route path="/masters/items" element={<ItemMaster />} />
                <Route path="/masters/item-groups" element={<ItemGroupMaster />} />
                <Route path="/masters/hsn" element={<HsnMaster />} />

                {/* ADMIN */}
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/expense-booking" element={<AdminExpenseBooking />} />
                <Route path="/users" element={<Users />} />
                <Route path="/admin/rights/menu" element={<MenuRights />} />
                <Route path="/admin/rights/widgets" element={<WidgetRights />} />
                <Route path="/admin/rights/fin-year" element={<FinYearRights />} />
                <Route path="/admin/approval/setup" element={<ApprovalSetup />} />
                <Route path="/admin/approval/post-rights" element={<PostApprovalRights />} />

                {/* 404 for authenticated users on unknown routes */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          </RequireAuth>
        }
      />

      {/* 404 for unauthenticated users on unknown routes — no login redirect */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/* =========================
   APP ROOT
========================= */
function App() {
  return (
    <AuthProvider>
      <ModuleProvider>
        <ThemeProvider>
          <FinYearProvider>
            <HsnProvider>
              <TaskProvider>
                <Router>
                  <AppRoutes />
                </Router>
              </TaskProvider>
            </HsnProvider>
          </FinYearProvider>
        </ThemeProvider>
      </ModuleProvider>
    </AuthProvider>
  );
}

export default App;

