// The Approval Inbox's module catalogue (what each approval type is, where it lives, who approves it)
// and the small helpers the inbox and the review panel share.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { computeGrnNetWithTerms } from "@/pages/material/ExpenseBooking/helpers";
import { ClipboardCheck, ClipboardList, Package, PackageOpen, Hammer, Banknote, Truck, Receipt, ArrowDownCircle, XCircle, ArrowLeftRight, Warehouse, ShoppingCart, Building2, Home, Car, Eye, FileText, Landmark, UserCheck, FileWarning, Undo2, ShieldCheck } from "lucide-react";
import { type ApprovalTable } from "@/components/ApprovalStatusChain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InboxItem {
  Module: string;
  ModuleLabel: string;
  RecordId: string;
  Reference: string | null;
  RecordDate: string | null;
  Status: string;
  ContractorName: string | null;
  SupplierName: string | null;
  // Resolved project name where that module's table (or one it already
  // joins) ties to a project — purchase-orders, work-orders, goods-receipt,
  // expense-booking, material-requests, vehicle-in-out, material-issues,
  // material-issue-return, debit-note. NULL for everything else (payments,
  // CRM modules, ...), which have no single project to show.
  ProjectName: string | null;
  Amount: number | null;
  CreatedBy: string | null;
  ApprovedBy: string | null;
  ApprovedAt: string | null;
  RejectedBy: string | null;
  RejectionNote: string | null;
  LastModified: string | null;
  // received-payment only: a CRM payment still waiting for Accounts to set
  // its deposit bank — can't be approved yet, so the row shows "Review".
  NeedsReview?: boolean | number | null;
  // expense-booking only — null for all other modules
  GrnTotalAmount: number | null;
  GrnBasicAmount: number | null;
  BillingTermsData: string | null;
  // goods-receipt (transfer GRNs) — null for non-transfer GRNs
  SourceTransferDocNo: string | null;
  FromGodownName: string | null;
  ToGodownName: string | null;
  // journal-voucher only — "AccountHead Dr/Cr Amount | AccountHead Dr/Cr Amount"
  // for every line on the voucher, null for all other modules.
  JournalVoucherSummary: string | null;
  // work-allocation-engineer only — the specific engineer this row's task
  // confirmation belongs to; null for every other module.
  AssigneeUserId: number | null;
  // work-allocation-engineer only — DependencyMasterActivity.Id (the
  // "rung"), used to fetch the full assignment detail (engineers, days,
  // materials, checkpoints) via GET /api/dependency-activity-assignment/:rungId
  // — RecordId itself is the DependencyActivityEngineer row (per-engineer,
  // needed for the confirm action) and doesn't work as a lookup key there.
  RungId: number | null;
  // civilworkdpr-approval only — the activity's name, shown where other modules show an amount.
  ActivityName?: string | null;
  // Set by the backend's visibility filter (approvalInbox.js) only when the
  // viewer is named somewhere on this record's workflow but NOT on the
  // level it's currently sitting at — e.g. a Level-2 approver looking at a
  // record still waiting on Level 1. It's shown for awareness (so the inbox
  // doesn't look like it's missing records), but Approve/Reject will
  // correctly be refused by the backend until it actually reaches their
  // level. Omitted entirely (undefined) for every normal, actionable row.
  _canAct?: boolean;
  _currentLevel?: number;
  _totalLevels?: number;
}

// ─── Module config ────────────────────────────────────────────────────────────

export const MODULE_CONFIG: Record<
  string,
  {
    icon: React.ElementType;
    color: string;
    navPath: string;
    apiEndpoint: string;
    label: string;
  }
> = {
  "purchase-orders": {
    icon: Package,
    color: "text-blue-500 bg-blue-500/10",
    navPath: "/material/purchase-order",
    apiEndpoint: "/api/purchase-orders",
    label: "Purchase Orders",
  },
  "work-orders": {
    icon: Hammer,
    color: "text-amber-500 bg-[#ffe2021a]",
    navPath: "/material/work-order",
    apiEndpoint: "/api/work-orders",
    label: "Work Orders",
  },
  payments: {
    icon: Banknote,
    color: "text-emerald-500 bg-emerald-500/10",
    navPath: "/payments",
    apiEndpoint: "/api/new-payment",
    label: "Payments",
  },
  // A CRM Refund's payout voucher — same table/route as "payments" above,
  // just its own Module tag so it resolves its own single-level workflow
  // (see approvalInbox.js's query split and approvalService.js's
  // "crm-refund-payment" module) instead of the multi-module Payments
  // bundle every other payment goes through.
  "crm-refund-payment": {
    icon: Banknote,
    color: "text-orange-600 bg-orange-600/10",
    navPath: "/payments",
    apiEndpoint: "/api/new-payment",
    label: "Refund payment",
  },
  "goods-receipt": {
    icon: Truck,
    color: "text-violet-500 bg-violet-500/10",
    navPath: "/material/grn",
    apiEndpoint: "/api/grns",
    label: "GRNs",
  },
  "expense-booking": {
    icon: Receipt,
    color: "text-rose-500 bg-rose-500/10",
    navPath: "/material/expense-booking",
    apiEndpoint: "/api/expense-booking",
    label: "Invoices",
  },
  "received-payment": {
    icon: ArrowDownCircle,
    color: "text-teal-500 bg-teal-500/10",
    navPath: "/received-payments",
    apiEndpoint: "/api/received-payment",
    label: "Received Payments",
  },
  "work-done": {
    icon: Hammer,
    color: "text-emerald-500 bg-emerald-500/10",
    navPath: "/engineering/work-done",
    apiEndpoint: "/api/engineering/work-done",
    label: "Work Done",
  },
  boq: {
    icon: ClipboardCheck,
    color: "text-indigo-500 bg-indigo-500/10",
    navPath: "/engineering/boq",
    apiEndpoint: "/api/boq",
    label: "BOQ",
  },
  "material-requests": {
    icon: ClipboardList,
    color: "text-orange-500 bg-orange-500/10",
    navPath: "/material/material-request",
    apiEndpoint: "/api/material-requests",
    label: "Material Requests",
  },
  "material-issues": {
    icon: PackageOpen,
    color: "text-cyan-500 bg-cyan-500/10",
    navPath: "/material/issues",
    apiEndpoint: "/api/material-issues",
    label: "Material Issues",
  },
  "material-issue-return": {
    icon: Undo2,
    color: "text-lime-500 bg-lime-500/10",
    navPath: "/material/issue-return",
    apiEndpoint: "/api/material-issue-return",
    label: "Material Issue Returns",
  },
  "sale-orders": {
    icon: ShoppingCart,
    color: "text-fuchsia-500 bg-fuchsia-500/10",
    navPath: "/sales/sale-order",
    apiEndpoint: "/api/sale-orders",
    label: "Sale Orders",
  },
  "vehicle-in-out": {
    icon: Car,
    color: "text-sky-500 bg-sky-500/10",
    navPath: "/material/vehicle-in-out",
    apiEndpoint: "/api/vehicle-in-out",
    label: "Vehicle In/Out",
  },
  "stock-transfers": {
    icon: Warehouse,
    color: "text-teal-500 bg-teal-500/10",
    navPath: "/material/stock-transfer",
    apiEndpoint: "/api/stock-transfers",
    label: "Stock Transfer",
  },
  "journal-voucher": {
    icon: Receipt,
    color: "text-amber-600 bg-amber-600/10",
    navPath: "/journal-voucher",
    apiEndpoint: "/api/journal-voucher",
    label: "Journal Vouchers",
  },
  "inter-company-transfer": {
    icon: ArrowLeftRight,
    color: "text-fuchsia-600 bg-fuchsia-600/10",
    navPath: "/material/stock-transfer",
    apiEndpoint: "/api/inter-company-transfer",
    label: "Inter-Company Transfers",
  },
  "fund-transfer": {
    icon: Landmark,
    color: "text-violet-600 bg-violet-600/10",
    navPath: "/fund-transfer",
    apiEndpoint: "/api/fund-transfer",
    label: "Fund Transfers",
  },
  // One specific engineer confirming a task literally assigned to them —
  // not a document a manager reviews. isVisibleToViewer (approvalInbox.js)
  // only ever shows this to the named EngineerId (or admin/super_admin),
  // and its Approve action is a bespoke confirm call (see InboxRow below),
  // not the shared ApprovalActions role/workflow machinery.
  "work-allocation-engineer": {
    icon: UserCheck,
    color: "text-cyan-600 bg-cyan-600/10",
    navPath: "/civilworkdpr/work-done",
    apiEndpoint: "/api/dependency-activity-assignment",
    label: "Activity Assignments",
  },
  // crm-applications deliberately has no entry here anymore — Applications
  // no longer have their own approve/reject cycle (see approvalInbox.js's
  // aggregator query, and crmApplications.js), so the backend never emits a
  // crm-applications row for this inbox to render in the first place.
  //
  // crm-bookings' navPath opens the real Booking detail dialog (CrmBooking.tsx
  // /CrmBookingDetail.tsx) via its existing "?view=" deep link — the merged
  // Data Review checklist + Marketing Head/Director approve-reject UI all
  // live there now, not on a separate dedicated screen.
  "crm-bookings": {
    icon: Home,
    color: "text-orange-500 bg-orange-500/10",
    navPath: "/crm/bookings",
    apiEndpoint: "/api/crm/bookings",
    label: "CRM Bookings",
  },
  "crm-agreements": {
    icon: Building2,
    color: "text-indigo-500 bg-indigo-500/10",
    navPath: "/crm/agreements",
    apiEndpoint: "/api/crm/agreements",
    label: "CRM Agreements",
  },
  "crm-agreement-date": {
    icon: ClipboardList,
    color: "text-indigo-500 bg-indigo-500/10",
    navPath: "/crm/agreements",
    apiEndpoint: "/api/crm/agreements",
    label: "CRM Agreement Date",
  },
  "crm-sales-deed-director": {
    icon: Building2,
    color: "text-purple-500 bg-purple-500/10",
    navPath: "/crm/sales-deed",
    apiEndpoint: "/api/crm/sales-deed",
    label: "CRM Sales Deed (Director)",
  },
  "crm-brokerage": {
    icon: Receipt,
    color: "text-amber-500 bg-[#ffe2021a]",
    navPath: "/crm/brokerage",
    apiEndpoint: "/api/crm/brokerage",
    label: "CRM Brokerage",
  },
  "crm-cancellations": {
    icon: XCircle,
    color: "text-rose-500 bg-rose-500/10",
    navPath: "/crm/cancellations",
    apiEndpoint: "/api/crm/cancellations",
    label: "CRM Cancellations",
  },
  "crm-money-receipts": {
    icon: Receipt,
    color: "text-teal-600 bg-teal-600/10",
    navPath: "/crm/money-receipts",
    apiEndpoint: "/api/crm/money-receipts",
    label: "CRM Money Receipts",
  },
  "crm-noc": {
    icon: ClipboardCheck,
    color: "text-teal-500 bg-teal-500/10",
    navPath: "/crm/noc",
    apiEndpoint: "/api/crm/noc",
    label: "CRM NOC",
  },
  "crm-booking-amendment": {
    icon: Car,
    color: "text-amber-500 bg-[#ffe2021a]",
    navPath: "/crm/booking-amendments",
    apiEndpoint: "/api/crm/booking-amendments",
    label: "Booking Amendments",
  },
  // Was missing entirely — CrmRefund already had a real Pending/Approve/
  // Reject cycle, but with no entry here it never surfaced in the
  // centralized inbox, only via CrmRefunds.tsx's own inline actions —
  // inconsistent with every sibling CRM module (cancellations, agreements,
  // brokerage, NOC, booking amendments), which all appear in both places.
  "crm-transfer-deeds": {
    icon: ClipboardList,
    color: "text-teal-600 bg-teal-600/10",
    navPath: "/crm/transfer-deeds",
    apiEndpoint: "/api/crm/transfer-deeds",
    label: "Transfer Deed (Legal Head)",
  },
  "crm-transfer-deed-date": {
    icon: ClipboardList,
    color: "text-teal-600 bg-teal-600/10",
    navPath: "/crm/transfer-deeds",
    apiEndpoint: "/api/crm/transfer-deeds",
    label: "Transfer Deed (Date)",
  },
  "crm-resales": {
    icon: Undo2,
    color: "text-teal-600 bg-teal-600/10",
    navPath: "/crm/resales",
    apiEndpoint: "/api/crm/resales",
    label: "Property Resale & Buy-back",
  },
  "crm-credit-notes": {
    icon: Undo2,
    color: "text-orange-600 bg-orange-600/10",
    navPath: "/crm/credit-notes",
    apiEndpoint: "/api/crm/refunds/gst-notes",
    label: "Credit Note",
  },
  "crm-credit-note-cancel": {
    icon: Undo2,
    color: "text-red-600 bg-red-600/10",
    navPath: "/crm/credit-notes",
    apiEndpoint: "/api/crm/refunds/gst-notes/cancel-requests",
    label: "Credit Note (cancel)",
  },
  "crm-ownership-changes": {
    icon: Undo2,
    color: "text-teal-600 bg-teal-600/10",
    navPath: "/crm/ownership-changes",
    apiEndpoint: "/api/crm/ownership-changes",
    label: "Ownership Change",
  },
  "crm-refunds": {
    icon: Undo2,
    color: "text-orange-600 bg-orange-600/10",
    navPath: "/crm/refunds",
    apiEndpoint: "/api/crm/refunds",
    label: "CRM Refunds",
  },
  // Second, separate approval tier (Finance's own sign-off, distinct from
  // the CRM checker step above) — same split as crm-agreement-date vs.
  // crm-agreements. Its /:id/finance-approve route needs a company-bank
  // pick the inbox can't collect inline, so Approve always hands off to the
  // real page (see REVIEW_INSTEAD_LABEL below); Reject needs no extra input
  // and works as a normal one-click via the /finance/reject alias route.
  "crm-refunds-finance": {
    icon: Undo2,
    color: "text-orange-700 bg-orange-700/10",
    navPath: "/crm/refunds",
    apiEndpoint: "/api/crm/refunds",
    label: "CRM Refunds (Finance)",
  },
  // Was missing entirely — without this, ApprovalActions fell back to
  // `/api/${item.Module}` = "/api/contracts" (plural), a 404: the route is
  // mounted at "/api/contract" (singular). Approve/Reject on Contract rows
  // silently failed until this entry existed.
  contracts: {
    icon: FileText,
    color: "text-purple-500 bg-purple-500/10",
    navPath: "/finance/contracts",
    apiEndpoint: "/api/contract",
    label: "Contracts",
  },
  "debit-note": {
    icon: FileWarning,
    color: "text-rose-600 bg-rose-600/10",
    navPath: "/material/debit-note",
    apiEndpoint: "/api/debit-note",
    label: "Debit Notes",
  },
  // Civil Work DPR's per-assignment Approval Setup — a Completed, QC-passed
  // activity awaiting whichever levels were configured for it in Work
  // Allocation. Not a dbo.ApprovalWorkflows module (see approvalInbox.js's
  // own comment on this query block and isVisibleToViewer branch), so it's
  // deliberately not in RESTRICTED_MODULES' sibling role-list logic below —
  // it's added to RESTRICTED_MODULES itself instead, which makes button
  // visibility depend purely on _canAct (this activity's own named
  // approvers, computed server-side) rather than the generic
  // "approval-inbox edit" fallback.
  "civilworkdpr-approval": {
    icon: ShieldCheck,
    color: "text-cyan-600 bg-cyan-600/10",
    navPath: "/civilworkdpr/activity-reporting",
    apiEndpoint: "/api/dependency-activity-assignment",
    label: "Activity Approvals",
  },
};

// Module → ApprovalAuditLog TableName, only for modules the backend's
// /api/approval-workflows/trail endpoint actually recognises (see
// MODULE_TABLE_MAP in backend/routes/approvalWorkflows.js). Modules not
// listed here (journal-voucher, inter-company-transfer, received-payment,
// crm-*) simply don't render the chain badge in the preview modal.
export const MODULE_APPROVAL_TABLE: Record<string, ApprovalTable> = {
  "goods-receipt": "GoodsReceiptNotes",
  "purchase-orders": "PurchaseOrders",
  "work-orders": "WorkOrderHeader",
  "expense-booking": "ExpenseBooking",
  payments: "NewPayment",
  "crm-refund-payment": "NewPayment",
  "material-issues": "MaterialIssues",
  "material-issue-return": "MaterialIssueReturn",
  "material-requests": "MaterialRequests",
  boq: "BOQ",
  "work-done": "WorkDone",
  "sale-orders": "SaleOrders",
  "vehicle-in-out": "VehicleInOut",
  "stock-transfers": "StockTransfers",
  contracts: "Contract",
};

// Every CRM approval module is gated to admin/super_admin/marketing_head —
// dba is deliberately excluded, unlike the system-default APPROVER_ROLES.
export const CRM_MODULES = new Set(["crm-bookings", "crm-agreements", "crm-brokerage", "crm-cancellations", "crm-noc"]);
export const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];
export const MR_APPROVER_ROLES = ["admin", "super_admin", "dba", "accounts_head"];
export const CRM_BOOKING_APPROVER_ROLES = ["admin", "super_admin", "marketing_head", "director"];
// Agreement Date and Sales Deed Director approval are narrower, separate
// gates — super_admin only, "for now" per instruction, unlike the rest of
// the CRM modules above. The backend enforces this independently via
// approvalService's MODULE_APPROVER_ROLE_OVERRIDES; this only controls
// button visibility (and which /:id/<suffix>/approve path gets hit) here.
export const DATE_APPROVER_ROLES = ["super_admin"];
export const SUB_GATE_SUFFIX: Record<string, string> = { "crm-transfer-deeds": "legal", "crm-transfer-deed-date": "date", "crm-agreement-date": "date", "crm-sales-deed-director": "director", "crm-refunds-finance": "finance" };
export const REFUND_FINANCE_APPROVER_ROLES = ["accounts_head", "finance_head", "admin", "super_admin"];
export const SUB_GATE_MODULES = new Set(Object.keys(SUB_GATE_SUFFIX));

// Modules the backend keeps deliberately role-locked (see
// MODULE_APPROVER_ROLE_OVERRIDES in approvalService.js) — the
// "approval-inbox" page-right fallback must not open these.
export const RESTRICTED_MODULES = new Set([
  "journal-voucher",
  "inter-company-transfer",
  "fund-transfer",
  "crm-money-receipts",
  "crm-refund-payment",
  // Gates Approve/Reject to exactly this activity's own named approvers
  // (server-computed _canAct) — the generic "approval-inbox edit" fallback
  // must not open these, since that right has nothing to do with who's
  // actually named in this one activity's Approval Setup.
  "civilworkdpr-approval",
  ...SUB_GATE_MODULES,
]);

export const ALL_MODULES = Object.keys(MODULE_CONFIG);

// ─── Category grouping ────────────────────────────────────────────────────────
// Every module bucketed under the business function it belongs to — MR/PO/GRN/
// Material Issues etc. all read as "Material", Payments/JV/Fund Transfer as
// "Finance", and so on — so the inbox groups like-with-like instead of one
// long flat module list.
export type CategoryId = "material" | "finance" | "engineering" | "civilworkdpr" | "sales" | "admin";

export const CATEGORY_META: Record<CategoryId, { label: string; color: string }> = {
  material: { label: "Material", color: "text-cyan-600" },
  finance: { label: "Finance", color: "text-emerald-600" },
  engineering: { label: "Engineering", color: "text-indigo-600" },
  civilworkdpr: { label: "Civil Work DPR", color: "text-cyan-600" },
  sales: { label: "Sales / CRM", color: "text-orange-600" },
  admin: { label: "Admin", color: "text-purple-600" },
};

export const CATEGORY_ORDER: CategoryId[] = ["material", "finance", "engineering", "civilworkdpr", "sales", "admin"];

export const MODULE_CATEGORY: Record<string, CategoryId> = {
  "material-requests": "material",
  "purchase-orders": "material",
  "work-orders": "material",
  "goods-receipt": "material",
  "material-issues": "material",
  "material-issue-return": "material",
  "vehicle-in-out": "material",
  "stock-transfers": "material",
  "inter-company-transfer": "material",
  "debit-note": "material",

  "expense-booking": "finance",
  payments: "finance",
  "crm-refund-payment": "finance",
  "received-payment": "finance",
  "journal-voucher": "finance",
  "fund-transfer": "finance",
  contracts: "finance",

  "work-done": "engineering",
  boq: "engineering",

  // Civil Work DPR: an activity's final approval (and the engineer confirmations that used to come here).
  "civilworkdpr-approval": "civilworkdpr",
  "work-allocation-engineer": "civilworkdpr",

  "sale-orders": "sales",
  "crm-bookings": "sales",
  "crm-agreements": "sales",
  "crm-agreement-date": "sales",
  "crm-sales-deed-director": "sales",
  "crm-brokerage": "sales",
  "crm-cancellations": "sales",
  "crm-money-receipts": "sales",
  "crm-noc": "sales",
  "crm-booking-amendment": "sales",
  "crm-refunds": "sales",
  "crm-resales": "sales",
  "crm-transfer-deeds": "sales",
  "crm-transfer-deed-date": "sales",
  "crm-ownership-changes": "sales",
  "crm-credit-notes": "sales",
  "crm-credit-note-cancel": "sales",
};

export const categoryOf = (mod: string): CategoryId => MODULE_CATEGORY[mod] ?? "admin";
// Modules listed inside another module's group in the inbox.
export const DISPLAY_GROUP: Record<string, string> = { "crm-refund-payment": "payments" };

// Within a category, MODULE_CATEGORY's own declaration order above doubles
// as the module display order — e.g. Material Requests before Purchase
// Orders before GRNs — so every module's rows stay contiguous instead of
// interleaving with other modules in the same category by date.
export const MODULE_ORDER: Record<string, number> = Object.fromEntries(
  Object.keys(MODULE_CATEGORY).map((mod, i) => [mod, i]),
);
export const moduleOrderOf = (mod: string): number => MODULE_ORDER[mod] ?? Number.MAX_SAFE_INTEGER;

// A CRM Received Payment Accounts hasn't assigned a deposit bank to yet.
export const needsBankReview = (item: Pick<InboxItem, "Module" | "Status" | "NeedsReview">) =>
  item.Module === "received-payment" && item.Status === "Pending" && !!item.NeedsReview;

// Modules whose one-click Approve is either guaranteed to fail without a
// review step first (crm-bookings' Data Review checklist gate) or whose
// approved amount is only ever editable before approval (crm-brokerage) —
// see the reviewInstead comment below for the full reasoning per module.
export const REVIEW_INSTEAD_LABEL: Record<string, string> = {
  "crm-bookings": "Open Booking",
  "crm-brokerage": "Review & Approve",
  // finance-approve needs a company-bank pick (RefundBankLHeadId) the inbox
  // has no field for — hands off to CrmRefunds.tsx's own Finance Approve
  // dialog instead of a one-click that would 400 whenever no bank is
  // already set on the refund.
  "crm-refunds-finance": "Finance Approve",
};

// Modules whose page already supports a "?view=<RecordId>" deep link that
// auto-opens that exact record's own preview/view modal on load (see the
// `searchParams.get("view")` effect in each page). Modules not listed here
// have no such modal yet, so we fall back to a bare navigate.
export const VIEW_PARAM_MODULES = new Set([
  "received-payment",
  "purchase-orders",
  "goods-receipt",
  "expense-booking",
  "payments",
  "crm-refund-payment",
  "vehicle-in-out",
  "material-requests",
  "crm-brokerage",
]);

// Builds the URL to open a given inbox item directly in its module's own
// preview mode, instead of dumping the user on a blank list page to hunt
// for the record themselves.
export function openInModulePath(item: InboxItem, navPath: string): string {
  // Guard: a 0 or null RecordId produces ?view=0 which leaves a stuck URL
  // on the destination page (the panel never opens but the URL never clears).
  // Fall back to the plain list page when the id is invalid.
  const hasValidId = parseInt(String(item.RecordId), 10) > 0;

  // crm-bookings' navPath (/crm/bookings) opens the real Booking detail
  // dialog via its existing "?view=" deep link — same convention
  // VIEW_PARAM_MODULES below uses, just listed explicitly here since it's
  // CRM-specific rather than shared with the generic modules.
  if (item.Module === "crm-bookings") {
    return hasValidId ? `${navPath}?view=${item.RecordId}` : navPath;
  }
  // crm-agreements/crm-agreement-date use "?id=" (opens the read-only detail
  // dialog directly via CrmApplication.tsx-style searchParams.get("id") effects).
  if (item.Module === "crm-transfer-deeds" || item.Module === "crm-transfer-deed-date") {
    return hasValidId ? `${navPath}?id=${item.RecordId}&tab=${encodeURIComponent("Legal & Approval")}` : navPath;
  }
  if (item.Module === "crm-credit-notes" || item.Module === "crm-credit-note-cancel") {
    return hasValidId ? `${navPath}?id=${item.RecordId}` : navPath;
  }
  if (item.Module === "crm-ownership-changes") {
    return hasValidId ? `${navPath}?id=${item.RecordId}` : navPath;
  }
  if (item.Module === "crm-agreements" || item.Module === "crm-agreement-date") {
    return hasValidId ? `${navPath}?id=${item.RecordId}` : navPath;
  }
  if (VIEW_PARAM_MODULES.has(item.Module)) {
    return hasValidId ? `${navPath}?view=${item.RecordId}` : navPath;
  }
  return navPath;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const fetchInbox = async (): Promise<InboxItem[]> => {
  const res = await fetchWithAuth("/api/approval-inbox");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? "Failed to fetch approval inbox");
  }
  return res.json().catch(() => []);
};

export const fmtDate = (d: string | null) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

export const fmtAmount = (n: number | null) => {
  if (n == null) return "—";
  return formatINR(n, { decimals: 2 });
};

/**
 * For expense-booking rows, if the record is GRN-linked, compute net payable
 * by applying billing terms on top of the live GRN total — same logic as the
 * Expense Booking list page and preview modal.  Falls back to stored Amount for
 * all other modules or non-GRN expense bookings.
 */
export function getEffectiveAmount(item: InboxItem): number | null {
  if (
    item.Module === "expense-booking" &&
    item.GrnTotalAmount != null &&
    item.GrnTotalAmount > 0
  ) {
    let terms: any[] = [];
    try {
      if (item.BillingTermsData) {
        let parsed = JSON.parse(item.BillingTermsData);
        if (typeof parsed === "string") parsed = JSON.parse(parsed);
        if (Array.isArray(parsed)) terms = parsed;
      }
    } catch {
      /* ignore malformed JSON */
    }
    return computeGrnNetWithTerms(
      item.GrnTotalAmount,
      terms,
      item.GrnBasicAmount ?? undefined,
    );
  }
  return item.Amount;
}

// ─── Module filter tab ────────────────────────────────────────────────────────

// Each module keeps a single identity color, used only as a small accent
// (icon + count badge) when inactive, and as the solid fill once selected —
// avoids the "wall of pastel pills" look of having every tab fully colored
// all the time.
// Left-rail accent border colour per module (tailwind border-* class)
export const MODULE_ACCENT_BORDER: Record<string, string> = {
  "purchase-orders":      "border-blue-500",
  "work-orders":          "border-amber-500",
  payments:               "border-emerald-500",
  "goods-receipt":        "border-violet-500",
  "expense-booking":      "border-rose-500",
  "received-payment":     "border-teal-500",
  "work-done":            "border-emerald-600",
  boq:                    "border-indigo-500",
  "material-requests":    "border-orange-500",
  "material-issues":      "border-cyan-500",
  "sale-orders":          "border-fuchsia-500",
  "vehicle-in-out":       "border-sky-500",
  "stock-transfers":      "border-teal-500",
  "journal-voucher":      "border-amber-600",
  "inter-company-transfer":"border-fuchsia-600",
  "fund-transfer":        "border-violet-600",
  "crm-money-receipts":   "border-teal-600",
  contracts:              "border-purple-500",
  "crm-bookings":         "border-orange-500",
  "crm-agreements":       "border-indigo-500",
  "crm-agreement-date":   "border-indigo-400",
  "crm-sales-deed-director":"border-purple-500",
  "crm-brokerage":        "border-amber-500",
  "crm-cancellations":    "border-rose-500",
  "crm-noc":              "border-teal-500",
  "crm-refunds":          "border-orange-600",
  "crm-refunds-finance":  "border-orange-700",
};

// ─── Detail preview modal ───────────────────────────────────────────────────
// Fetches the record's own detail endpoint (same GET /:id convention every
// module page already uses, e.g. getPurchaseOrderById) so the popup shows
// every field, not just the handful summarised on the inbox row — same
// interaction pattern as the Eye/"View details" preview used on PO, GRN,
// Material Request, etc. Falls back to the inbox row's own summary fields
// if the detail fetch fails, so the popup never comes up empty.

// Keys hidden from the generic "Full Record" dump: already surfaced in the
// header/summary grid above it, or too internal/raw to be worth a row.
// Matched after stripDbPrefix() strips each module's column-prefix
// convention, so "companyid" here also catches "ECompanyId".
export const PREVIEW_HIDDEN_KEYS = new Set([
  "id", "_id", "attachments", "parties", "lineitems", "items", "poitems",
  "billingtermsdata", "termsandconditions", "createdat", "updatedat",
  "approvedat", "rejectedat", "docnumber", "belongsto",
  // *By fields carry a raw numeric user id, not a name — the summary grid
  // above already shows the resolved Created/Approved/Rejected By names.
  "createdby", "updatedby", "approvedby", "rejectedby",
  // ProjectName in several modules actually stores the project's numeric
  // enterprise id (legacy column reuse), not a readable name — the
  // resolved sibling (ProjectDisplayName, ProjectName from a join, ...)
  // covers this instead.
  "projectname",
]);

// Most modules prefix every one of their own columns with a single
// module-specific letter (ExpenseBooking: EName, ECompanyId, ECreatedAt, ...)
// which defeats both the hidden-key match above and plain-English labels.
// Strip a single leading capital letter when it's immediately followed by
// another capital letter (i.e. it's a prefix, not the start of a real word).
export function stripDbPrefix(key: string): string {
  return key.replace(/^[A-Z](?=[A-Z])/, "");
}

// Every module names its foreign keys differently (ECompanyId, SupplierID,
// ContractorId, LHeadId, PurchaseOrderID, ...) so a fixed key list above
// can never keep up. Any field whose name ends in "Id" is a raw internal
// reference, not something a reviewer can read — hide it here and let its
// resolved sibling (CompanyName, SupplierName, ProjectName, ...), which the
// record's own GET /:id endpoint already returns, show through instead.
export function isIdField(key: string): boolean {
  return /id$/i.test(key);
}

// Serialized JSON blobs (billing terms, EMI config, discount config, ...)
// read as noise dumped raw — hide any string value that's actually JSON
// rather than trying to name every such column across every module.
// Some columns (EMI data) come back double-encoded — a JSON string whose
// own contents are themselves JSON, e.g. "{\"enabled\":false,...}" — which
// starts with a literal `"` rather than `{`, so a plain prefix/suffix check
// misses it and the escaped raw text leaks into the preview. Try parsing
// instead: valid JSON that parses to an object/array is a blob regardless
// of how many times it was encoded.
export function isJsonBlob(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  try {
    let parsed = JSON.parse(s);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

export function labelizeKey(key: string): string {
  return stripDbPrefix(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// PO/GRN/etc. detail endpoints return their line items as an array under
// one of these keys (LineItems is the normalized-form convention most
// modules now use — see purchaseOrders.js's GET /:id — POItems/Items cover
// older/other modules' naming). Rendered as a real per-item table below
// instead of the generic "N items" collapse formatPreviewValue gives any
// other array, so a reviewer approving a PO actually sees what's on it.
export function extractLineItems(detail: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!detail) return [];
  // "items" (lowercase) covers Material Requests' own GET /:id response
  // (materialRequests.js: `{ ...header, items: [...] }`) — missing it meant
  // the review panel's line-items table silently never rendered for MRs at
  // all, even though the data was right there in `detail`.
  // "lines" (lowercase) covers Journal Vouchers' own GET /:id response
  // (journalVoucher.js: `{ ...header, lines: [...] }`) — same class of gap
  // as "items" above, just for JV's debit/credit lines.
  for (const key of ["LineItems", "POItems", "Items", "items", "lines"]) {
    const v = detail[key];
    if (Array.isArray(v) && v.length > 0) return v as Record<string, unknown>[];
  }
  return [];
}

export function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN");
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "—";
  const str = String(value);
  // ISO-ish date strings render as a readable date; everything else as-is.
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }
  }
  return str;
}
