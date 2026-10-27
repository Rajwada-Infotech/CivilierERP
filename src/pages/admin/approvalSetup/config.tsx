// Approval Setup's catalogue: the workflow and level types, every module that can carry an approval
// workflow and how they group, and the workflow API calls.
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApprovalLevel {
  id: number;
  label: string;
  userIds: number[];
  /** Role names (Role.RName) whose holders may approve at this step, besides
   *  the people named in userIds. */
  roles?: string[];
  // "any" (default) — the step is done as soon as one assigned person
  // approves. "all" — every assigned person must approve before the step
  // moves on (e.g. Director 1 AND Director 2, not just one of them).
  mode: "any" | "all";
}

export interface ApprovalWorkflow {
  id: number;
  name: string;
  type: "sequential" | "any" | "parallel";
  modules: string[];
  levels: ApprovalLevel[];
  active: boolean;
  description?: string;
  createdAt?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MODULE_OPTIONS = [
  {
    id: "GRN",
    label: "Goods Receipt (GRN)",
    icon: "📦",
    desc: "When goods arrive at site",
  },
  {
    id: "PurchaseOrders",
    label: "Purchase Order",
    icon: "🛒",
    desc: "Before a PO is raised",
  },
  {
    id: "MaterialIssues",
    label: "Material Issue",
    icon: "🚚",
    desc: "When materials leave store",
  },
  {
    id: "MaterialIssueReturn",
    label: "Material Issue Return",
    icon: "↩️",
    desc: "Before returned material is credited back to stock",
  },
  {
    id: "Expenses",
    label: "Invoice",
    icon: "🧾",
    desc: "Before an invoice is booked",
  },
  {
    id: "WorkOrderHeader",
    label: "Work Order",
    icon: "🔧",
    desc: "Before work begins",
  },
  {
    id: "NewPayment",
    label: "Payment",
    icon: "💳",
    desc: "Before payments are made",
  },
  {
    id: "CrmRefundPayment",
    label: "CRM Refund Payment",
    icon: "💸",
    desc: "A CRM refund's payout voucher — single level by default, matching Received Payments' own approval pattern rather than the general Payment workflow above",
  },
  {
    id: "MaterialRequests",
    label: "Material Request",
    icon: "📋",
    desc: "Before store issues material against a request",
  },
  {
    id: "VehicleInOut",
    label: "Vehicle In/Out",
    icon: "🚛",
    desc: "Site gate entry/exit log",
  },
  {
    id: "debit-note",
    label: "Debit Note",
    icon: "📉",
    desc: "Supplier debit note before it's finalized",
  },
  {
    id: "StockTransfer",
    label: "Stock Transfer",
    icon: "🔄",
    desc: "Stock only moves between godowns once this is fully approved",
  },
  {
    id: "SaleOrder",
    label: "Sale Order",
    icon: "🛍️",
    desc: "Inter-company / inter-project item sales",
  },
  {
    id: "JournalVoucher",
    label: "Journal Voucher",
    icon: "📒",
    desc: "Forceful account-head mismatch correction — approval is always restricted to super_admin regardless of who's assigned here",
  },
  {
    id: "InterCompanyTransfer",
    label: "Inter-Company Transfer",
    icon: "🏭",
    desc: "Approving fires the full auto-generated document chain (SO→SI→Payment→PO→GRN→Expense→Payment) — restricted to super_admin regardless of who's assigned here",
  },
  {
    id: "FundTransfer",
    label: "Fund Transfer",
    icon: "🏦",
    desc: "Bank-to-bank cash movement — inter-company transfers book as a loan on approval. Approval is always restricted to super_admin regardless of who's assigned here",
  },
  {
    id: "Contract",
    label: "Contract",
    icon: "📄",
    desc: "Auto-submitted for approval as soon as it's created — no Draft step",
  },
  {
    id: "BOQ",
    label: "BOQ",
    icon: "📐",
    desc: "Bill of Quantities before it's locked",
  },
  {
    id: "WorkDone",
    label: "Work Done",
    icon: "🏗️",
    desc: "Measured work-done entry before certification",
  },
  {
    id: "crm-agreements",
    label: "CRM Agreement (Senior Approval)",
    icon: "📝",
    desc: "Before an agreement is sent to the customer portal — approver roles here are always restricted to admin/super_admin/marketing_head regardless of who's assigned",
  },
  {
    id: "crm-agreement-date",
    label: "CRM Agreement (Date Approval)",
    icon: "📅",
    desc: "Once both sides' proposed dates match, before the Agreement Date is locked — restricted to super_admin regardless of who's assigned here",
  },
  {
    id: "crm-applications",
    label: "CRM Application",
    icon: "📥",
    desc: "Customer application before it converts to a booking",
  },
  {
    id: "crm-bookings",
    label: "CRM Booking",
    icon: "🏠",
    desc: "Unit booking confirmation",
  },
  {
    id: "crm-booking-amendment",
    label: "CRM Booking Amendment",
    icon: "✏️",
    desc: "Changes to an existing booking",
  },
  {
    id: "crm-sales-deed-senior",
    label: "CRM Sale Deed (Senior Approval)",
    icon: "📜",
    desc: "Senior sign-off on the Sale Deed",
  },
  {
    id: "crm-sales-deed-director",
    label: "CRM Sale Deed (Director Approval)",
    icon: "🖋️",
    desc: "Before Sale Deed registration proceeds — restricted to super_admin regardless of who's assigned here",
  },
  {
    id: "crm-registry-complete",
    label: "CRM Registry Complete",
    icon: "✅",
    desc: "Confirms the Sale Deed was registered at the Sub-Registrar",
  },
  {
    id: "crm-registry-cancel",
    label: "CRM Registry Cancel",
    icon: "❌",
    desc: "Cancels a registry step",
  },
  {
    id: "crm-mutation-approve",
    label: "CRM Mutation Approve",
    icon: "🗺️",
    desc: "Confirms the municipal authority's Khata transfer",
  },
  {
    id: "crm-query-payment-confirm",
    label: "CRM Query Payment Confirm",
    icon: "🧮",
    desc: "Confirms government stamp-duty/query fee payment",
  },
  {
    id: "crm-noc",
    label: "CRM NOC",
    icon: "🔓",
    desc: "Organisation & bank No-Objection Certificate",
  },
  {
    id: "crm-brokerage",
    label: "CRM Brokerage",
    icon: "🤝",
    desc: "Broker payment/brokerage record",
  },
  {
    id: "crm-cancellations",
    label: "CRM Cancellation",
    icon: "🚫",
    desc: "Booking cancellation",
  },
  {
    id: "crm-transfer-deeds",
    label: "Transfer Deed — Legal Head",
    icon: "⚖️",
    desc: "A resale's deed of assignment or a buy-back's cancellation deed, before it goes to the parties",
  },
  {
    id: "crm-transfer-deed-date",
    label: "Transfer Deed — Date Approval",
    icon: "📅",
    desc: "The signing date every party accepted, before it is fixed",
  },
  {
    id: "crm-resales",
    label: "Property Resale & Buy-back",
    icon: "🔁",
    desc: "A sold property passing to a new buyer, or bought back by us",
  },
  {
    id: "crm-ownership-changes",
    label: "Ownership Change",
    icon: "🏠",
    desc: "A new owner after the sale deed is registered, recorded from their own registered sale deed",
  },
  {
    id: "crm-credit-notes",
    label: "Credit Note (invoice reduced)",
    icon: "🧾",
    desc: "An invoice reduced without a refund — discount, area change, price correction",
  },
  {
    id: "crm-credit-note-cancel",
    label: "Credit Note — Cancellation",
    icon: "🚫",
    desc: "Cancelling an issued credit note (a GST document)",
  },
  {
    id: "crm-refunds",
    label: "CRM Refund",
    icon: "💸",
    desc: "Customer refund before it's paid out",
  },
] as const;

export type ModuleId = (typeof MODULE_OPTIONS)[number]["id"];

export const MODULE_GROUPS = [
  {
    id: "material",
    label: "Material",
    icon: "🏗️",
    modules: [
      "GRN",
      "PurchaseOrders",
      "MaterialIssues",
      "MaterialIssueReturn",
      "MaterialRequests",
      "InterCompanyTransfer",
      "VehicleInOut",
      "debit-note",
      "StockTransfer",
    ],
  },
  {
    id: "engineering",
    label: "Engineering",
    icon: "⚙️",
    modules: ["WorkOrderHeader", "BOQ", "WorkDone"],
  },
  {
    id: "finance",
    label: "Finance",
    icon: "💰",
    modules: ["NewPayment", "CrmRefundPayment", "Expenses", "JournalVoucher", "FundTransfer", "Contract"],
  },
  {
    id: "sales",
    label: "Sales",
    icon: "🛍️",
    modules: ["SaleOrder"],
  },
  {
    id: "crm",
    label: "CRM",
    icon: "🏠",
    modules: [
      "crm-applications",
      "crm-bookings",
      "crm-booking-amendment",
      "crm-agreements",
      "crm-agreement-date",
      "crm-sales-deed-director",
      "crm-sales-deed-senior",
      "crm-registry-complete",
      "crm-registry-cancel",
      "crm-mutation-approve",
      "crm-query-payment-confirm",
      "crm-noc",
      "crm-brokerage",
      "crm-refunds",
      "crm-resales",
      "crm-transfer-deeds",
      "crm-transfer-deed-date",
      "crm-ownership-changes",
      "crm-credit-notes",
      "crm-credit-note-cancel",
      "crm-cancellations",
    ],
  },
] as const;

export const APPROVAL_API = "/api/approval-workflows";

// ─── API helpers ──────────────────────────────────────────────────────────────

export async function fetchWorkflows(): Promise<ApprovalWorkflow[]> {
  const res = await fetchWithAuth(APPROVAL_API);
  if (!res.ok) throw new Error("Failed to fetch workflows");
  return res.json().catch(() => ({}));
}

export async function apiSave(
  body: Omit<ApprovalWorkflow, "id" | "createdAt">,
  id?: number,
) {
  const method = id ? "PUT" : "POST";
  const url = id ? `${APPROVAL_API}/${id}` : APPROVAL_API;
  const res = await fetchWithAuth(url, { method, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
  return res.json().catch(() => ({}));
}

export async function apiToggle(id: number) {
  const res = await fetchWithAuth(`${APPROVAL_API}/${id}/toggle`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error("Toggle failed");
}

export async function apiDelete(id: number) {
  const res = await fetchWithAuth(`${APPROVAL_API}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete failed");
}
