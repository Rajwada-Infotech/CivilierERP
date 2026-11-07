// RN port of src/pages/admin/approvalInbox/config.tsx (web): the same modules with the same endpoints, labels and
// approval-gate suffixes, the same business categories and order (Material, Finance, Engineering, Civil Work DPR,
// Sales / CRM, Admin), and the same rules for the rows that cannot be approved in one tap here. The drawing sheet has no
// per-module colours, so a module is told by its icon and name. navPath / "Open in module" is dropped: none of those
// module screens exist in this app to open.
import {
  ClipboardCheck, ClipboardList, Package, PackageOpen, Hammer, Banknote, Truck, Receipt, ArrowDownCircle, ArrowLeftRight,
  ShoppingCart, Building2, Home, Car, FileText, Undo2, Warehouse, Landmark, UserCheck, XCircle, FileWarning, ShieldCheck,
} from "lucide-react-native";
import type { InboxItem } from "@/api/approvalInboxApi";

export interface ModuleCfg {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  apiEndpoint: string;
  label: string;
}

export const MODULE_CONFIG: Record<string, ModuleCfg> = {
  "purchase-orders": { icon: Package, apiEndpoint: "/api/purchase-orders", label: "Purchase Orders" },
  "work-orders": { icon: Hammer, apiEndpoint: "/api/work-orders", label: "Work Orders" },
  payments: { icon: Banknote, apiEndpoint: "/api/new-payment", label: "Payments" },
  "crm-refund-payment": { icon: Banknote, apiEndpoint: "/api/new-payment", label: "Refund payment" },
  "goods-receipt": { icon: Truck, apiEndpoint: "/api/grns", label: "GRNs" },
  "expense-booking": { icon: Receipt, apiEndpoint: "/api/expense-booking", label: "Invoices" },
  "received-payment": { icon: ArrowDownCircle, apiEndpoint: "/api/received-payment", label: "Received Payments" },
  "work-done": { icon: Hammer, apiEndpoint: "/api/engineering/work-done", label: "Work Done" },
  boq: { icon: ClipboardCheck, apiEndpoint: "/api/boq", label: "BOQ" },
  "material-requests": { icon: ClipboardList, apiEndpoint: "/api/material-requests", label: "Material Requests" },
  "material-issues": { icon: PackageOpen, apiEndpoint: "/api/material-issues", label: "Material Issues" },
  "material-issue-return": { icon: Undo2, apiEndpoint: "/api/material-issue-return", label: "Material Issue Returns" },
  "sale-orders": { icon: ShoppingCart, apiEndpoint: "/api/sale-orders", label: "Sale Orders" },
  "vehicle-in-out": { icon: Car, apiEndpoint: "/api/vehicle-in-out", label: "Vehicle In/Out" },
  "stock-transfers": { icon: Warehouse, apiEndpoint: "/api/stock-transfers", label: "Stock Transfer" },
  "journal-voucher": { icon: Receipt, apiEndpoint: "/api/journal-voucher", label: "Journal Vouchers" },
  "inter-company-transfer": { icon: ArrowLeftRight, apiEndpoint: "/api/inter-company-transfer", label: "Inter-Company Transfers" },
  "fund-transfer": { icon: Landmark, apiEndpoint: "/api/fund-transfer", label: "Fund Transfers" },
  "work-allocation-engineer": { icon: UserCheck, apiEndpoint: "/api/dependency-activity-assignment", label: "Activity Assignments" },
  "crm-applications": { icon: ClipboardList, apiEndpoint: "/api/crm/applications", label: "CRM Applications" },
  "crm-bookings": { icon: Home, apiEndpoint: "/api/crm/bookings", label: "CRM Bookings" },
  "crm-agreements": { icon: Building2, apiEndpoint: "/api/crm/agreements", label: "CRM Agreements" },
  "crm-agreement-date": { icon: ClipboardList, apiEndpoint: "/api/crm/agreements", label: "CRM Agreement Date" },
  "crm-sales-deed-director": { icon: Building2, apiEndpoint: "/api/crm/sales-deed", label: "CRM Sales Deed (Director)" },
  "crm-brokerage": { icon: Receipt, apiEndpoint: "/api/crm/brokerage", label: "CRM Brokerage" },
  "crm-cancellations": { icon: XCircle, apiEndpoint: "/api/crm/cancellations", label: "CRM Cancellations" },
  "crm-noc": { icon: ClipboardCheck, apiEndpoint: "/api/crm/noc", label: "CRM NOC" },
  "crm-booking-amendment": { icon: Car, apiEndpoint: "/api/crm/booking-amendments", label: "Booking Amendments" },
  "crm-transfer-deeds": { icon: ClipboardList, apiEndpoint: "/api/crm/transfer-deeds", label: "Transfer Deed (Legal Head)" },
  "crm-transfer-deed-date": { icon: ClipboardList, apiEndpoint: "/api/crm/transfer-deeds", label: "Transfer Deed (Date)" },
  "crm-resales": { icon: Undo2, apiEndpoint: "/api/crm/resales", label: "Property Resale & Buy-back" },
  "crm-credit-notes": { icon: Undo2, apiEndpoint: "/api/crm/refunds/gst-notes", label: "Credit Note" },
  "crm-credit-note-cancel": { icon: Undo2, apiEndpoint: "/api/crm/refunds/gst-notes/cancel-requests", label: "Credit Note (cancel)" },
  "crm-ownership-changes": { icon: Undo2, apiEndpoint: "/api/crm/ownership-changes", label: "Ownership Change" },
  "crm-refunds": { icon: Undo2, apiEndpoint: "/api/crm/refunds", label: "CRM Refunds" },
  "crm-refunds-finance": { icon: Undo2, apiEndpoint: "/api/crm/refunds", label: "CRM Refunds (Finance)" },
  contracts: { icon: FileText, apiEndpoint: "/api/contract", label: "Contracts" },
  "debit-note": { icon: FileWarning, apiEndpoint: "/api/debit-note", label: "Debit Notes" },
  "civilworkdpr-approval": { icon: ShieldCheck, apiEndpoint: "/api/dependency-activity-assignment", label: "Activity Approvals" },
};

export const ALL_MODULES = Object.keys(MODULE_CONFIG);

/** Records with more than one independent approval gate: the gate's name goes into the action path. */
export const SUB_GATE_SUFFIX: Record<string, string> = {
  "crm-transfer-deeds": "legal",
  "crm-transfer-deed-date": "date",
  "crm-agreement-date": "date",
  "crm-sales-deed-director": "director",
  "crm-refunds-finance": "finance",
};

export type CategoryId = "material" | "finance" | "engineering" | "civilworkdpr" | "sales" | "admin";
export const CATEGORY_LABEL: Record<CategoryId, string> = {
  material: "Material",
  finance: "Finance",
  engineering: "Engineering",
  civilworkdpr: "Civil Work DPR",
  sales: "Sales / CRM",
  admin: "Admin",
};
export const CATEGORY_ORDER: CategoryId[] = ["material", "finance", "engineering", "civilworkdpr", "sales", "admin"];

// Declaration order doubles as the module order within a category (Material Requests before Purchase Orders before
// GRNs …), so each module's rows stay together.
const MODULE_CATEGORY: Record<string, CategoryId> = {
  "material-requests": "material", "purchase-orders": "material", "work-orders": "material", "goods-receipt": "material",
  "material-issues": "material", "material-issue-return": "material", "vehicle-in-out": "material", "stock-transfers": "material",
  "inter-company-transfer": "material", "debit-note": "material",
  "expense-booking": "finance", payments: "finance", "crm-refund-payment": "finance", "received-payment": "finance",
  "journal-voucher": "finance", "fund-transfer": "finance", contracts: "finance",
  "work-done": "engineering", boq: "engineering",
  "civilworkdpr-approval": "civilworkdpr", "work-allocation-engineer": "civilworkdpr",
  "sale-orders": "sales", "crm-bookings": "sales", "crm-agreements": "sales", "crm-agreement-date": "sales",
  "crm-sales-deed-director": "sales", "crm-brokerage": "sales", "crm-cancellations": "sales", "crm-noc": "sales",
  "crm-booking-amendment": "sales", "crm-refunds": "sales", "crm-resales": "sales", "crm-transfer-deeds": "sales",
  "crm-transfer-deed-date": "sales", "crm-ownership-changes": "sales", "crm-credit-notes": "sales", "crm-credit-note-cancel": "sales",
};
export const categoryOf = (mod: string): CategoryId => MODULE_CATEGORY[mod] ?? "admin";
const MODULE_ORDER: Record<string, number> = Object.fromEntries(Object.keys(MODULE_CATEGORY).map((m, i) => [m, i]));
export const moduleOrderOf = (mod: string) => MODULE_ORDER[mod] ?? Number.MAX_SAFE_INTEGER;
/** Modules listed inside another module's group: a refund payout IS a payment. */
export const DISPLAY_GROUP: Record<string, string> = { "crm-refund-payment": "payments" };

/** A CRM received payment Accounts hasn't given a deposit bank yet: the server refuses Approve until it has one. */
export const needsBankReview = (item: Pick<InboxItem, "Module" | "Status" | "NeedsReview">) =>
  item.Module === "received-payment" && item.Status === "Pending" && !!item.NeedsReview;

/**
 * Modules whose one-tap Approve can't succeed (a booking's review checklist, a refund's company bank) or shouldn't be
 * blind (a brokerage's amount is only editable before approval). The web hands these to their own review page; this app
 * has no such page, so it says where to finish the approval. Reject is unaffected.
 */
export const REVIEW_INSTEAD: Record<string, string> = {
  "crm-bookings": "Approve this booking after its review checklist, in the web app.",
  "crm-brokerage": "Review the brokerage amount and approve it in the web app.",
  "crm-refunds-finance": "Finance approval needs the company bank picked, in the web app.",
};
