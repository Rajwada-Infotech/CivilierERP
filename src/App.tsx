import TicketDashboard from "@/pages/ticket/TicketDashboard";

import CreateTicket from "@/pages/ticket/CreateTicket";

import MyTickets from "@/pages/ticket/MyTickets";

import PendingTickets from "@/pages/ticket/PendingTickets";

import ResolvedTickets from "@/pages/ticket/ResolvedTickets";
import React, { Suspense, lazy, useState, useEffect } from "react";
import { RouteErrorBoundary } from "./components/ErrorBoundary";
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
import CustomerPortal from "@/pages/customer/CustomerPortal";
import { CustomerLayout } from "@/components/layout/CustomerLayout";
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
import { useActivityBrowser } from "./contexts/ActivityBrowserContext";
import { ActivityBrowserProvider } from "./contexts/ActivityBrowserContext";

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
const FinanceDashboard = lazy(() => import("./pages/FinanceDashboard"));
const Reports = lazy(() => import("./pages/Reports"));
const Widgets = lazy(() => import("./pages/Widgets"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
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
const UnitMaster = lazy(() => import("./pages/followup/UnitMaster"));
const BlockMaster = lazy(() => import("./pages/followup/BlockMaster"));
const PaymentPlanMaster = lazy(
  () => import("./pages/followup/PaymentPlanMaster"),
);
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
const WorkOrderMaster = lazy(
  () => import("./pages/engineering/WorkOrderMaster"),
);
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
const RoleMaster = lazy(() => import("./pages/masters/RoleMaster"));
const MenuMasterPage = lazy(() => import("./pages/admin/masters/MenuMaster"));
const Home = lazy(() => import("./pages/Home"));
const TCMaster = lazy(() => import("./pages/material/T&CMaster"));
const UnitOfMeasurementMaster = lazy(
  () => import("./pages/material/UnitOfMeasurementMaster"),
);
const InventoryMaster = lazy(() => import("./pages/material/InventoryMaster"));
const Stock = lazy(() => import("./pages/material/Stock"));
const StockTransfer = lazy(() => import("./pages/material/StockTransfer"));
const EnterpriseMasterPage = lazy(
  () => import("./pages/admin/masters/EnterpriseMaster"),
);
const BOQ = lazy(() => import("./pages/engineering/BOQ"));

// Admin Pages
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminTicketPanel = lazy(() => import("./pages/admin/AdminTicketPanel"));
const TicketResolution = lazy(() => import("./pages/ticket/TicketResolution"));
const Users = lazy(() => import("./pages/Users"));
const MenuRights = lazy(() => import("./pages/admin/MenuRights"));
const WidgetRights = lazy(() => import("./pages/admin/WidgetsRights"));
const WidgetCatalogAdmin = lazy(
  () => import("./pages/admin/WidgetCatalogAdmin"),
);
const ContractorCategoryAdmin = lazy(
  () => import("./pages/admin/masters/ContractorCategoryAdmin"),
);
const PageDefinitionsAdmin = lazy(
  () => import("./pages/admin/masters/PageDefinitionsAdmin"),
);
const IntegrationChannelsAdmin = lazy(
  () => import("./pages/admin/masters/IntegrationChannelsAdmin"),
);
const GodownAdmin = lazy(() => import("./pages/admin/masters/GodownAdmin"));
const FinYearRights = lazy(() => import("./pages/admin/FinYearRights"));
const ApprovalSetup = lazy(() => import("./pages/admin/ApprovalSetup"));
const PostApprovalRights = lazy(
  () => import("./pages/admin/PostApprovalRights"),
);
const ApprovalInbox = lazy(() => import("./pages/admin/ApprovalInbox"));

const ApiIntegrationPage = lazy(() => import("./pages/admin/ApiIntegration"));
const SignaturePage = lazy(() => import("./pages/admin/Signature"));
const SuperAdminProfile = lazy(() => import("./pages/admin/SuperAdminProfile"));
const AdminProfile = lazy(() => import("./pages/admin/AdminProfile"));
const DBAProfile = lazy(() => import("./pages/dba/DBAProfile"));
const MetricsDashboard = lazy(() => import("./pages/admin/MetricsDashboard"));
const PasswordResetPage = lazy(
  () => import("./pages/admin/security/PasswordReset"),
);
const ActivityBrowserPage = lazy(
  () => import("./pages/admin/Activitybrowser/ActivityBrowser"),
);

// Admin Masters
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
const FollowupDashboard = lazy(
  () => import("./pages/followup/FollowupDashboard"),
);
const FollowupReminders = lazy(() => import("./pages/followup/Reminders"));
const POReminders = lazy(() => import("./pages/followup/POReminders"));
const WOReminders = lazy(() => import("./pages/followup/WOReminders"));
const CHQReminders = lazy(() => import("./pages/followup/CHQReminders"));
const GRNReminders = lazy(() => import("./pages/followup/GRNReminders"));
const TDSReminders = lazy(() => import("./pages/followup/TDSReminders"));
const FollowupTasks = lazy(() => import("./pages/followup/FollowupTasks"));
const PendingTasksPage = lazy(() => import("./pages/followup/PendingTasks"));
const FollowupLog = lazy(() => import("./pages/followup/FollowupLog"));
const FollowupApplicants = lazy(() => import("./pages/followup/Applications"));
const BookingsPage = lazy(() => import("./pages/followup/Bookings"));
const FollowupUnitSelection = lazy(
  () => import("./pages/followup/UnitSelection"),
);
const FollowupAgreements = lazy(() =>
  import("./pages/followup/Agreements").then((module) => ({
    default: module.AgreementsPage,
  })),
);
const ApplicantDetail = lazy(() => import("./pages/followup/ApplicantDetail"));
const WelcomeCallsPage = lazy(() =>
  import("./pages/followup/FollowupExtraPages").then((module) => ({
    default: module.WelcomeCallsPage,
  })),
);
const NocPage = lazy(() =>
  import("./pages/followup/NOC").then((module) => ({
    default: module.NOCPage,
  })),
);
const SalesDeedPage = lazy(() =>
  import("./pages/followup/SalesDeed").then((module) => ({
    default: module.SalesDeedPage,
  })),
);
const HandoverPage = lazy(() =>
  import("./pages/followup/FollowupExtraPages").then((module) => ({
    default: module.HandoverPage,
  })),
);
const ConstructionUpdatesPage = lazy(
  () => import("./pages/followup/ConstructionUpdates"),
);
const FinanceDemandsPage = lazy(() =>
  import("./pages/followup/FollowupExtraPages").then((module) => ({
    default: module.FinanceDemandsPage,
  })),
);
const FollowupPaymentsPage = lazy(() =>
  import("./pages/followup/FollowupExtraPages").then((module) => ({
    default: module.FollowupPaymentsPage,
  })),
);
const CustomerReportPage = lazy(() =>
  import("./pages/followup/FollowupExtraPages").then((module) => ({
    default: module.CustomerReportPage,
  })),
);
const FinancialReportPage = lazy(() =>
  import("./pages/followup/FollowupExtraPages").then((module) => ({
    default: module.FinancialReportPage,
  })),
);
const ProjectStatusReportPage = lazy(() =>
  import("./pages/followup/FollowupExtraPages").then((module) => ({
    default: module.ProjectStatusReportPage,
  })),
);
const AmendmentMenu = lazy(() => import("./pages/material/AmendmentMenu"));
const Amendments = lazy(() => import("./pages/material/Amendments"));
const Issues = lazy(() => import("./pages/material/Issues"));
const MaterialRequestPage = lazy(
  () => import("./pages/material/MaterialRequest"),
);
const RemindersManager = lazy(() => import("./pages/dba/RemindersManager"));

const PaymentLogs = lazy(() => import("./pages/dba/PaymentLogs"));

// Engineering Pages
const EngineeringDashboard = lazy(
  () => import("./pages/engineering/EngineeringDashboard"),
);
const WorkDone = lazy(() => import("./pages/engineering/WorkDone"));

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
function ProtectedProviders({ children }: { children: React.ReactNode }) {
  return (
    <RecordsProvider>
      <TdsProvider>
        <DebitNoteProvider>
          <BillingTermsProvider>
            <TaskProvider>{children}</TaskProvider>
          </BillingTermsProvider>
        </DebitNoteProvider>
      </TdsProvider>
    </RecordsProvider>
  );
}

const ADMIN_ROLES = ["super_admin", "admin", "dba"] as const;

function AdminRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RequireRole allowed={[...ADMIN_ROLES]}>
        <ProtectedProviders>
          <AppLayout>
            <RouteErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
            </RouteErrorBoundary>
          </AppLayout>
        </ProtectedProviders>
      </RequireRole>
    </RequireAuth>
  );
}

// ─── Super Admin Only Route ───────────────────────────────────────────────────
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RequireRole allowed={["super_admin"]}>
        <ProtectedProviders>
          <AppLayout>
            <RouteErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
            </RouteErrorBoundary>
          </AppLayout>
        </ProtectedProviders>
      </RequireRole>
    </RequireAuth>
  );
}

// ─── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <ProtectedProviders>
        <AppLayout>
          <RouteErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
          </RouteErrorBoundary>
        </AppLayout>
      </ProtectedProviders>
    </RequireAuth>
  );
}

// ─── Normal User Route (non-admin only) ──────────────────────────────────────
// Use for pages that only normal users should access (e.g. /ticket/my-tickets)
function NormalUserRoute({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const ADMIN_ROLES = ["super_admin", "admin", "dba"];
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }
  if (ADMIN_ROLES.includes(currentUser.role)) {
    // Admin landed on a user-only page — send them to pending tickets instead
    return <Navigate to="/ticket/pending" replace />;
  }
  return (
    <ProtectedProviders>
      <AppLayout>
        <RouteErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </RouteErrorBoundary>
      </AppLayout>
    </ProtectedProviders>
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
        path="/home/:userId?"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance"
        element={
          <ProtectedRoute>
            <FinanceDashboard />
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
        path="/command-center"
        element={
          <ProtectedRoute>
            <CommandCenter />
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
      <Route
        path="/followup/reminders"
        element={
          <ProtectedRoute>
            <FollowupReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/tasks"
        element={
          <ProtectedRoute>
            <FollowupTasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/log"
        element={
          <ProtectedRoute>
            <FollowupLog />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/reminders"
        element={
          <ProtectedRoute>
            <FollowupReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/po-reminders"
        element={
          <ProtectedRoute>
            <POReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/wo-reminders"
        element={
          <ProtectedRoute>
            <WOReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/chq-reminders"
        element={
          <ProtectedRoute>
            <CHQReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/grn-reminders"
        element={
          <ProtectedRoute>
            <GRNReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/tds-reminders"
        element={
          <ProtectedRoute>
            <TDSReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/tasks"
        element={
          <ProtectedRoute>
            <FollowupTasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/pending-tasks"
        element={
          <ProtectedRoute>
            <PendingTasksPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/customer-master"
        element={
          <ProtectedRoute>
            <CustomerMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/unit-master"
        element={
          <ProtectedRoute>
            <UnitMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/block-master"
        element={
          <ProtectedRoute>
            <BlockMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/payment-plan-master"
        element={
          <ProtectedRoute>
            <PaymentPlanMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/log"
        element={
          <ProtectedRoute>
            <FollowupLog />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/applicants"
        element={
          <ProtectedRoute>
            <FollowupApplicants />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/applicants/:id"
        element={
          <ProtectedRoute>
            <ApplicantDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/applicant-timeline/:id"
        element={
          <ProtectedRoute>
            <ApplicantDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/bookings"
        element={
          <ProtectedRoute>
            <BookingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/unit-selection"
        element={
          <ProtectedRoute>
            <FollowupUnitSelection />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/agreement/agreements"
        element={
          <ProtectedRoute>
            <FollowupAgreements />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/welcome-calls"
        element={
          <ProtectedRoute>
            <WelcomeCallsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/closure/noc"
        element={
          <ProtectedRoute>
            <NocPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/closure/sales-deed"
        element={
          <ProtectedRoute>
            <SalesDeedPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/closure/handover"
        element={
          <ProtectedRoute>
            <HandoverPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/construction/updates"
        element={
          <ProtectedRoute>
            <ConstructionUpdatesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/finance/demands"
        element={
          <ProtectedRoute>
            <FinanceDemandsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/finance/payments"
        element={
          <ProtectedRoute>
            <FollowupPaymentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/reports/customer"
        element={
          <ProtectedRoute>
            <CustomerReportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/reports/financial"
        element={
          <ProtectedRoute>
            <FinancialReportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/reports/project-status"
        element={
          <ProtectedRoute>
            <ProjectStatusReportPage />
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
        path="/material/debit-note"
        element={
          <ProtectedRoute>
            <DebitNoteMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/boq"
        element={
          <ProtectedRoute>
            <BOQ />
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
            <Amendments />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/amendment-menu"
        element={
          <ProtectedRoute>
            <AmendmentMenu />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/material-request"
        element={
          <ProtectedRoute>
            <MaterialRequestPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/issues"
        element={
          <ProtectedRoute>
            <Issues />
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
        path="/material/inventory-master"
        element={
          <ProtectedRoute>
            <InventoryMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/stock"
        element={
          <ProtectedRoute>
            <Stock />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/stock-transfer"
        element={
          <ProtectedRoute>
            <StockTransfer />
          </ProtectedRoute>
        }
      />

      {/* ENGINEERING */}
      <Route
        path="/engineering"
        element={
          <ProtectedRoute>
            <EngineeringDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ticket"
        element={
          <ProtectedRoute>
            <TicketDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/ticket/create"
        element={
          <ProtectedRoute>
            <CreateTicket />
          </ProtectedRoute>
        }
      />

      <Route
        path="/ticket/my-tickets"
        element={
          <ProtectedRoute>
            <MyTickets />
          </ProtectedRoute>
        }
      />

      <Route
        path="/ticket/pending"
        element={
          <AdminRoute>
            <PendingTickets />
          </AdminRoute>
        }
      />

      <Route
        path="/ticket/resolved"
        element={
          <ProtectedRoute>
            <ResolvedTickets />
          </ProtectedRoute>
        }
      />
      <Route
        path="/engineering/work-done"
        element={
          <ProtectedRoute>
            <WorkDone />
          </ProtectedRoute>
        }
      />
      {/* Engineering-namespaced aliases so the module stays on Engineering */}
      <Route
        path="/engineering/work-order"
        element={
          <ProtectedRoute>
            <WorkOrderMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/engineering/boq"
        element={
          <ProtectedRoute>
            <BOQ />
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
        path="/admin/masters/role-master"
        element={
          <AdminRoute>
            <RoleMaster />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/masters/menu-types"
        element={
          <AdminRoute>
            <MenuMasterPage />
          </AdminRoute>
        }
      />
      <Route
        path="/masters/business-unit"
        element={
          <ProtectedRoute>
            <EnterpriseMasterPage />
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
        path="/dba/:userId?"
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
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/dashboard/:userId?"
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
        path="/admin/widget-catalog"
        element={
          <AdminRoute>
            <WidgetCatalogAdmin />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/page-definitions"
        element={
          <AdminRoute>
            <PageDefinitionsAdmin />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/masters/integration-channels"
        element={
          <AdminRoute>
            <IntegrationChannelsAdmin />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/masters/contractor-categories"
        element={
          <AdminRoute>
            <ContractorCategoryAdmin />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/masters/godowns"
        element={
          <AdminRoute>
            <GodownAdmin />
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
        path="/admin/approval/inbox"
        element={
          <AdminRoute>
            <ApprovalInbox />
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
            <AdminProfile />
          </AdminRoute>
        }
      />
      <Route
        path="/superadmin/profile"
        element={
          <AdminRoute>
            <SuperAdminProfile />
          </AdminRoute>
        }
      />
      <Route
        path="/dba/profile"
        element={
          <AdminRoute>
            <DBAProfile />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/masters/business-unit"
        element={
          <AdminRoute>
            <EnterpriseMasterPage />
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
      <Route
        path="/admin/tickets"
        element={
          <AdminRoute>
            <AdminTicketPanel />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/tickets/resolution"
        element={
          <AdminRoute>
            <TicketResolution />
          </AdminRoute>
        }
      />

      {/* SUPER ADMIN */}
      <Route
        path="/superadmin"
        element={
          <SuperAdminRoute>
            <SuperAdminDashboard />
          </SuperAdminRoute>
        }
      />

      {/* CUSTOMER PORTAL */}
      <Route
        path="/customer-portal/:userId?"
        element={
          <RequireAuth>
            <RequireRole allowed={["customer"]}>
              <CustomerLayout>
                <RouteErrorBoundary>
                  <Suspense fallback={<PageSkeleton />}>
                    <CustomerPortal />
                  </Suspense>
                </RouteErrorBoundary>
              </CustomerLayout>
            </RequireRole>
          </RequireAuth>
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

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster richColors position="top-right" />
      {/* ActivityBrowserProvider is always mounted so AuthSessionBridge is always inside it.
          The initialLoading gate moved inside the tree to avoid provider context being missing
          during hot-module-reload or React strict-mode double-renders. */}
      <ActivityBrowserProvider>
        <AuthSessionBridge>
          {initialLoading ? <Loader /> : null}
          {initialLoading ? null : (
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
                      <AppRoutes />
                    </HsnProvider>
                  </FinYearProvider>
                </ThemeProvider>
              </ModuleProvider>
            </Router>
          )}
        </AuthSessionBridge>
      </ActivityBrowserProvider>
    </QueryClientProvider>
  );
}

export default App;
