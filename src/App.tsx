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

// Static imports (needed synchronously for auth shell)
import Login from "./pages/Login";
import Landing from "./pages/Landing";
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
// Ticket Pages
const TicketDashboard = lazy(() => import("@/pages/ticket/TicketDashboard"));
const CreateTicket = lazy(() => import("@/pages/ticket/CreateTicket"));
const MyTickets = lazy(() => import("@/pages/ticket/MyTickets"));
const PendingTickets = lazy(() => import("@/pages/ticket/PendingTickets"));
const ResolvedTickets = lazy(() => import("@/pages/ticket/ResolvedTickets"));

// Customer Portal
const CustomerPortal = lazy(() => import("@/pages/customer/CustomerPortal"));
const CustomerLayout = lazy(() =>
  import("@/components/layout/CustomerLayout").then((m) => ({
    default: m.CustomerLayout,
  })),
);

// Supplier Portal
const SupplierLayout = lazy(() =>
  import("@/components/layout/SupplierLayout").then((m) => ({
    default: m.SupplierLayout,
  })),
);

// Main Pages
const FinanceDashboard = lazy(() => import("./pages/finance/FinanceDashboard"));
const Reports = lazy(() => import("./pages/Reports"));
const Widgets = lazy(() => import("./pages/Widgets"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Transactions = lazy(() => import("./pages/finance/Transactions"));
const Payment = lazy(() => import("./pages/finance/Payment"));
const Brs = lazy(() => import("./pages/finance/Brs"));
const Records = lazy(() => import("./pages/records/Records"));
const CivilWorkDprDashboard = lazy(
  () => import("./pages/civilworkdpr/CivilWorkDprDashboard"),
);
const DependencyTracker = lazy(
  () => import("./pages/civilworkdpr/DependencyTracker"),
);
const ContractorRegister = lazy(
  () => import("./pages/civilworkdpr/ContractorRegister"),
);
const WorkerAttendance = lazy(
  () => import("./pages/civilworkdpr/WorkerAttendance"),
);
const ReceivedPayment = lazy(() => import("./pages/finance/ReceivedPayment"));
const TrialBalance = lazy(() => import("./pages/finance/TrialBalance"));
const JournalVoucher = lazy(() => import("./pages/finance/JournalVoucher"));
const FinanceContract = lazy(() => import("./pages/finance/Contract"));
const OnAccountReport = lazy(() => import("./pages/finance/OnAccountReport"));
const OnAccountAdjustment = lazy(() => import("./pages/finance/OnAccountAdjustment"));

// Task Detail
const TaskDetail = lazy(() => import("./pages/tasks/TaskDetail"));

// Masters
const ContractorMaster = lazy(() => import("./pages/masters/ContractorMaster"));
const SupplierMaster = lazy(() => import("./pages/masters/SupplierMaster"));
const CustomerMaster = lazy(() => import("./pages/masters/CustomerMaster"));
const UnitMaster = lazy(() => import("./pages/followup/UnitMaster"));
const RoomMaster = lazy(() => import("./pages/followup/RoomMaster"));
const BlockMaster = lazy(() => import("./pages/followup/BlockMaster"));
const PaymentPlanMaster = lazy(
  () => import("./pages/followup/PaymentPlanMaster"),
);
const ParkingMaster = lazy(() => import("./pages/followup/ParkingMaster"));
const ParkingSlotMaster = lazy(
  () => import("./pages/followup/ParkingSlotMaster"),
);
const ExtraChargeMaster = lazy(
  () => import("./pages/followup/ExtraChargeMaster"),
);
const UnitMatrixPage = lazy(() => import("./pages/CRM/CrmUnitMatrix"));
const ParkingMatrixPage = lazy(() => import("./pages/CRM/CrmParkingMatrix"));
const CrmParkingBookingPage = lazy(() => import("./pages/CRM/CrmParkingBooking"));
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
const FixedAssetRecord = lazy(() => import("./pages/material/FixedAssetRecord"));
const ShortClose = lazy(() => import("./pages/material/ShortClose"));
const DepreciationSetup = lazy(() => import("./pages/material/DepreciationSetup"));
const VehicleInOut = lazy(() => import("./pages/material/VehicleInOut"));
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
const QuotationPage = lazy(() => import("./pages/material/Quotation"));
const L1ChartPage = lazy(() => import("./pages/material/L1Chart"));
const SupplierDashboard = lazy(() => import("./pages/supplier/SupplierDashboard"));
const SupplierLanding = lazy(() => import("./pages/supplier/SupplierLanding"));
const SupplierLogin = lazy(() => import("./pages/supplier/SupplierLogin"));
const SupplierQuotationDetail = lazy(
  () => import("./pages/supplier/SupplierQuotationDetail"),
);
const SupplierCatalog = lazy(() => import("./pages/supplier/SupplierCatalog"));
const SupplierCompanyProfile = lazy(() => import("./pages/supplier/SupplierCompanyProfile"));
const SupplierNotifications = lazy(() => import("./pages/supplier/SupplierNotifications"));
const SupplierCreditNotes = lazy(() => import("./pages/supplier/SupplierCreditNotes"));
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
const SaleOrder = lazy(() => import("./pages/sales/SaleOrder"));
const SalesPayment = lazy(() => import("./pages/sales/Payment"));
const SaleInvoice = lazy(() => import("./pages/sales/SaleInvoice"));
const SalesDashboard = lazy(() => import("./pages/sales/SalesDashboard"));
const EnterpriseMasterPage = lazy(
  () => import("./pages/admin/masters/EnterpriseMaster"),
);
const BOQ = lazy(() => import("./pages/engineering/BOQ"));
const DailyProgressReport = lazy(
  () => import("./pages/engineering/DailyProgressReport"),
);

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
const CostCenterMaster = lazy(
  () => import("./pages/masters/CostCenterMaster"),
);
const ProfitCenterMaster = lazy(
  () => import("./pages/masters/ProfitCenterMaster"),
);
const ReturnReasonMaster = lazy(
  () => import("./pages/masters/ReturnReasonMaster"),
);
const PaymentReasonMaster = lazy(
  () => import("./pages/masters/PaymentReasonMaster"),
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

// BookingsPage / FollowupUnitSelection / FollowupApplications / WelcomeCallsPage retired below
// (0 live rows, duplicate CRM entry points — see server.js ALL_ROUTES comment for details).
const ApplicantDetail = lazy(() => import("./pages/followup/ApplicantDetail"));
const ApplicantTimeline = lazy(
  () => import("./pages/followup/ApplicantTimeline"),
);
const NocPage = lazy(() =>
  import("./pages/followup/NOC").then((module) => ({
    default: module.NOCPage,
  })),
);
const BankNOCPage = lazy(() =>
  import("./pages/followup/BankNOC").then((module) => ({
    default: module.BankNOCPage,
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
// LegalMilestonesPage retired below (0 live rows, duplicate of crmLegalMilestones.js).
const PrePossessionPage = lazy(
  () => import("./pages/followup/PrePossessionClearance"),
);
const PossessionNoticePage = lazy(
  () => import("./pages/followup/PossessionNotice"),
);
const FinanceDemandsPage = lazy(() =>
  import("./pages/followup/FinanceDemands").then((module) => ({
    default: module.FinanceDemandsPage,
  })),
);
const DocumentVaultPage = lazy(() => import("./pages/followup/DocumentVault"));
const SaSocialMediaMaster = lazy(() => import("./pages/SalesAutomation/SaSocialMediaMaster"));
const SaCampaignMaster = lazy(() => import("./pages/SalesAutomation/SaCampaignMaster"));
const SaAdMaster = lazy(() => import("./pages/SalesAutomation/SaAdMaster"));
const SaLeadManagement = lazy(() => import("./pages/SalesAutomation/SaLeadManagement"));
const SaChannelPartners = lazy(() => import("./pages/SalesAutomation/SaChannelPartners"));
const SaLeadActivities = lazy(() => import("./pages/SalesAutomation/SaLeadActivities"));
const SaFollowups = lazy(() => import("./pages/SalesAutomation/SaFollowups"));
const SaLeadTasks = lazy(() => import("./pages/SalesAutomation/SaLeadTasks"));
const SaLeadDistribution = lazy(() => import("./pages/SalesAutomation/SaLeadDistribution"));
const SaInquiryDashboard = lazy(() => import("./pages/SalesAutomation/SaInquiryDashboard"));
const SaSiteVisits = lazy(() => import("./pages/SalesAutomation/SaSiteVisits"));
const SaMarketingInvoices = lazy(() => import("./pages/SalesAutomation/SaMarketingInvoices"));
const SaMarketingDashboard = lazy(() => import("./pages/SalesAutomation/SaMarketingDashboard"));
const SaSalesDashboard = lazy(() => import("./pages/SalesAutomation/SaSalesDashboard"));
const SaTeamLeadDashboard = lazy(() => import("./pages/SalesAutomation/SaTeamLeadDashboard"));
const SaReports = lazy(() => import("./pages/SalesAutomation/SaReports"));
const SaTeamManagement = lazy(() => import("./pages/SalesAutomation/SaTeamManagement"));
const SaLeadTransfers = lazy(() => import("./pages/SalesAutomation/SaLeadTransfers"));
const SaCommissions = lazy(() => import("./pages/SalesAutomation/SaCommissions"));
const SaDistributionRules = lazy(() => import("./pages/SalesAutomation/SaDistributionRules"));
const SaRoleMaster = lazy(() => import("./pages/SalesAutomation/SaRoleMaster"));
// ── CRM Module ────────────────────────────────────────────────────────────────
const CrmCustomers         = lazy(() => import("./pages/CRM/CrmCustomers"));
const CrmApplication       = lazy(() => import("./pages/CRM/CrmApplication"));
const CrmBooking           = lazy(() => import("./pages/CRM/CrmBooking"));
const CrmWelcomeCall       = lazy(() => import("./pages/CRM/CrmWelcomeCall"));
const CrmAgreement         = lazy(() => import("./pages/CRM/CrmAgreement"));
const CrmAgreementPapers   = lazy(() => import("./pages/CRM/CrmAgreementPapers"));
const CrmPaymentMilestones = lazy(() => import("./pages/CRM/CrmPaymentMilestones"));
const CrmDemands           = lazy(() => import("./pages/CRM/CrmDemands"));
const CrmHandover          = lazy(() => import("./pages/CRM/CrmHandover"));
const CrmServiceTickets    = lazy(() => import("./pages/CRM/CrmServiceTickets"));
const CrmCancellations     = lazy(() => import("./pages/CRM/CrmCancellations"));
const CrmCustomer360       = lazy(() => import("./pages/CRM/CrmCustomer360"));
const CrmLoanTracking      = lazy(() => import("./pages/CRM/CrmLoanTracking"));
const CrmLegalMilestones   = lazy(() => import("./pages/CRM/CrmLegalMilestones"));
const CrmNoc               = lazy(() => import("./pages/CRM/CrmNoc"));
const CrmSalesDeed         = lazy(() => import("./pages/CRM/CrmSalesDeed"));
const CrmPrePossession     = lazy(() => import("./pages/CRM/CrmPrePossession"));
const CrmPossessionNotice  = lazy(() => import("./pages/CRM/CrmPossessionNotice"));
const CrmConstructionUpdates = lazy(() => import("./pages/CRM/CrmConstructionUpdates"));
const CrmCommunication     = lazy(() => import("./pages/CRM/CrmCommunication"));
const CrmDashboard         = lazy(() => import("./pages/CRM/CrmDashboard"));
const CrmCustomerBankDetails = lazy(() => import("./pages/CRM/CrmCustomerBankDetails"));
const CrmBrokerage         = lazy(() => import("./pages/CRM/CrmBrokerage"));
const CrmPaymentPlans      = lazy(() => import("./pages/CRM/CrmPaymentPlans"));
const CrmProjectBanks      = lazy(() => import("./pages/CRM/CrmProjectBanks"));
const CrmMilestoneMaster   = lazy(() => import("./pages/CRM/CrmMilestoneMaster"));
const CrmBrokerMaster      = lazy(() => import("./pages/CRM/CrmBrokerMaster"));
const CrmBrokerPayments    = lazy(() => import("./pages/CRM/CrmBrokerPayments"));
const PortalLogin          = lazy(() => import("./pages/CrmCustomerPortal/PortalLogin"));
const PortalChangePassword = lazy(() => import("./pages/CrmCustomerPortal/PortalChangePassword"));
const PortalLayout         = lazy(() => import("./pages/CrmCustomerPortal/PortalLayout"));
const PortalOverview       = lazy(() => import("./pages/CrmCustomerPortal/PortalOverview"));
const PortalBooking        = lazy(() => import("./pages/CrmCustomerPortal/PortalBooking"));
const PortalAgreement      = lazy(() => import("./pages/CrmCustomerPortal/PortalAgreement"));
const PortalPayments       = lazy(() => import("./pages/CrmCustomerPortal/PortalPayments"));
const PortalConstruction   = lazy(() => import("./pages/CrmCustomerPortal/PortalConstruction"));
const PortalTickets        = lazy(() => import("./pages/CrmCustomerPortal/PortalTickets"));
const PortalActivity       = lazy(() => import("./pages/CrmCustomerPortal/PortalActivity"));
const PortalProfile        = lazy(() => import("./pages/CrmCustomerPortal/PortalProfile"));
const CommunicatorPage = lazy(() => import("./pages/followup/Communicator"));
const ApplicantsPipelinePage = lazy(() =>
  import("./pages/followup/FollowupPipelinePage").then((module) => ({
    default: module.ApplicantsPage,
  })),
);
const UnitSelectionPipelinePage = lazy(() =>
  import("./pages/followup/FollowupPipelinePage").then((module) => ({
    default: module.UnitSelectionPage,
  })),
);
const FollowupPaymentsPage = lazy(() =>
  import("./pages/followup/FinancePayments").then((module) => ({
    default: module.FinancePaymentsPage,
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
const IssueReturn = lazy(() => import("./pages/material/IssueReturn"));
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
const EngineeringAmendmentMenu = lazy(
  () => import("./pages/engineering/EngineeringAmendmentMenu"),
);

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
    <FinYearProvider>
      <HsnProvider>
        <RecordsProvider>
          <TdsProvider>
            <DebitNoteProvider>
              <BillingTermsProvider>
                <TaskProvider>{children}</TaskProvider>
              </BillingTermsProvider>
            </DebitNoteProvider>
          </TdsProvider>
        </RecordsProvider>
      </HsnProvider>
    </FinYearProvider>
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

// ─── Approval Inbox Route — admin-tier OR users with explicit approval-inbox right ─
function ApprovalInboxRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, canAccessPage } = useAuth();
  if (
    !currentUser ||
    (!ADMIN_ROLES.includes(currentUser.role as any) &&
      !canAccessPage("approval-inbox"))
  ) {
    return <Navigate to="/" replace />;
  }
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

// ─── Page-level Rights Guard ──────────────────────────────────────────────────
// Wraps a route and checks canAccessPage(pageKey) before rendering.
// Privileged roles (super_admin, admin, dba) always pass.
// Regular users are redirected to home with an "Access Denied" flash if denied.
function PageGuard({
  pageKey,
  children,
}: {
  pageKey: string;
  children: React.ReactNode;
}) {
  const { currentUser, canAccessPage } = useAuth();
  const role = currentUser?.role ?? "";
  const privileged = ["super_admin", "admin", "dba"].includes(role);
  if (!privileged && !canAccessPage(pageKey as any)) {
    return <Navigate to="/home" replace state={{ denied: pageKey }} />;
  }
  return <>{children}</>;
}

// ─── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute({
  children,
  pageKey,
}: {
  children: React.ReactNode;
  pageKey?: string;
}) {
  return (
    <RequireAuth>
      <ProtectedProviders>
        <AppLayout>
          <RouteErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              {pageKey ? (
                <PageGuard pageKey={pageKey}>{children}</PageGuard>
              ) : (
                children
              )}
            </Suspense>
          </RouteErrorBoundary>
        </AppLayout>
      </ProtectedProviders>
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
      {/* CRM CUSTOMER PORTAL — separate token-based auth, not the staff ERP session */}
      <Route path="/crm-client-portal/login" element={<Suspense fallback={<PageSkeleton />}><PortalLogin /></Suspense>} />
      <Route path="/crm-client-portal/change-password" element={<Suspense fallback={<PageSkeleton />}><PortalChangePassword /></Suspense>} />
      <Route path="/crm-client-portal" element={<Suspense fallback={<PageSkeleton />}><PortalLayout /></Suspense>}>
        <Route path="dashboard" element={<PortalOverview />} />
        <Route path="booking" element={<PortalBooking />} />
        <Route path="agreement" element={<PortalAgreement />} />
        <Route path="payments" element={<PortalPayments />} />
        <Route path="construction" element={<PortalConstruction />} />
        <Route path="tickets" element={<PortalTickets />} />
        <Route path="activity" element={<PortalActivity />} />
        <Route path="profile" element={<PortalProfile />} />
      </Route>

      {/* AUTH */}
      <Route
        path="/login"
        element={
          currentUser
            ? currentUser.role === "supplier"
              ? <Navigate to="/supplier" replace />
              : currentUser.role === "customer"
                ? <Navigate to={`/customer-portal/${currentUser.id}`} replace />
                : currentUser.role === "dba"
                  ? <Navigate to={`/dba/${currentUser.id}`} replace />
                  : <Navigate to="/" replace />
            : <Login />
        }
      />

      {/* MAIN */}
      <Route
        path="/home/:userId?"
        element={
          currentUser?.role === "supplier"
            ? <Navigate to="/supplier" replace />
            : <ProtectedRoute><Home /></ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          currentUser ? (
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          ) : (
            <Landing />
          )
        }
      />
      <Route
        path="/finance"
        element={
          <ProtectedRoute pageKey="finance-dashboard">
            <FinanceDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/transactions"
        element={
          <ProtectedRoute pageKey="transactions">
            <Transactions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/trial-balance"
        element={
          <ProtectedRoute pageKey="trial-balance">
            <TrialBalance />
          </ProtectedRoute>
        }
      />
      <Route
        path="/on-account-report"
        element={
          <ProtectedRoute pageKey="on-account-report">
            <OnAccountReport />
          </ProtectedRoute>
        }
      />
      <Route
        path="/on-account-adjustment"
        element={
          <ProtectedRoute pageKey="on-account-adjustment">
            <OnAccountAdjustment />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute pageKey="reports">
            <Reports />
          </ProtectedRoute>
        }
      />
      <Route
        path="/widgets"
        element={
          <ProtectedRoute pageKey="widgets">
            <Widgets />
          </ProtectedRoute>
        }
      />
      <Route
        path="/command-center"
        element={
          <ProtectedRoute pageKey="command-center">
            <CommandCenter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks"
        element={
          <ProtectedRoute pageKey="tasks">
            <Tasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks/:id"
        element={
          <ProtectedRoute pageKey="tasks">
            <TaskDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payments"
        element={
          <ProtectedRoute pageKey="new-payment">
            <Payment />
          </ProtectedRoute>
        }
      />
      <Route
        path="/received-payments"
        element={
          <ProtectedRoute pageKey="received-payment">
            <ReceivedPayment />
          </ProtectedRoute>
        }
      />
      <Route
        path="/journal-voucher"
        element={
          <ProtectedRoute pageKey="journal-voucher">
            <JournalVoucher />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/contracts"
        element={
          <ProtectedRoute pageKey="finance-contracts">
            <FinanceContract />
          </ProtectedRoute>
        }
      />
      <Route
        path="/brs"
        element={
          <ProtectedRoute pageKey="brs">
            <Brs />
          </ProtectedRoute>
        }
      />
      <Route
        path="/records"
        element={
          <ProtectedRoute pageKey="records">
            <Records />
          </ProtectedRoute>
        }
      />
      <Route
        path="/civilworkdpr"
        element={
          <ProtectedRoute pageKey="civilworkdpr-dashboard">
            <CivilWorkDprDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/civilworkdpr/dependency"
        element={
          <ProtectedRoute pageKey="civilworkdpr-dependency">
            <DependencyTracker />
          </ProtectedRoute>
        }
      />
      <Route
        path="/civilworkdpr/contractor-register"
        element={
          <ProtectedRoute pageKey="civilworkdpr-contractor-register">
            <ContractorRegister />
          </ProtectedRoute>
        }
      />
      <Route
        path="/civilworkdpr/worker-attendance"
        element={
          <ProtectedRoute pageKey="civilworkdpr-worker-attendance">
            <WorkerAttendance />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup"
        element={
          <ProtectedRoute pageKey="followup-dashboard">
            <FollowupDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/reminders"
        element={
          <ProtectedRoute pageKey="followup-reminders">
            <FollowupReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/tasks"
        element={
          <ProtectedRoute pageKey="followup-tasks">
            <FollowupTasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/log"
        element={
          <ProtectedRoute pageKey="followup-log">
            <FollowupLog />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/reminders"
        element={
          <ProtectedRoute pageKey="followup-reminders">
            <FollowupReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/po-reminders"
        element={
          <ProtectedRoute pageKey="po-reminders">
            <POReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/wo-reminders"
        element={
          <ProtectedRoute pageKey="wo-reminders">
            <WOReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/chq-reminders"
        element={
          <ProtectedRoute pageKey="chq-reminders">
            <CHQReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/grn-reminders"
        element={
          <ProtectedRoute pageKey="grn-reminders">
            <GRNReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/tds-reminders"
        element={
          <ProtectedRoute pageKey="tds-reminders">
            <TDSReminders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/tasks"
        element={
          <ProtectedRoute pageKey="followup-tasks">
            <FollowupTasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/pending-tasks"
        element={
          <ProtectedRoute pageKey="followup-pending-tasks">
            <PendingTasksPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/customer-master"
        element={
          <ProtectedRoute pageKey="followup-customer-master">
            <CustomerMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/unit-master"
        element={
          <ProtectedRoute pageKey="followup-unit-master">
            <UnitMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/room-master"
        element={
          <ProtectedRoute pageKey="followup-room-master">
            <RoomMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/block-master"
        element={
          <ProtectedRoute pageKey="followup-block-master">
            <BlockMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/payment-plan-master"
        element={
          <ProtectedRoute pageKey="payment-plan-master">
            <PaymentPlanMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/parking-master"
        element={
          <ProtectedRoute pageKey="followup-parking-master">
            <ParkingMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/parking-slot-master"
        element={
          <ProtectedRoute pageKey="followup-parking-slot-master">
            <ParkingSlotMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/setup/extra-charge-master"
        element={
          <ProtectedRoute pageKey="followup-extra-charge-master">
            <ExtraChargeMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/follow-ups/log"
        element={
          <ProtectedRoute pageKey="followup-log">
            <FollowupLog />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/applications/:id"
        element={
          <ProtectedRoute pageKey="followup-applications">
            <ApplicantDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/applicants/:id"
        element={
          <ProtectedRoute pageKey="followup-applicants">
            <ApplicantDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/applicant-timeline/:id"
        element={
          <ProtectedRoute pageKey="followup-applicant-timeline">
            <ApplicantTimeline />
          </ProtectedRoute>
        }
      />
      {/* Applications / Bookings / Unit Selection / Welcome Calls list routes retired —
          0 live rows, superseded by the real CRM system (see server.js ALL_ROUTES comment). */}
      <Route
        path="/followup/closure/noc"
        element={
          <ProtectedRoute pageKey="followup-noc">
            <NocPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/closure/bank-noc"
        element={
          <ProtectedRoute pageKey="followup-noc">
            <BankNOCPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/closure/sales-deed"
        element={
          <ProtectedRoute pageKey="followup-sales-deed">
            <SalesDeedPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/closure/handover"
        element={
          <ProtectedRoute pageKey="followup-handover">
            <HandoverPage />
          </ProtectedRoute>
        }
      />
      {/* Legal Milestones list route retired — 0 live rows, superseded by crmLegalMilestones.js. */}
      <Route
        path="/followup/closure/pre-possession"
        element={
          <ProtectedRoute pageKey="followup-pre-possession">
            <PrePossessionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/closure/possession-notice"
        element={
          <ProtectedRoute pageKey="followup-possession-notice">
            <PossessionNoticePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/construction/updates"
        element={
          <ProtectedRoute pageKey="followup-construction-updates">
            <ConstructionUpdatesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/finance/demands"
        element={
          <ProtectedRoute pageKey="followup-demands">
            <FinanceDemandsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/finance/payments"
        element={
          <ProtectedRoute pageKey="followup-payments">
            <FollowupPaymentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/reports/customer"
        element={
          <ProtectedRoute pageKey="followup-report-customer">
            <CustomerReportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/reports/financial"
        element={
          <ProtectedRoute pageKey="followup-report-financial">
            <FinancialReportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/reports/project-status"
        element={
          <ProtectedRoute pageKey="followup-report-project-status">
            <ProjectStatusReportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/agreement/document-vault"
        element={
          <ProtectedRoute pageKey="followup-document-vault">
            <DocumentVaultPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/agreement/communicator"
        element={
          <ProtectedRoute pageKey="followup-communicator">
            <CommunicatorPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/pipeline/applicants"
        element={
          <ProtectedRoute pageKey="followup-applicants">
            <ApplicantsPipelinePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/followup/sales/pipeline/unit-selections"
        element={
          <ProtectedRoute pageKey="followup-unit-selections">
            <UnitSelectionPipelinePage />
          </ProtectedRoute>
        }
      />
      {/* Note: FollowupPipelinePage also exports an "agreements" entity
          (AgreementsPage) hitting /api/followup-agreements — same table
          the retired /followup/agreement/agreements page (Agreements.tsx)
          and /followup/agreement/workflow page used. Both of those routes
          were removed (0 live rows in either table, and CRM > Documents >
          Agreements is the real, actively-developed Agreement system) —
          not routing this embedded variant either, for the same reason. */}

      {/* MASTERS */}
      <Route
        path="/masters/contractors"
        element={
          <ProtectedRoute pageKey="contractor-master">
            <ContractorMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/suppliers"
        element={
          <ProtectedRoute pageKey="supplier-master">
            <SupplierMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/customers"
        element={
          <ProtectedRoute pageKey="customer-master">
            <CustomerMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/banks"
        element={
          <ProtectedRoute pageKey="bank-master">
            <BankMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/expenses"
        element={
          <ProtectedRoute pageKey="expenses-master">
            <ExpensesMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/items"
        element={
          <ProtectedRoute pageKey="item-master">
            <ItemMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/item-groups"
        element={
          <ProtectedRoute pageKey="item-group">
            <ItemGroupMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/hsn"
        element={
          <ProtectedRoute pageKey="hsn-master">
            <HsnMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/financial-year"
        element={
          <ProtectedRoute pageKey="financial-year-master">
            <FinancialYearMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/cheque"
        element={
          <ProtectedRoute pageKey="cheque-master">
            <ChequeMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material"
        element={
          <ProtectedRoute pageKey="material-dashboard">
            <MaterialDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/grn"
        element={
          <ProtectedRoute pageKey="grn-master">
            <GRN />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/vehicle-in-out"
        element={
          <ProtectedRoute pageKey="vehicle-in-out">
            <VehicleInOut />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/fixed-asset-record"
        element={
          <ProtectedRoute pageKey="fixed-asset-record">
            <FixedAssetRecord />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/short-close"
        element={
          <ProtectedRoute pageKey="short-close">
            <ShortClose />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/setup/depreciation"
        element={
          <ProtectedRoute pageKey="depreciation-setup">
            <DepreciationSetup />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/invoice"
        element={
          <ProtectedRoute pageKey="expense-booking">
            <MaterialExpenseBookingMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/expense-booking"
        element={<Navigate to="/finance/invoice" replace />}
      />
      <Route
        path="/material/debit-note"
        element={
          <ProtectedRoute pageKey="debit-note">
            <DebitNoteMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/boq"
        element={
          <ProtectedRoute pageKey="boq">
            <BOQ />
          </ProtectedRoute>
        }
      />

      <Route
        path="/material/work-order"
        element={
          <ProtectedRoute pageKey="work-order-master">
            <WorkOrderMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/amendments"
        element={
          <ProtectedRoute pageKey="amendments">
            <Amendments />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/amendment-menu"
        element={
          <ProtectedRoute pageKey="amendments">
            <AmendmentMenu />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/material-request"
        element={
          <ProtectedRoute pageKey="material-request">
            <MaterialRequestPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/issues"
        element={
          <ProtectedRoute pageKey="material-issues">
            <Issues />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/issue-return"
        element={
          <ProtectedRoute pageKey="material-issue-return">
            <IssueReturn />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/purchase-order"
        element={
          <ProtectedRoute pageKey="purchase-orders">
            <PurchaseOrderMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/quotation"
        element={
          <ProtectedRoute pageKey="quotation">
            <QuotationPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/l1-chart"
        element={
          <ProtectedRoute pageKey="l1-chart">
            <L1ChartPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/t-c-master"
        element={
          <ProtectedRoute pageKey="t-c-master">
            <TCMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/inventory-master"
        element={
          <ProtectedRoute pageKey="inventory-master">
            <InventoryMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/stock"
        element={
          <ProtectedRoute pageKey="stock-ledger">
            <Stock />
          </ProtectedRoute>
        }
      />
      <Route
        path="/material/stock-transfer"
        element={
          <ProtectedRoute pageKey="stock-transfers">
            <StockTransfer />
          </ProtectedRoute>
        }
      />

      {/* SALES */}
      <Route
        path="/sales"
        element={
          <ProtectedRoute pageKey="sales-dashboard">
            <SalesDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales/sale-order"
        element={
          <ProtectedRoute pageKey="sale-order">
            <SaleOrder />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales/sale-invoice"
        element={
          <ProtectedRoute pageKey="sale-invoice">
            <SaleInvoice />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales/payment"
        element={
          <ProtectedRoute pageKey="sales-payment">
            <SalesPayment />
          </ProtectedRoute>
        }
      />

      {/* ENGINEERING */}
      <Route
        path="/engineering"
        element={
          <ProtectedRoute pageKey="engineering-dashboard">
            <EngineeringDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ticket"
        element={
          <ProtectedRoute pageKey="ticket-dashboard">
            <TicketDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/ticket/create"
        element={
          <ProtectedRoute pageKey="tickets">
            <CreateTicket />
          </ProtectedRoute>
        }
      />

      <Route
        path="/ticket/my-tickets"
        element={
          <ProtectedRoute pageKey="tickets">
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
          <ProtectedRoute pageKey="tickets">
            <ResolvedTickets />
          </ProtectedRoute>
        }
      />
      <Route
        path="/engineering/work-done"
        element={
          <ProtectedRoute pageKey="work-done">
            <WorkDone />
          </ProtectedRoute>
        }
      />
      {/* Engineering-namespaced aliases so the module stays on Engineering */}
      <Route
        path="/engineering/work-order"
        element={
          <ProtectedRoute pageKey="engineering-work-order">
            <WorkOrderMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/engineering/boq"
        element={
          <ProtectedRoute pageKey="boq">
            <BOQ />
          </ProtectedRoute>
        }
      />
      <Route
        path="/engineering/dpr"
        element={
          <ProtectedRoute pageKey="dpr">
            <DailyProgressReport />
          </ProtectedRoute>
        }
      />
      <Route
        path="/engineering/amendment-menu"
        element={
          <ProtectedRoute pageKey="engineering-amendment-menu">
            <EngineeringAmendmentMenu />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/card"
        element={
          <ProtectedRoute pageKey="card-master">
            <CardMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/tds"
        element={
          <ProtectedRoute pageKey="tds-master">
            <TdsMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/account-group"
        element={
          <ProtectedRoute pageKey="account-group">
            <AccountGroupMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/named-entry-type"
        element={
          <ProtectedRoute pageKey="named-entry-type">
            <NamedEntryTypeMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/type-of-doc"
        element={
          <ProtectedRoute pageKey="type-of-doc">
            <TypeOfDocMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/activity"
        element={
          <ProtectedRoute pageKey="activity-master">
            <ActivityMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/general-ledger"
        element={
          <ProtectedRoute pageKey="general-ledger">
            <GeneralLedgerMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/cost-center"
        element={
          <ProtectedRoute pageKey="cost-center">
            <CostCenterMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/profit-center"
        element={
          <ProtectedRoute pageKey="profit-center">
            <ProfitCenterMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/return-reason"
        element={
          <ProtectedRoute pageKey="return-reason-master">
            <ReturnReasonMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/payment-reason"
        element={
          <ProtectedRoute pageKey="payment-reason-master">
            <PaymentReasonMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/debit-note"
        element={
          <ProtectedRoute pageKey="debit-note">
            <DebitNoteMaster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/billing-terms"
        element={
          <ProtectedRoute pageKey="billing-terms">
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
          <ProtectedRoute pageKey="business-unit-master">
            <EnterpriseMasterPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/masters/unit-measurement"
        element={
          <ProtectedRoute pageKey="unit-of-measurement">
            <UnitOfMeasurementMaster />
          </ProtectedRoute>
        }
      />

      {/* USER */}
      <Route
        path="/user/profile"
        element={
          <ProtectedRoute pageKey="user-profile">
            <UserProfilePage />
          </ProtectedRoute>
        }
      />

      {/* DBA CONSOLE */}
      {/* Static paths declared before the dynamic :userId? route below —
          this used to rely on React Router's path-ranking to disambiguate
          /dba/control-panel etc. from /dba/:userId?. Declaring statics
          first removes that dependency so route order can't silently
          break this if these routes are ever moved into a nested <Route>. */}
      <Route
        path="/dba/control-panel"
        element={
          <ProtectedRoute pageKey="dba-control-panel">
            <ControlPanel />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dba/ads"
        element={
          <ProtectedRoute pageKey="dba-ads">
            <AdsManager />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dba/reminders"
        element={
          <ProtectedRoute pageKey="dba-reminders">
            <RemindersManager />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dba/payment-logs"
        element={
          <ProtectedRoute pageKey="dba-payment-logs">
            <PaymentLogs />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dba/:userId?"
        element={
          <ProtectedRoute pageKey="dba-dashboard">
            <DBADashboard />
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
          <ApprovalInboxRoute>
            <ApprovalInbox />
          </ApprovalInboxRoute>
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

      {/* SUPPLIER HOME — requires auth (supplier sees their portal here) */}
      <Route
        path="/supplier"
        element={
          <RequireAuth>
            <SupplierLayout>
              <RouteErrorBoundary>
                <Suspense fallback={<PageSkeleton />}>
                  <SupplierLanding />
                </Suspense>
              </RouteErrorBoundary>
            </SupplierLayout>
          </RequireAuth>
        }
      />
      {/* SUPPLIER sub-pages — accessible to suppliers directly */}
      <Route
        path="/supplier/catalog"
        element={
          <RequireAuth>
            <SupplierLayout>
              <RouteErrorBoundary>
                <Suspense fallback={<PageSkeleton />}>
                  <SupplierCatalog />
                </Suspense>
              </RouteErrorBoundary>
            </SupplierLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/supplier/quotation/:qtId"
        element={
          <RequireAuth>
            <SupplierLayout>
              <RouteErrorBoundary>
                <Suspense fallback={<PageSkeleton />}>
                  <SupplierQuotationDetail />
                </Suspense>
              </RouteErrorBoundary>
            </SupplierLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/supplier/profile"
        element={
          <RequireAuth>
            <SupplierLayout>
              <RouteErrorBoundary>
                <Suspense fallback={<PageSkeleton />}>
                  <SupplierCompanyProfile />
                </Suspense>
              </RouteErrorBoundary>
            </SupplierLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/supplier/notifications"
        element={
          <RequireAuth>
            <SupplierLayout>
              <RouteErrorBoundary>
                <Suspense fallback={<PageSkeleton />}>
                  <SupplierNotifications />
                </Suspense>
              </RouteErrorBoundary>
            </SupplierLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/supplier/credit-notes"
        element={
          <RequireAuth>
            <SupplierLayout>
              <RouteErrorBoundary>
                <Suspense fallback={<PageSkeleton />}>
                  <SupplierCreditNotes />
                </Suspense>
              </RouteErrorBoundary>
            </SupplierLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/supplier-login"
        element={
          currentUser
            ? <Navigate to="/supplier" replace />
            : <Suspense fallback={<PageSkeleton />}><SupplierLogin /></Suspense>
        }
      />

      {/* SUPPLIER PORTAL — admin/super_admin monitoring view only */}
      <Route
        path="/supplier-portal/:userId?"
        element={
          <RequireAuth>
            <RequireRole allowed={["admin", "super_admin", "dba"]}>
              <SupplierLayout>
                <RouteErrorBoundary>
                  <Suspense fallback={<PageSkeleton />}>
                    <SupplierDashboard />
                  </Suspense>
                </RouteErrorBoundary>
              </SupplierLayout>
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/supplier-portal/:userId/quotation/:qtId"
        element={
          <RequireAuth>
            <RequireRole allowed={["admin", "super_admin", "dba"]}>
              <SupplierLayout>
                <RouteErrorBoundary>
                  <Suspense fallback={<PageSkeleton />}>
                    <SupplierQuotationDetail />
                  </Suspense>
                </RouteErrorBoundary>
              </SupplierLayout>
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/supplier-portal/:userId/catalog"
        element={
          <RequireAuth>
            <RequireRole allowed={["admin", "super_admin", "dba"]}>
              <SupplierLayout>
                <RouteErrorBoundary>
                  <Suspense fallback={<PageSkeleton />}>
                    <SupplierCatalog />
                  </Suspense>
                </RouteErrorBoundary>
              </SupplierLayout>
            </RequireRole>
          </RequireAuth>
        }
      />

      {/* MAINTENANCE & 404 */}
      <Route path="/maintenance" element={<Maintenance />} />
      <Route path="/sales-automation/social-media" element={<ProtectedRoute pageKey="sa-social-media"><SaSocialMediaMaster /></ProtectedRoute>} />
      <Route path="/sales-automation/campaigns" element={<ProtectedRoute pageKey="sa-campaigns"><SaCampaignMaster /></ProtectedRoute>} />
      <Route path="/sales-automation/ads" element={<ProtectedRoute pageKey="sa-ads"><SaAdMaster /></ProtectedRoute>} />
      <Route path="/sales-automation/leads" element={<ProtectedRoute pageKey="sa-leads"><SaLeadManagement /></ProtectedRoute>} />
      <Route path="/sales-automation/channel-partners" element={<ProtectedRoute pageKey="sa-channel-partners"><SaChannelPartners /></ProtectedRoute>} />
      <Route path="/sales-automation/lead-activities" element={<ProtectedRoute pageKey="sa-lead-activities"><SaLeadActivities /></ProtectedRoute>} />
      <Route path="/sales-automation/followups" element={<ProtectedRoute pageKey="sa-followups"><SaFollowups /></ProtectedRoute>} />
      <Route path="/sales-automation/lead-tasks" element={<ProtectedRoute pageKey="sa-lead-tasks"><SaLeadTasks /></ProtectedRoute>} />
      <Route path="/sales-automation/distribution" element={<ProtectedRoute pageKey="sa-lead-distribution"><SaLeadDistribution /></ProtectedRoute>} />
      <Route path="/sales-automation/inquiry" element={<ProtectedRoute pageKey="sa-inquiry"><SaInquiryDashboard /></ProtectedRoute>} />
      <Route path="/sales-automation/site-visits" element={<ProtectedRoute pageKey="sa-site-visits"><SaSiteVisits /></ProtectedRoute>} />
      <Route path="/sales-automation/invoices" element={<ProtectedRoute pageKey="sa-marketing-invoices"><SaMarketingInvoices /></ProtectedRoute>} />
      <Route path="/sales-automation/commissions" element={<ProtectedRoute pageKey="sa-commissions"><SaCommissions /></ProtectedRoute>} />
      <Route path="/sales-automation/dashboard/marketing" element={<ProtectedRoute pageKey="sa-campaigns"><SaMarketingDashboard /></ProtectedRoute>} />
      <Route path="/sales-automation/dashboard/sales" element={<ProtectedRoute pageKey="sa-leads"><SaSalesDashboard /></ProtectedRoute>} />
      <Route path="/sales-automation/dashboard/team-lead" element={<ProtectedRoute pageKey="sa-lead-distribution"><SaTeamLeadDashboard /></ProtectedRoute>} />
      <Route path="/sales-automation/reports" element={<ProtectedRoute pageKey="sa-reports"><SaReports /></ProtectedRoute>} />
      <Route path="/sales-automation/teams" element={<ProtectedRoute pageKey="sa-teams"><SaTeamManagement /></ProtectedRoute>} />
      <Route path="/sales-automation/lead-transfers" element={<ProtectedRoute pageKey="sa-lead-transfers"><SaLeadTransfers /></ProtectedRoute>} />
      <Route path="/sales-automation/distribution-rules" element={<ProtectedRoute pageKey="sa-distribution-rules"><SaDistributionRules /></ProtectedRoute>} />
      <Route path="/sales-automation/role-master" element={<ProtectedRoute pageKey="sa-role-master"><SaRoleMaster /></ProtectedRoute>} />
      {/* ── CRM Module ─────────────────────────────────────────────────────────── */}
      <Route path="/crm/customers"       element={<ProtectedRoute pageKey="crm-customers"><CrmCustomers /></ProtectedRoute>} />
      <Route path="/crm/applications"    element={<ProtectedRoute pageKey="crm-applications"><CrmApplication /></ProtectedRoute>} />
      <Route path="/crm/bookings"        element={<ProtectedRoute pageKey="crm-bookings"><CrmBooking /></ProtectedRoute>} />
      <Route path="/crm/welcome-calls"   element={<ProtectedRoute pageKey="crm-welcome-calls"><CrmWelcomeCall /></ProtectedRoute>} />
      <Route path="/crm/agreements"      element={<ProtectedRoute pageKey="crm-agreements"><CrmAgreement /></ProtectedRoute>} />
      <Route path="/crm/agreement-papers" element={<ProtectedRoute pageKey="crm-documents"><CrmAgreementPapers /></ProtectedRoute>} />
      <Route path="/crm/payments"         element={<ProtectedRoute pageKey="crm-payments"><CrmPaymentMilestones /></ProtectedRoute>} />
      <Route path="/crm/demands"          element={<ProtectedRoute pageKey="crm-payments"><CrmDemands /></ProtectedRoute>} />
      <Route path="/crm/handover"         element={<ProtectedRoute pageKey="crm-handover"><CrmHandover /></ProtectedRoute>} />
      <Route path="/crm/service-tickets"  element={<ProtectedRoute pageKey="crm-service-tickets"><CrmServiceTickets /></ProtectedRoute>} />
      <Route path="/crm/cancellations"    element={<ProtectedRoute pageKey="crm-cancellations"><CrmCancellations /></ProtectedRoute>} />
      <Route path="/crm/customer-360"     element={<ProtectedRoute pageKey="crm-customer-360"><CrmCustomer360 /></ProtectedRoute>} />
      <Route path="/crm/loan-details"     element={<ProtectedRoute pageKey="crm-loan-details"><CrmLoanTracking /></ProtectedRoute>} />
      <Route path="/crm/dashboard"             element={<ProtectedRoute pageKey="crm-dashboard"><CrmDashboard /></ProtectedRoute>} />
      <Route path="/crm/legal-milestones"      element={<ProtectedRoute pageKey="crm-legal-milestones"><CrmLegalMilestones /></ProtectedRoute>} />
      <Route path="/crm/noc"                   element={<ProtectedRoute pageKey="crm-noc"><CrmNoc /></ProtectedRoute>} />
      <Route path="/crm/sales-deed"            element={<ProtectedRoute pageKey="crm-sales-deed"><CrmSalesDeed /></ProtectedRoute>} />
      <Route path="/crm/pre-possession"        element={<ProtectedRoute pageKey="crm-pre-possession"><CrmPrePossession /></ProtectedRoute>} />
      <Route path="/crm/possession-notice"     element={<ProtectedRoute pageKey="crm-possession-notice"><CrmPossessionNotice /></ProtectedRoute>} />
      <Route path="/crm/construction-updates"  element={<ProtectedRoute pageKey="crm-construction-updates"><CrmConstructionUpdates /></ProtectedRoute>} />
      <Route path="/crm/communication"         element={<ProtectedRoute pageKey="crm-communication"><CrmCommunication /></ProtectedRoute>} />
      <Route path="/crm/customer-bank-details" element={<ProtectedRoute pageKey="crm-customer-bank-details"><CrmCustomerBankDetails /></ProtectedRoute>} />
      <Route path="/crm/unit-matrix"    element={<ProtectedRoute pageKey="crm-unit-matrix"><UnitMatrixPage /></ProtectedRoute>} />
      <Route path="/crm/parking-matrix" element={<ProtectedRoute pageKey="crm-parking-matrix"><ParkingMatrixPage /></ProtectedRoute>} />
      <Route path="/crm/brokerage"             element={<ProtectedRoute pageKey="crm-brokerage"><CrmBrokerage /></ProtectedRoute>} />
      <Route path="/crm/payment-plans"         element={<ProtectedRoute pageKey="crm-payment-plans"><CrmPaymentPlans /></ProtectedRoute>} />
      <Route path="/crm/setup/project-banks"   element={<ProtectedRoute pageKey="crm-project-banks"><CrmProjectBanks /></ProtectedRoute>} />
      {/* These masters are shared with the Follow-Up module (same
          component/data, same pageKey gating) — registered again under
          /crm/setup/* so the CRM Setup menu can link straight to them
          without the URL prefix flipping the whole app into Follow-Up
          chrome (ModuleContext derives activeModule from the path prefix;
          see the Setup-menu-to-CRM-module migration earlier in this
          project's history for the original version of this bug). */}
      <Route path="/crm/setup/unit-master"         element={<ProtectedRoute pageKey="followup-unit-master"><UnitMaster /></ProtectedRoute>} />
      <Route path="/crm/setup/block-master"        element={<ProtectedRoute pageKey="followup-block-master"><BlockMaster /></ProtectedRoute>} />
      <Route path="/crm/setup/room-master"         element={<ProtectedRoute pageKey="followup-room-master"><RoomMaster /></ProtectedRoute>} />
      <Route path="/crm/setup/parking-master"      element={<ProtectedRoute pageKey="followup-parking-master"><ParkingMaster /></ProtectedRoute>} />
      <Route path="/crm/setup/parking-slot-master" element={<ProtectedRoute pageKey="followup-parking-slot-master"><ParkingSlotMaster /></ProtectedRoute>} />
      <Route path="/crm/setup/extra-charge-master" element={<ProtectedRoute pageKey="followup-extra-charge-master"><ExtraChargeMaster /></ProtectedRoute>} />
      <Route path="/crm/setup/pending-tasks"       element={<ProtectedRoute pageKey="followup-pending-tasks"><PendingTasksPage /></ProtectedRoute>} />
      <Route path="/crm/setup/reminders"           element={<ProtectedRoute pageKey="followup-reminders"><FollowupReminders /></ProtectedRoute>} />
      <Route path="/crm/milestone-master"      element={<ProtectedRoute pageKey="crm-milestone-master"><CrmMilestoneMaster /></ProtectedRoute>} />
      <Route path="/masters/brokers"           element={<ProtectedRoute pageKey="broker-master"><CrmBrokerMaster /></ProtectedRoute>} />
      <Route path="/crm/broker-payments"       element={<ProtectedRoute pageKey="crm-brokerage"><CrmBrokerPayments /></ProtectedRoute>} />
      <Route path="/crm/parking-booking"       element={<ProtectedRoute pageKey="crm-parking-booking"><CrmParkingBookingPage /></ProtectedRoute>} />
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
      <Toaster richColors position="top-right" closeButton />
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
                  <AppRoutes />
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