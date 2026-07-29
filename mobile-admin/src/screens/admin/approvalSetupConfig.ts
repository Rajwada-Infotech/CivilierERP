// RN port of ApprovalSetup.tsx's MODULE_OPTIONS / MODULE_GROUPS /
// APPROVAL_TYPES (web) — same modules, same emoji icons (kept as literal
// strings, same as web, rather than mapped to lucide icons), same three
// approval styles.
import { ArrowDown, Users, GitBranch } from "lucide-react-native";

export const MODULE_OPTIONS = [
  { id: "GRN", label: "Goods Receipt (GRN)", icon: "📦", desc: "When goods arrive at site" },
  { id: "PurchaseOrders", label: "Purchase Order", icon: "🛒", desc: "Before a PO is raised" },
  { id: "MaterialIssues", label: "Material Issue", icon: "🚚", desc: "When materials leave store" },
  { id: "Expenses", label: "Expense Booking", icon: "🧾", desc: "Staff expense claims" },
  { id: "WorkOrderHeader", label: "Work Order", icon: "🔧", desc: "Before work begins" },
  { id: "NewPayment", label: "Payment", icon: "💳", desc: "Before payments are made" },
  { id: "StockTransfer", label: "Stock Transfer", icon: "🔄", desc: "Moving stock between sites" },
  { id: "SaleOrder", label: "Sale Order", icon: "🛍️", desc: "Inter-company / inter-project item sales" },
  { id: "JournalVoucher", label: "Journal Voucher", icon: "📒", desc: "Forceful account-head mismatch correction — approval is always restricted to super_admin regardless of who's assigned here" },
  { id: "InterCompanyTransfer", label: "Inter-Company Transfer", icon: "🏭", desc: "Approving fires the full auto-generated document chain (SO→SI→Payment→PO→GRN→Expense→Payment) — restricted to super_admin regardless of who's assigned here" },
  { id: "Contract", label: "Contract", icon: "📄", desc: "Auto-submitted for approval as soon as it's created — no Draft step" },
  { id: "crm-agreements", label: "CRM Agreement (Senior Approval)", icon: "📝", desc: "Before an agreement is sent to the customer portal — approver roles here are always restricted to admin/super_admin/marketing_head regardless of who's assigned" },
] as const;

export const MODULE_GROUPS = [
  { id: "material", label: "Material", icon: "🏗️", modules: ["GRN", "PurchaseOrders", "MaterialIssues", "Expenses", "StockTransfer", "InterCompanyTransfer"] },
  { id: "finance", label: "Finance", icon: "💰", modules: ["NewPayment", "JournalVoucher", "Contract"] },
  { id: "engineering", label: "Engineering", icon: "⚙️", modules: ["WorkOrderHeader"] },
  { id: "sales", label: "Sales", icon: "🛍️", modules: ["SaleOrder"] },
  { id: "crm", label: "CRM", icon: "🏠", modules: ["crm-agreements"] },
] as const;

export const APPROVAL_TYPES = [
  {
    id: "sequential" as const,
    label: "One by one",
    icon: ArrowDown,
    desc: "Each person must approve before the next is asked. Like a chain — first Manager, then Director.",
    example: "Manager → Director → CFO",
  },
  {
    id: "any" as const,
    label: "Anyone can approve",
    icon: Users,
    desc: "Any one person from the list can approve. Useful when multiple people share the same role.",
    example: "Manager A or Manager B",
  },
  {
    id: "parallel" as const,
    label: "Everyone at once",
    icon: GitBranch,
    desc: "All approvers are asked at the same time. All must approve before it moves forward.",
    example: "Manager + Director + CFO (simultaneously)",
  },
] as const;
