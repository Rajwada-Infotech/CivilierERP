import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { AuthProvider } from "@/contexts/AuthContext";

import LoginPage from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";
import Widgets from "./pages/Widgets";
import ContractorMaster from "./pages/masters/ContractorMaster";
import SupplierMaster from "./pages/masters/SupplierMaster";
import BankMaster from "./pages/masters/BankMaster";
import ExpensesMaster from "./pages/masters/ExpensesMaster";
import AccountGroupMaster from "./pages/setup/AccountGroupMaster";
import AccountHeadMaster from "./pages/setup/AccountHeadMaster";
import AdminModule from "./pages/admin/AdminModule";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <ModuleProvider>
          <TooltipProvider>
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<Dashboard />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/widgets" element={<Widgets />} />
                <Route path="/masters/contractors" element={<ContractorMaster />} />
                <Route path="/masters/suppliers" element={<SupplierMaster />} />
                <Route path="/masters/banks" element={<BankMaster />} />
                <Route path="/masters/expenses" element={<ExpensesMaster />} />
                <Route path="/setup/account-groups" element={<AccountGroupMaster />} />
                <Route path="/setup/account-heads" element={<AccountHeadMaster />} />
                <Route path="/admin" element={<AdminModule />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </ModuleProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
