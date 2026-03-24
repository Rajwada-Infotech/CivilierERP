import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Route,
  Routes,
  Navigate,
  useLocation,
} from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TaskProvider } from "@/contexts/TaskContext";
import { FinYearProvider } from "@/contexts/FinYearContext";

import LoginPage from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";
import Widgets from "./pages/Widgets";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/tasks/TaskDetail";

// Masters
import ContractorMaster from "./pages/masters/ContractorMaster";
import SupplierMaster from "./pages/masters/SupplierMaster";
import CustomerMaster from "./pages/masters/CustomerMaster";
import BankMaster from "./pages/masters/BankMaster";
import ExpensesMaster from "./pages/masters/ExpensesMaster";
import ItemMaster from "./pages/masters/ItemMaster";
import ItemGroupMaster from "./pages/masters/ItemGroupMaster";

// Setup (from feature)
import AccountGroupMaster from "./pages/setup/AccountGroupMaster";
import AccountHeadMaster from "./pages/setup/AccountHeadMaster";

// Admin
import AdminDashboard from "./pages/admin/AdminDashboard";
import MenuRights from "./pages/admin/MenuRights";
import WidgetsRights from "./pages/admin/WidgetsRights";
import FinYearRights from "./pages/admin/FinYearRights";
import ApprovalSetup from "./pages/admin/ApprovalSetup";
import PostApprovalRights from "./pages/admin/PostApprovalRights";
import ExpenseBooking from "./pages/admin/ExpenseBooking";

// Feature pages
import TransactionExpenseBooking from "./pages/ExpenseBooking";
import Payment from "./pages/Payment";

import NotFound from "./pages/NotFound";
import Users from "./pages/Users";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useAuth();

  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
    <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

    <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
    <Route path="/transactions/expense-booking" element={<ProtectedRoute><TransactionExpenseBooking /></ProtectedRoute>} />

    <Route path="/users" element={<ProtectedRoute><Users /></ProtectedRoute>} />
    <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
    <Route path="/widgets" element={<ProtectedRoute><Widgets /></ProtectedRoute>} />

    <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
    <Route path="/tasks/:id" element={<ProtectedRoute><TaskDetail /></ProtectedRoute>} />

    <Route path="/payments" element={<ProtectedRoute><Payment /></ProtectedRoute>} />

    {/* Masters */}
    <Route path="/masters/contractors" element={<ProtectedRoute><ContractorMaster /></ProtectedRoute>} />
    <Route path="/masters/suppliers" element={<ProtectedRoute><SupplierMaster /></ProtectedRoute>} />
    <Route path="/masters/customers" element={<ProtectedRoute><CustomerMaster /></ProtectedRoute>} />
    <Route path="/masters/banks" element={<ProtectedRoute><BankMaster /></ProtectedRoute>} />
    <Route path="/masters/expenses" element={<ProtectedRoute><ExpensesMaster /></ProtectedRoute>} />
    <Route path="/masters/items" element={<ProtectedRoute><ItemMaster /></ProtectedRoute>} />
    <Route path="/masters/item-groups" element={<ProtectedRoute><ItemGroupMaster /></ProtectedRoute>} />

    {/* Setup */}
    <Route path="/setup/account-groups" element={<ProtectedRoute><AccountGroupMaster /></ProtectedRoute>} />
    <Route path="/setup/account-heads" element={<ProtectedRoute><AccountHeadMaster /></ProtectedRoute>} />

    {/* Admin */}
    <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
    <Route path="/admin/dashboard" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
    <Route path="/admin/rights/menu" element={<ProtectedRoute><MenuRights /></ProtectedRoute>} />
    <Route path="/admin/rights/widgets" element={<ProtectedRoute><WidgetsRights /></ProtectedRoute>} />
    <Route path="/admin/rights/fin-year" element={<ProtectedRoute><FinYearRights /></ProtectedRoute>} />
    <Route path="/admin/approval/setup" element={<ProtectedRoute><ApprovalSetup /></ProtectedRoute>} />
    <Route path="/admin/approval/post-rights" element={<ProtectedRoute><PostApprovalRights /></ProtectedRoute>} />
    <Route path="/admin/transactions/expense-booking" element={<ProtectedRoute><ExpenseBooking /></ProtectedRoute>} />

    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <TaskProvider>
            <ModuleProvider>
              <FinYearProvider>
                <TooltipProvider>
                  <Sonner />
                  <AppRoutes />
                </TooltipProvider>
              </FinYearProvider>
            </ModuleProvider>
          </TaskProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;