import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApprovalStatusChain, type ApprovalTable } from "@/components/ApprovalStatusChain";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxItem {
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

const MODULE_CONFIG: Record<
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
  // Was missing entirely — same class of bug as the "contracts" fix above.
  // Without this entry, cfg was undefined for every crm-applications row, so:
  //   1. endpoint fell back to `/api/${item.Module}` = "/api/crm-applications"
  //      (hyphenated, no mount there) instead of the real "/api/crm/applications"
  //      route — every Approve/Reject/Submit click from this inbox 404'd.
  //   2. approverRoles fell back to undefined (CRM_MODULES.has() was false),
  //      so ApprovalActions used its own default ["admin","super_admin","dba"]
  //      instead of CRM_APPROVER_ROLES ["admin","super_admin","marketing_head"]
  //      that the backend actually enforces — dba saw a button that always
  //      403'd, marketing_head didn't see a button they were allowed to use.
  //   3. navPath was undefined, so there was no way to jump from the inbox
  //      into the actual Application to work the Level-1 checklist at all.
  //
  // navPath points at the dedicated Level-1 verification screen
  // (/crm/applications/verify/:id — see CrmApplicationVerify.tsx), NOT the
  // main Applications list/detail page. This IS the moment someone's doing
  // L1 verification — the inbox's whole job is to hand them straight to the
  // focused checklist screen instead of the full edit wizard. See
  // openInModulePath() below for how this navPath gets combined with the
  // RecordId (a path segment here, unlike crm-agreements' "?id=" query param).
  "crm-applications": {
    icon: UserCheck,
    color: "text-cyan-600 bg-cyan-600/10",
    navPath: "/crm/applications/verify",
    apiEndpoint: "/api/crm/applications",
    label: "CRM Applications",
  },
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
};

// Module → ApprovalAuditLog TableName, only for modules the backend's
// /api/approval-workflows/trail endpoint actually recognises (see
// MODULE_TABLE_MAP in backend/routes/approvalWorkflows.js). Modules not
// listed here (journal-voucher, inter-company-transfer, received-payment,
// crm-*) simply don't render the chain badge in the preview modal.
const MODULE_APPROVAL_TABLE: Record<string, ApprovalTable> = {
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
const CRM_MODULES = new Set(["crm-applications", "crm-bookings", "crm-agreements", "crm-brokerage", "crm-cancellations", "crm-noc"]);
const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];
// Agreement Date and Sales Deed Director approval are narrower, separate
// gates — super_admin only, "for now" per instruction, unlike the rest of
// the CRM modules above. The backend enforces this independently via
// approvalService's MODULE_APPROVER_ROLE_OVERRIDES; this only controls
// button visibility (and which /:id/<suffix>/approve path gets hit) here.
const DATE_APPROVER_ROLES = ["super_admin"];
const SUB_GATE_SUFFIX: Record<string, string> = { "crm-agreement-date": "date", "crm-sales-deed-director": "director" };
const SUB_GATE_MODULES = new Set(Object.keys(SUB_GATE_SUFFIX));

const ALL_MODULES = Object.keys(MODULE_CONFIG);

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
]);

// Builds the URL to open a given inbox item directly in its module's own
// preview mode, instead of dumping the user on a blank list page to hunt
// for the record themselves.
function openInModulePath(item: InboxItem, navPath: string): string {
  // crm-applications' navPath already points straight at the dedicated
  // verification screen (/crm/applications/verify), which takes the record
  // id as a path segment (/verify/:id), not a query param — see
  // CrmApplicationVerify.tsx's useParams<{ id: string }>().
  if (item.Module === "crm-applications") {
    return `${navPath}/${item.RecordId}`;
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

const fmtDate = (d: string | null) => {
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

const fmtAmount = (n: number | null) => {
  if (n == null) return "—";
  return formatINR(n, { decimals: 2 });
};

/**
 * For expense-booking rows, if the record is GRN-linked, compute net payable
 * by applying billing terms on top of the live GRN total — same logic as the
 * Expense Booking list page and preview modal.  Falls back to stored Amount for
 * all other modules or non-GRN expense bookings.
 */
function getEffectiveAmount(item: InboxItem): number | null {
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
const PREVIEW_HIDDEN_KEYS = new Set([
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
function stripDbPrefix(key: string): string {
  return key.replace(/^[A-Z](?=[A-Z])/, "");
}

// Every module names its foreign keys differently (ECompanyId, SupplierID,
// ContractorId, LHeadId, PurchaseOrderID, ...) so a fixed key list above
// can never keep up. Any field whose name ends in "Id" is a raw internal
// reference, not something a reviewer can read — hide it here and let its
// resolved sibling (CompanyName, SupplierName, ProjectName, ...), which the
// record's own GET /:id endpoint already returns, show through instead.
function isIdField(key: string): boolean {
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
function isJsonBlob(value: unknown): boolean {
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

function labelizeKey(key: string): string {
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
function extractLineItems(detail: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!detail) return [];
  for (const key of ["LineItems", "POItems", "Items"]) {
    const v = detail[key];
    if (Array.isArray(v) && v.length > 0) return v as Record<string, unknown>[];
  }
  return [];
}

function formatPreviewValue(value: unknown): string {
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

const RecordPreviewModal: React.FC<{
  item: InboxItem;
  open: boolean;
  onClose: () => void;
}> = ({ item, open, onClose }) => {
  const navigate = useNavigate();
  const cfg = MODULE_CONFIG[item.Module];
  const Icon = cfg?.icon ?? ClipboardCheck;
  const approvalTable = MODULE_APPROVAL_TABLE[item.Module];

  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDetail(null);
    setFetchFailed(false);
    if (!cfg?.apiEndpoint) return;
    setLoading(true);
    fetchWithAuth(`${cfg.apiEndpoint}/${item.RecordId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        // crm-applications' GET /:id (crmApplications.js) is the one endpoint
        // in this preview that returns a wrapped shape —
        // { application: {...}, bookings: [...], statusLog: [...] } — instead
        // of a flat record. Every other module's GET /:id returns the record
        // itself at the top level, which is what extractLineItems/extraFields
        // below expect. Without unwrapping here, `typeof v !== "object"` would
        // filter out application/bookings/statusLog wholesale and this modal
        // would render as an empty shell for every CRM Application.
        const record =
          item.Module === "crm-applications" && data && typeof data === "object" && "application" in data
            ? (data as Record<string, unknown>).application
            : data;
        if (!cancelled) setDetail(record && typeof record === "object" ? (record as Record<string, unknown>) : null);
      })
      .catch(() => {
        if (!cancelled) setFetchFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item.Module, item.RecordId, cfg?.apiEndpoint]);

  const effectiveAmount = getEffectiveAmount(item);
  const party = item.SupplierName || item.ContractorName || item.CreatedBy || "—";

  const lineItems = extractLineItems(detail);

  const extraFields = detail
    ? Object.entries(detail).filter(
        ([k, v]) =>
          !PREVIEW_HIDDEN_KEYS.has(stripDbPrefix(k).toLowerCase()) &&
          !isIdField(k) &&
          !isJsonBlob(v) &&
          !(Array.isArray(v) && v.length === 0) &&
          typeof v !== "object",
      )
    : [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start sm:items-center gap-3 flex-wrap pr-6">
            <div className={`p-2 rounded-lg shrink-0 ${cfg?.color ?? "bg-muted text-muted-foreground"}`}>
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-sm font-semibold break-words">
                {item.ModuleLabel}
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {item.Reference || `#${item.RecordId}`}
              </p>
            </div>
            <StatusBadge status={item.Status} />
          </div>
        </DialogHeader>

        {approvalTable && (
          <div className="flex items-center gap-2 -mt-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Approval chain
            </span>
            <ApprovalStatusChain table={approvalTable} recordId={item.RecordId} />
          </div>
        )}

        {/* Summary grid — always available from the inbox item itself */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl border border-border bg-muted/20 p-3">
          {[
            ["Date", fmtDate(item.RecordDate)],
            ["Party", party],
            ["Amount", fmtAmount(effectiveAmount)],
            ["Created By", item.CreatedBy || "—"],
            ["Approved By", item.ApprovedBy || "—"],
            ["Rejected By", item.RejectedBy || "—"],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {label}
              </p>
              <p className="text-xs text-foreground break-words">{value}</p>
            </div>
          ))}
        </div>

        {item.RejectionNote && (
          <div className="rounded-lg border border-red-400/20 bg-red-500/5 px-3 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-red-500/80 mb-0.5">
              Rejection Note
            </p>
            <p className="text-xs text-foreground">{item.RejectionNote}</p>
          </div>
        )}

        {/* Line items — shown as separate rows (qty/rate/amount per item),
            not folded into the single cumulative Amount above, so a
            reviewer can actually check what's being approved. */}
        {lineItems.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
              <Package size={10} className="text-emerald-500" /> Items ({lineItems.length})
            </p>
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs" style={{ tableLayout: "auto" }}>
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-left">Item</th>
                    <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right">Qty</th>
                    <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-left hidden sm:table-cell">Unit</th>
                    <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right hidden sm:table-cell">Rate</th>
                    <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {lineItems.map((li, i) => {
                    const name = (li.ItemName ?? li.itemName ?? li.Description ?? li.itemDescription ?? "—") as string;
                    const qty = Number(li.Quantity ?? li.quantity ?? 0);
                    const unit = (li.UomName ?? li.UOMSymbol ?? li.unit ?? "—") as string;
                    const rate = Number(li.Rate ?? li.rate ?? 0);
                    const amount = Number(li.LineAmount ?? li.amount ?? qty * rate);
                    return (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 font-medium">{name}</td>
                        <td className="px-3 py-2 text-right">{qty.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{unit}</td>
                        <td className="px-3 py-2 text-right hidden sm:table-cell">{formatINR(rate)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatINR(amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Full record — everything the record's own detail endpoint returns */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Full Record
          </p>
          {loading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-3 w-full rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : fetchFailed || extraFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {fetchFailed
                ? "Couldn't load the full record — showing summary only."
                : "No additional fields."}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 rounded-xl border border-border p-3">
              {extraFields.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/70 truncate">
                    {labelizeKey(k)}
                  </p>
                  <p className="text-xs text-foreground break-words">{formatPreviewValue(v)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {cfg?.navPath && (
          <button
            onClick={() => {
              onClose();
              navigate(openInModulePath(item, cfg.navPath));
            }}
            className="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors text-center"
          >
            <ArrowUpRight size={13} className="shrink-0" />
            <span className="break-words">Open in {item.ModuleLabel}</span>
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
};

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
  const [previewOpen, setPreviewOpen] = useState(false);

  const actions = (
    <div className="flex items-center gap-2 [&_button]:!filter-none [&_button]:!backdrop-filter-none">
      <button
        onClick={() => setPreviewOpen(true)}
        className="p-1.5 rounded-md text-sky-500 hover:bg-sky-500/10 transition-colors"
        title="Preview details"
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
          : CRM_MODULES.has(item.Module) ? CRM_APPROVER_ROLES
          : undefined
        }
        // crm-applications' own PUT /:id/approve (crmApplications.js) 400s
        // until every Level-1 checklist item is ticked — a one-click Approve
        // here can never succeed on its own, it can only ever produce the
        // "Complete the Level-1 verification checklist..." error toast. So
        // for this module only, swap that button for a direct hand-off to
        // the checklist screen instead of offering a button that's
        // guaranteed to fail. Reject is untouched — it has no checklist
        // gate and stays a normal, direct action from this row. Scoped to
        // crm-applications specifically (not all of CRM_MODULES) — no other
        // CRM module has this per-field verification step.
        reviewInstead={
          item.Module === "crm-applications" && cfg?.navPath
            ? { label: "Review & Verify", onClick: () => navigate(openInModulePath(item, cfg.navPath)) }
            : undefined
        }
        onSuccess={(action) => {
          if (action === "approve" || action === "reject") {
            onOptimisticUpdate(item.RecordId, item.Module);
          }
          onActionDone();
        }}
      />
      {/* The separate "open in preview" arrow is redundant for crm-applications
          while Pending — Review & Verify above already does the exact same
          navigation. Once it leaves Pending (Approved/Rejected/Cancelled),
          there's no Review & Verify button rendered above, so the arrow comes
          back as the only way to open the record from this row. */}
      {cfg?.navPath && !(item.Module === "crm-applications" && item.Status === "Pending") && (
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
      {previewOpen && (
        <RecordPreviewModal
          item={item}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
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
      <div className="hidden md:grid grid-cols-[190px_100px_1fr_110px_150px_120px_1fr] items-center gap-2 px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
        {/* Col 1 — Module */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`p-2 rounded-lg shrink-0 ${cfg?.color ?? "bg-muted text-muted-foreground"}`}
          >
            <Icon size={14} />
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

        {/* Col 2 — Date */}
        <p className="text-xs text-foreground">{fmtDate(item.RecordDate)}</p>

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
        <p className="text-xs font-mono font-semibold text-foreground">
          {fmtAmount(effectiveAmount)}
        </p>

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
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const ApprovalInbox: React.FC = () => {
  const queryClient = useQueryClient();
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
              <div className="hidden md:grid grid-cols-[190px_100px_1fr_110px_150px_120px_1fr] gap-2 px-4 py-2.5 bg-muted/40 border-b border-border rounded-t-xl">
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