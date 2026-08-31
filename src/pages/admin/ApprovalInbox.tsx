import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { computeGrnNetWithTerms } from "@/pages/material/ExpenseBooking/helpers";
import {
  ClipboardCheck,
  ClipboardList,
  Package,
  PackageOpen,
  Hammer,
  Banknote,
  Truck,
  Receipt,
  ArrowDownCircle,
  RefreshCw,
  ArrowUpRight,
  Inbox,
  CheckCircle2,
  XCircle,
  ArrowLeftRight,
  Warehouse,
  ShoppingCart,
  Building2,
  Home,
  Car,
  ChevronDown,
  SlidersHorizontal,
  Eye,
  FileText,
  Landmark,
  UserCheck,
  FileWarning,
} from "lucide-react";
import type { ApprovalTable } from "@/components/ApprovalStatusChain";
import { ApprovalReviewPanel } from "./ApprovalReviewPanel";

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
  Amount: number | null;
  CreatedBy: string | null;
  ApprovedBy: string | null;
  ApprovedAt: string | null;
  RejectedBy: string | null;
  RejectionNote: string | null;
  LastModified: string | null;
  // expense-booking only — null for all other modules
  GrnTotalAmount: number | null;
  GrnBasicAmount: number | null;
  BillingTermsData: string | null;
  // goods-receipt (transfer GRNs) — null for non-transfer GRNs
  SourceTransferDocNo: string | null;
  FromGodownName: string | null;
  ToGodownName: string | null;
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
    color: "text-amber-500 bg-amber-500/10",
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
    label: "Expense Bookings",
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
    color: "text-amber-500 bg-amber-500/10",
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
  "material-issues": "MaterialIssues",
  "material-requests": "MaterialRequests",
  boq: "BOQ",
  "work-done": "WorkDone",
  "sale-orders": "SaleOrders",
  "vehicle-in-out": "VehicleInOut",
  contracts: "Contract",
};

// Every CRM approval module is gated to admin/super_admin/marketing_head —
// dba is deliberately excluded, unlike the system-default APPROVER_ROLES.
export const CRM_MODULES = new Set(["crm-bookings", "crm-agreements", "crm-brokerage", "crm-cancellations", "crm-noc"]);
export const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];
const MR_APPROVER_ROLES = ["admin", "super_admin", "dba", "accounts_head"];
const CRM_BOOKING_APPROVER_ROLES = ["admin", "super_admin", "marketing_head", "director"];
// Agreement Date and Sales Deed Director approval are narrower, separate
// gates — super_admin only, "for now" per instruction, unlike the rest of
// the CRM modules above. The backend enforces this independently via
// approvalService's MODULE_APPROVER_ROLE_OVERRIDES; this only controls
// button visibility (and which /:id/<suffix>/approve path gets hit) here.
export const DATE_APPROVER_ROLES = ["super_admin"];
export const SUB_GATE_SUFFIX: Record<string, string> = { "crm-agreement-date": "date", "crm-sales-deed-director": "director" };
export const SUB_GATE_MODULES = new Set(Object.keys(SUB_GATE_SUFFIX));

// Modules the backend keeps deliberately role-locked (see
// MODULE_APPROVER_ROLE_OVERRIDES in approvalService.js) — the
// "approval-inbox" page-right fallback must not open these.
export const RESTRICTED_MODULES = new Set([
  "journal-voucher",
  "inter-company-transfer",
  "fund-transfer",
  "crm-money-receipts",
  ...SUB_GATE_MODULES,
]);

const ALL_MODULES = Object.keys(MODULE_CONFIG);

// Modules whose one-click Approve is either guaranteed to fail without a
// review step first (crm-bookings' Data Review checklist gate) or whose
// approved amount is only ever editable before approval (crm-brokerage) —
// see the reviewInstead comment below for the full reasoning per module.
const REVIEW_INSTEAD_LABEL: Record<string, string> = {
  "crm-bookings": "Open Booking",
  "crm-brokerage": "Review & Approve",
};

// Modules whose page already supports a "?view=<RecordId>" deep link that
// auto-opens that exact record's own preview/view modal on load (see the
// `searchParams.get("view")` effect in each page). Modules not listed here
// have no such modal yet, so we fall back to a bare navigate.
const VIEW_PARAM_MODULES = new Set([
  "purchase-orders",
  "goods-receipt",
  "expense-booking",
  "payments",
  "vehicle-in-out",
  "material-requests",
  "crm-brokerage",
]);

// Builds the URL to open a given inbox item directly in its module's own
// preview mode, instead of dumping the user on a blank list page to hunt
// for the record themselves.
export function openInModulePath(item: InboxItem, navPath: string): string {
  // crm-bookings' navPath (/crm/bookings) opens the real Booking detail
  // dialog via its existing "?view=" deep link — same convention
  // VIEW_PARAM_MODULES below uses, just listed explicitly here since it's
  // CRM-specific rather than shared with the generic modules.
  if (item.Module === "crm-bookings") {
    return `${navPath}?view=${item.RecordId}`;
  }
  // crm-agreements/crm-agreement-date use "?id=" (opens the read-only detail
  // dialog directly via CrmApplication.tsx-style searchParams.get("id") effects).
  if (item.Module === "crm-agreements" || item.Module === "crm-agreement-date") {
    return `${navPath}?id=${item.RecordId}`;
  }
  if (VIEW_PARAM_MODULES.has(item.Module)) {
    return `${navPath}?view=${item.RecordId}`;
  }
  return navPath;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetchInbox = async (): Promise<InboxItem[]> => {
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
};

const MODULE_TAB_COLORS: Record<string, { icon: string; active: string }> = {
  "purchase-orders": { icon: "text-blue-500", active: "bg-blue-500 border-blue-500" },
  "work-orders": { icon: "text-amber-500", active: "bg-amber-500 border-amber-500" },
  payments: { icon: "text-emerald-500", active: "bg-emerald-500 border-emerald-500" },
  "goods-receipt": { icon: "text-violet-500", active: "bg-violet-500 border-violet-500" },
  "expense-booking": { icon: "text-rose-500", active: "bg-rose-500 border-rose-500" },
  "received-payment": { icon: "text-teal-500", active: "bg-teal-500 border-teal-500" },
  "work-done": { icon: "text-emerald-600", active: "bg-emerald-600 border-emerald-600" },
  boq: { icon: "text-indigo-500", active: "bg-indigo-500 border-indigo-500" },
  "material-requests": { icon: "text-orange-500", active: "bg-orange-500 border-orange-500" },
  "material-issues": { icon: "text-cyan-500", active: "bg-cyan-500 border-cyan-500" },
  "journal-voucher": { icon: "text-amber-600", active: "bg-amber-600 border-amber-600" },
  "inter-company-transfer": { icon: "text-fuchsia-600", active: "bg-fuchsia-600 border-fuchsia-600" },
  "fund-transfer": { icon: "text-violet-600", active: "bg-violet-600 border-violet-600" },
  "sale-orders": { icon: "text-lime-600", active: "bg-lime-600 border-lime-600" },
  "vehicle-in-out": { icon: "text-sky-600", active: "bg-sky-600 border-sky-600" },
  "crm-money-receipts": { icon: "text-teal-600", active: "bg-teal-600 border-teal-600" },
  contracts: { icon: "text-purple-500", active: "bg-purple-500 border-purple-500" },
};

const ModuleTab: React.FC<{
  module: string | null;
  label: string;
  icon?: React.ElementType;
  count: number;
  active: boolean;
  onClick: () => void;
}> = ({ module, label, icon: Icon, count, active, onClick }) => {
  const colors = module ? MODULE_TAB_COLORS[module] : null;

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-medium transition-all whitespace-nowrap ${
        active
          ? `${colors?.active ?? "bg-primary border-primary"} text-white shadow-sm`
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {Icon && (
        <Icon size={12} className={active ? "text-white" : colors?.icon} />
      )}
      <span>{label}</span>
      {count > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
            active
              ? "bg-white/20 text-white"
              : "bg-muted text-foreground/70"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
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
  for (const key of ["LineItems", "POItems", "Items"]) {
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

// ─── Inbox row ────────────────────────────────────────────────────────────────

const InboxRow: React.FC<{
  item: InboxItem;
  onActionDone: () => void;
  onOptimisticUpdate: (recordId: string, module: string) => void;
}> = ({ item, onActionDone, onOptimisticUpdate }) => {
  const navigate = useNavigate();
  const cfg = MODULE_CONFIG[item.Module];
  const Icon = cfg?.icon ?? ClipboardCheck;

  const approvedBy = item.ApprovedBy?.trim();
  const rejectedBy = item.RejectedBy?.trim();
  const party =
    item.SupplierName || item.ContractorName || item.CreatedBy || "—";
  const effectiveAmount = getEffectiveAmount(item);
  const [reviewOpen, setReviewOpen] = useState(false);

  const actions = (
    <div className="flex items-center gap-2 [&_button]:!filter-none [&_button]:!backdrop-filter-none">
      <button
        onClick={() => setReviewOpen(true)}
        className="p-1.5 rounded-md text-sky-500 hover:bg-sky-500/10 transition-colors"
        title="Review & Approve"
      >
        <Eye size={14} />
      </button>
      <ApprovalActions
        status={item.Status}
        recordId={item.RecordId}
        endpoint={cfg?.apiEndpoint ?? `/api/${item.Module}`}
        actionPathSuffix={SUB_GATE_SUFFIX[item.Module]}
        approverRoles={
          SUB_GATE_MODULES.has(item.Module) ? DATE_APPROVER_ROLES
          : item.Module === "crm-bookings" ? CRM_BOOKING_APPROVER_ROLES
          : item.Module === "crm-money-receipts" ? MR_APPROVER_ROLES
          : CRM_MODULES.has(item.Module) ? CRM_APPROVER_ROLES
          : undefined
        }
        // crm-applications'/crm-bookings' own PUT /:id/approve routes 400
        // until every Level-1/Level-2 checklist item is ticked — a one-click
        // Approve here can never succeed on its own, it can only ever
        // produce the "Complete the Level-X verification checklist..."
        // error toast. crm-brokerage's approve CAN succeed one-click (no
        // checklist gate), but the computed amount is meant to be reviewed
        // — and is only ever editable — before approval (see crmBrokerage.js
        // PUT /:id "can only be customized before approval"), so a blind
        // one-click Approve here skips the one chance to catch/adjust a
        // wrong figure. All three swap the Approve button for a direct
        // hand-off to their own review screen instead. Reject is untouched
        // for all of them — no checklist/review gate applies to rejecting.
        reviewInstead={
          REVIEW_INSTEAD_LABEL[item.Module] && cfg?.navPath
            ? { label: REVIEW_INSTEAD_LABEL[item.Module], onClick: () => navigate(openInModulePath(item, cfg.navPath)) }
            : undefined
        }
        restricted={RESTRICTED_MODULES.has(item.Module)}
        onSuccess={(action) => {
          if (action === "approve" || action === "reject") {
            onOptimisticUpdate(item.RecordId, item.Module);
          }
          onActionDone();
        }}
      />
      {/* The separate "open in preview" arrow is redundant for any module
          with a reviewInstead button while Pending — that button above
          already does the exact same navigation. Once it leaves Pending
          (Approved/Rejected/Cancelled), reviewInstead isn't rendered above,
          so the arrow comes back as the only way to open the record from
          this row. */}
      {cfg?.navPath && !(REVIEW_INSTEAD_LABEL[item.Module] && item.Status === "Pending") && (
        <button
          onClick={() => navigate(openInModulePath(item, cfg.navPath))}
          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          title={`Open ${item.ModuleLabel} in preview`}
        >
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div>
      {reviewOpen && (
        <ApprovalReviewPanel
          item={item}
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          onActionDone={() => {
            onOptimisticUpdate(item.RecordId, item.Module);
            onActionDone();
          }}
        />
      )}
      {/* ── Mobile card (< md) ─────────────────────────────────────────── */}
      <div className="md:hidden border-b border-border last:border-0 px-4 py-3.5 space-y-3">
        {/* Row 1: module + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`p-1.5 rounded-lg shrink-0 ${cfg?.color ?? "bg-muted text-muted-foreground"}`}
            >
              <Icon size={13} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">
                {item.ModuleLabel}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {item.Reference || `#${item.RecordId}`}
              </p>
            </div>
          </div>
          <StatusBadge status={item.Status} />
        </div>

        {/* Row 2: party / transfer route + date */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {item.Module === "goods-receipt" && item.SourceTransferDocNo ? (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-mono text-[11px] font-semibold text-violet-600 dark:text-violet-400 truncate">
                {item.SourceTransferDocNo}
              </span>
              {item.FromGodownName && item.ToGodownName && (
                <span className="flex items-center gap-1 text-[10px] truncate">
                  <Warehouse size={9} className="shrink-0 text-orange-500" />
                  <span className="truncate">{item.FromGodownName}</span>
                  <ArrowLeftRight size={8} className="shrink-0" />
                  <Warehouse size={9} className="shrink-0 text-emerald-500" />
                  <span className="truncate">{item.ToGodownName}</span>
                </span>
              )}
            </div>
          ) : item.Module === "sale-orders" ? (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[11px] font-semibold text-foreground truncate">
                <span className="truncate">{item.ContractorName}</span>
                <ArrowLeftRight size={8} className="shrink-0" />
                <span className="truncate">{item.SupplierName}</span>
              </span>
              {item.FromGodownName && item.ToGodownName && (
                <span className="flex items-center gap-1 text-[10px] truncate">
                  <Warehouse size={9} className="shrink-0 text-orange-500" />
                  <span className="truncate">{item.FromGodownName}</span>
                  <ArrowLeftRight size={8} className="shrink-0" />
                  <Warehouse size={9} className="shrink-0 text-emerald-500" />
                  <span className="truncate">{item.ToGodownName}</span>
                </span>
              )}
            </div>
          ) : (
            <span className="truncate">{party}</span>
          )}
          <span className="shrink-0">{fmtDate(item.RecordDate)}</span>
        </div>

        {/* Row 3: amount + approved/rejected by */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-mono font-semibold text-foreground">
            {fmtAmount(effectiveAmount)}
          </p>
          <div className="flex items-center gap-1.5">
            {approvedBy && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full truncate max-w-[120px]">
                <CheckCircle2 size={9} /> {approvedBy}
              </span>
            )}
            {rejectedBy && (
              <span className="flex items-center gap-1 text-[10px] text-red-600 bg-red-500/10 border border-red-400/20 px-2 py-0.5 rounded-full truncate max-w-[120px]">
                <XCircle size={9} /> {rejectedBy}
              </span>
            )}
          </div>
        </div>

        {/* Row 4: actions */}
        <div>{actions}</div>
      </div>

      {/* ── Desktop row (≥ md) ─────────────────────────────────────────── */}
      <div className={`hidden md:flex items-stretch border-b border-border last:border-0 hover:bg-muted/20 transition-colors group`}>
        {/* Left accent rail */}
        <div className="w-[3px] shrink-0 self-stretch rounded-tl-sm rounded-bl-sm"
          style={{ background: (() => {
            const c = cfg?.color ?? "";
            const m = c.match(/text-(\w+)-(\d+)/);
            if (!m) return "var(--border)";
            const map: Record<string, Record<string, string>> = {
              blue: { 500: "#3b82f6" }, amber: { 500: "#f59e0b", 600: "#d97706" },
              emerald: { 500: "#10b981", 600: "#059669" }, violet: { 500: "#8b5cf6", 600: "#7c3aed" },
              rose: { 500: "#f43f5e" }, teal: { 500: "#14b8a6", 600: "#0d9488" },
              indigo: { 400: "#818cf8", 500: "#6366f1" }, orange: { 500: "#f97316" },
              cyan: { 500: "#06b6d4" }, fuchsia: { 500: "#d946ef", 600: "#c026d3" },
              sky: { 500: "#0ea5e9" }, purple: { 500: "#a855f7" }, lime: { 600: "#65a30d" },
            };
            return map[m[1]]?.[m[2]] ?? "var(--border)";
          })() }}
        />
        <div className={`flex-1 grid grid-cols-[190px_100px_1fr_120px_150px_110px_1fr] items-center gap-2 pl-3 pr-4 py-3.5`}>
        {/* Col 1 — Module */}
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2.5 rounded-xl shrink-0 shadow-sm ${cfg?.color ?? "bg-muted text-muted-foreground"}`}>
            <Icon size={15} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
              {item.ModuleLabel}
            </p>
            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
              {item.Reference || `#${item.RecordId}`}
            </p>
          </div>
        </div>

        {/* Col 2 — Date */}
        <div>
          <p className="text-xs font-medium text-foreground">{fmtDate(item.RecordDate)}</p>
        </div>

        {/* Col 3 — Party / Transfer route */}
        {item.Module === "goods-receipt" && item.SourceTransferDocNo ? (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
              Transfer ref
            </span>
            <span className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-400 truncate">
              {item.SourceTransferDocNo}
            </span>
            {item.FromGodownName && item.ToGodownName && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                <Warehouse size={9} className="shrink-0 text-orange-500" />
                <span className="truncate">{item.FromGodownName}</span>
                <ArrowLeftRight size={8} className="shrink-0" />
                <Warehouse size={9} className="shrink-0 text-emerald-500" />
                <span className="truncate">{item.ToGodownName}</span>
              </span>
            )}
          </div>
        ) : item.Module === "sale-orders" ? (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-foreground truncate">
              <Building2 size={9} className="shrink-0 text-blue-500" />
              <span className="truncate">{item.ContractorName}</span>
              <ArrowLeftRight
                size={8}
                className="shrink-0 text-muted-foreground"
              />
              <Building2 size={9} className="shrink-0 text-violet-500" />
              <span className="truncate">{item.SupplierName}</span>
            </span>
            {item.FromGodownName && item.ToGodownName && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                <Warehouse size={9} className="shrink-0 text-orange-500" />
                <span className="truncate">{item.FromGodownName}</span>
                <ArrowLeftRight size={8} className="shrink-0" />
                <Warehouse size={9} className="shrink-0 text-emerald-500" />
                <span className="truncate">{item.ToGodownName}</span>
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-foreground truncate">{party}</p>
        )}

        {/* Col 4 — Amount */}
        <div className="inline-flex items-center px-2 py-1 rounded-lg bg-foreground/5 border border-border/60">
          <p className="text-[13px] font-mono font-bold text-foreground tabular-nums">
            {fmtAmount(effectiveAmount)}
          </p>
        </div>

        {/* Col 5 — Approved/Rejected By */}
        <div className="flex items-center gap-1.5 min-w-0">
          {approvedBy && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full truncate max-w-[130px]">
              <CheckCircle2 size={9} /> {approvedBy}
            </span>
          )}
          {rejectedBy && (
            <span className="flex items-center gap-1 text-[10px] text-red-600 bg-red-500/10 border border-red-400/20 px-2 py-0.5 rounded-full truncate max-w-[130px]">
              <XCircle size={9} /> {rejectedBy}
            </span>
          )}
          {!approvedBy && !rejectedBy && (
            <span className="text-[10px] text-muted-foreground/50 italic">—</span>
          )}
        </div>

        {/* Col 6 — Status */}
        <div className="flex items-center">
          <StatusBadge status={item.Status} />
        </div>

        {/* Col 7 — Actions */}
        <div className="flex items-center gap-2 [&_button]:!filter-none [&_button]:!backdrop-filter-none">
          {actions}
        </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const ApprovalInbox: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("approval-inbox");
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const {
    data: allItems = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["approval-inbox"],
    queryFn: fetchInbox,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  const items = (
    activeModule ? allItems.filter((i) => i.Module === activeModule) : allItems
  ).filter((i) => !removedKeys.has(`${i.Module}-${i.RecordId}`));

  const handleOptimisticUpdate = (recordId: string, module: string) => {
    setRemovedKeys((prev) => new Set(prev).add(`${module}-${recordId}`));
  };

  const handleActionDone = () => {
    queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
    queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["boqs"], exact: false });
    // CRM booking financial data — milestone AmountPaid, money receipts, and
    // on-account balance all update when Finance approves a Received Payment
    // or Money Receipt. Without these, a booking detail open in another tab
    // shows stale figures (e.g. milestone still showing balance after payment clears).
    queryClient.invalidateQueries({ queryKey: ["crm-booking-detail"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["crm-booking-money-receipts"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["crm-booking-on-account"], exact: false });
    // Signal sidebar to immediately re-poll the pending-count badge.
    window.dispatchEvent(new CustomEvent("approval-action"));
  };

  const countFor = (mod: string) =>
    allItems.filter((i) => i.Module === mod).length;
  const totalCount = allItems.length;

  return (
    <>
      <Breadcrumbs items={["Approvals", "Inbox"]} />

      <AdminShell
        title="Approval Inbox"
        subtitle="All records awaiting your approval across every module"
        icon={Inbox}
        action={
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <span className="bg-red-500 text-white text-[11px] font-bold min-w-[22px] h-[22px] flex items-center justify-center rounded-full leading-none">
                {totalCount}
              </span>
            )}
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-all duration-200 active:scale-90 disabled:opacity-50 shrink-0"
              title="Refresh"
            >
              <RefreshCw
                size={13}
                className={`transition-transform duration-500 ${isRefetching ? "animate-spin" : "group-hover:rotate-180"}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >
        {/* Module filter — collapsible so the full module list doesn't
            spill across multiple lines by default; expand to see/pick all. */}
        <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
          <button
            onClick={() => setFiltersExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal size={12} />
              Filter by module
              {activeModule && (
                <span className="text-[10px] font-semibold text-primary">
                  · {MODULE_CONFIG[activeModule]?.label}
                </span>
              )}
            </span>
            <ChevronDown
              size={14}
              className={`transition-transform ${filtersExpanded ? "rotate-180" : ""}`}
            />
          </button>
          {filtersExpanded && (
            <div className="flex items-center gap-1.5 flex-wrap p-1.5 pt-0">
              <ModuleTab
                module={null}
                label="All"
                icon={ClipboardCheck}
                count={totalCount}
                active={activeModule === null}
                onClick={() => setActiveModule(null)}
              />
              {ALL_MODULES.map((mod) => {
                const cfg = MODULE_CONFIG[mod];
                return (
                  <ModuleTab
                    key={mod}
                    module={mod}
                    label={cfg.label}
                    icon={cfg.icon}
                    count={countFor(mod)}
                    active={activeModule === mod}
                    onClick={() =>
                      setActiveModule(activeModule === mod ? null : mod)
                    }
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="rounded-xl border border-border bg-card">
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3.5 animate-pulse"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded bg-muted" />
                    <div className="h-2.5 w-24 rounded bg-muted" />
                  </div>
                  <div className="h-6 w-20 rounded-full bg-muted" />
                  <div className="h-7 w-24 rounded-lg bg-muted" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Inbox size={24} className="text-muted-foreground/40" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {activeModule
                  ? "No pending items in this module"
                  : "All clear!"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {activeModule
                  ? "Switch to All to see the full inbox"
                  : "No records are awaiting approval right now"}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table header */}
              <div className="hidden md:flex items-center border-b border-border rounded-t-xl bg-muted/40">
                <div className="w-[3px] shrink-0 self-stretch" />
                <div className="flex-1 grid grid-cols-[190px_100px_1fr_120px_150px_110px_1fr] gap-2 pl-3 pr-4 py-2.5">
                {[
                  "Module / Ref",
                  "Date",
                  "Party / Transfer",
                  "Amount",
                  "Approved/Rejected By",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <p
                    key={h}
                    className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    {h}
                  </p>
                ))}
                </div>
              </div>

              <div>
                {items.map((item) => (
                  <InboxRow
                    key={`${item.Module}-${item.RecordId}`}
                    item={item}
                    onActionDone={handleActionDone}
                    onOptimisticUpdate={handleOptimisticUpdate}
                  />
                ))}
              </div>

              <div className="px-4 py-2.5 border-t border-border bg-muted/20 rounded-b-xl">
                <p className="text-[11px] text-muted-foreground">
                  {items.length} record{items.length !== 1 ? "s" : ""} pending
                  approval
                  {activeModule &&
                    ` in ${MODULE_CONFIG[activeModule]?.label ?? activeModule}`}
                </p>
              </div>
            </>
          )}
        </div>
      </AdminShell>
    </>
  );
};

export default ApprovalInbox;
