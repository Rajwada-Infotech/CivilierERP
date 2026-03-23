import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TaskProvider } from "@/contexts/TaskContext";

import LoginPage from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";
import Widgets from "./pages/Widgets";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/tasks/TaskDetail";
import ContractorMaster from "./pages/masters/ContractorMaster";
import SupplierMaster from "./pages/masters/SupplierMaster";
import CustomerMaster from "./pages/masters/CustomerMaster";
import BankMaster from "./pages/masters/BankMaster";
import ExpensesMaster from "./pages/masters/ExpensesMaster";
import AccountGroupMaster from "./pages/setup/AccountGroupMaster";
import AccountHeadMaster from "./pages/setup/AccountHeadMaster";
import AdminModule from "./pages/admin/AdminModule";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useAuth();
  const location = useLocation();
  if (!currentUser) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
};

const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useAuth();
  if (currentUser) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/login"                 element={<PublicRoute><LoginPage /></PublicRoute>} />
    <Route path="/"                      element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
    <Route path="/transactions"          element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
    <Route path="/reports"               element={<ProtectedRoute><Reports /></ProtectedRoute>} />
    <Route path="/widgets"               element={<ProtectedRoute><Widgets /></ProtectedRoute>} />
    <Route path="/tasks"                 element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
    <Route path="/tasks/:id"             element={<ProtectedRoute><TaskDetail /></ProtectedRoute>} />
    <Route path="/masters/contractors"   element={<ProtectedRoute><ContractorMaster /></ProtectedRoute>} />
    <Route path="/masters/suppliers"     element={<ProtectedRoute><SupplierMaster /></ProtectedRoute>} />
    <Route path="/masters/customers"     element={<ProtectedRoute><CustomerMaster /></ProtectedRoute>} />
    <Route path="/masters/banks"         element={<ProtectedRoute><BankMaster /></ProtectedRoute>} />
    <Route path="/masters/expenses"      element={<ProtectedRoute><ExpensesMaster /></ProtectedRoute>} />
    <Route path="/setup/account-groups"  element={<ProtectedRoute><AccountGroupMaster /></ProtectedRoute>} />
    <Route path="/setup/account-heads"   element={<ProtectedRoute><AccountHeadMaster /></ProtectedRoute>} />
    <Route path="/admin"                 element={<ProtectedRoute><AdminModule /></ProtectedRoute>} />
    <Route path="*"                      element={<NotFound />} />
  </Routes>
);

// AppRoutes needs to be inside BrowserRouter to use useLocation
// AuthProvider wraps everything so useAuth works inside ProtectedRoute/PublicRoute
const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TaskProvider>
          <ModuleProvider>
            <TooltipProvider>
              <Sonner />
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </TooltipProvider>
          </ModuleProvider>
        </TaskProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
