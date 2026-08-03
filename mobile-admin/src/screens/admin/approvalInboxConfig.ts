// RN port of ApprovalInbox.tsx's MODULE_CONFIG / MODULE_APPROVAL_TABLE /
// SUB_GATE_SUFFIX (web) — same modules, same endpoints, same colors (as hex
// instead of Tailwind classes). navPath/openInModulePath is dropped: none
// of these module screens exist on mobile-admin yet, so there's nowhere to
// deep-link to.
import {
  ClipboardCheck, ClipboardList, Package, PackageOpen, Hammer, Banknote,
  Truck, Receipt, ArrowDownCircle, ArrowLeftRight, ShoppingCart, Building2,
  Home, Car, FileText,
} from "lucide-react-native";

export interface ModuleCfg {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  apiEndpoint: string;
  label: string;
}

export const MODULE_CONFIG: Record<string, ModuleCfg> = {
  "purchase-orders": { icon: Package, color: "#3b82f6", apiEndpoint: "/api/purchase-orders", label: "Purchase Orders" },
  "work-orders": { icon: Hammer, color: "#f59e0b", apiEndpoint: "/api/work-orders", label: "Work Orders" },
  payments: { icon: Banknote, color: "#10b981", apiEndpoint: "/api/new-payment", label: "Payments" },
  "goods-receipt": { icon: Truck, color: "#8b5cf6", apiEndpoint: "/api/grns", label: "GRNs" },
  "expense-booking": { icon: Receipt, color: "#f43f5e", apiEndpoint: "/api/expense-booking", label: "Expense Bookings" },
  "received-payment": { icon: ArrowDownCircle, color: "#14b8a6", apiEndpoint: "/api/received-payment", label: "Received Payments" },
  "work-done": { icon: Hammer, color: "#059669", apiEndpoint: "/api/engineering/work-done", label: "Work Done" },
  boq: { icon: ClipboardCheck, color: "#6366f1", apiEndpoint: "/api/boq", label: "BOQ" },
  "material-requests": { icon: ClipboardList, color: "#f97316", apiEndpoint: "/api/material-requests", label: "Material Requests" },
  "material-issues": { icon: PackageOpen, color: "#06b6d4", apiEndpoint: "/api/material-issues", label: "Material Issues" },
  "sale-orders": { icon: ShoppingCart, color: "#d946ef", apiEndpoint: "/api/sale-orders", label: "Sale Orders" },
  "vehicle-in-out": { icon: Car, color: "#0ea5e9", apiEndpoint: "/api/vehicle-in-out", label: "Vehicle In/Out" },
  "journal-voucher": { icon: Receipt, color: "#d97706", apiEndpoint: "/api/journal-voucher", label: "Journal Vouchers" },
  "inter-company-transfer": { icon: ArrowLeftRight, color: "#c026d3", apiEndpoint: "/api/inter-company-transfer", label: "Inter-Company Transfers" },
  "crm-applications": { icon: ClipboardList, color: "#0ea5e9", apiEndpoint: "/api/crm/applications", label: "CRM Applications" },
  "crm-bookings": { icon: Home, color: "#f97316", apiEndpoint: "/api/crm/bookings", label: "CRM Bookings" },
  "crm-agreements": { icon: Building2, color: "#6366f1", apiEndpoint: "/api/crm/agreements", label: "CRM Agreements" },
  "crm-agreement-date": { icon: ClipboardList, color: "#6366f1", apiEndpoint: "/api/crm/agreements", label: "CRM Agreement Date" },
  "crm-sales-deed-director": { icon: Building2, color: "#a855f7", apiEndpoint: "/api/crm/sales-deed", label: "CRM Sales Deed (Director)" },
  "crm-brokerage": { icon: Receipt, color: "#f59e0b", apiEndpoint: "/api/crm/brokerage", label: "CRM Brokerage" },
  "crm-cancellations": { icon: ClipboardCheck, color: "#f43f5e", apiEndpoint: "/api/crm/cancellations", label: "CRM Cancellations" },
  "crm-noc": { icon: ClipboardCheck, color: "#14b8a6", apiEndpoint: "/api/crm/noc", label: "CRM NOC" },
  contracts: { icon: FileText, color: "#a855f7", apiEndpoint: "/api/contract", label: "Contracts" },
};

export const ALL_MODULES = Object.keys(MODULE_CONFIG);

// Records with more than one independent approval gate need this suffix
// inserted into the action path — see runApprovalAction / web's
// ApprovalActions.tsx actionPathSuffix.
export const SUB_GATE_SUFFIX: Record<string, string> = {
  "crm-agreement-date": "date",
  "crm-sales-deed-director": "director",
};
