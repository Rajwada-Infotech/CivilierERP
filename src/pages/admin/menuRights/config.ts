// Menu Rights' catalogue: the actions a page can grant, module colours and the role presets.


// ─── TYPES ───────────────────────────────────────────────────────────────────
export type PageAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "print"
  | "export"
  | "import"
  | "post-approval";

export interface PageDef {
  key: string;
  label: string;
  group: string;
  module: string;
  actions: PageAction[];
}

// ─── ALL ACTIONS ─────────────────────────────────────────────────────────────
export const ALL_ACTIONS: { key: PageAction; label: string }[] = [
  { key: "view", label: "View" },
  { key: "create", label: "Add" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "print", label: "Print" },
  { key: "export", label: "Export" },
  { key: "import", label: "Import" },
  { key: "post-approval", label: "Post-Approval" },
];

// ─── MODULE COLORS ────────────────────────────────────────────────────────────
export const MODULE_COLORS: Record<string, string> = {
  General: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  Finance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Material: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Engineering: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "Follow-Up": "bg-teal-500/10 text-teal-600 border-teal-500/20",
  Ticket: "bg-red-500/10 text-red-400 border-red-500/20",
  Sales: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  "Civil Work DPR": "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Masters: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Reports: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};

// ─── PRESET TEMPLATES ─────────────────────────────────────────────────────────
// Presets reference page keys — these are stable identifiers so hardcoding is fine.
export const ROLE_PRESETS: Record<
  string,
  { label: string; pages: string[]; actions: PageAction[] }
> = {
  engineer: {
    label: "Engineer",
    pages: [
      "dashboard",
      "engineering-dashboard",
      "boq",
      "engineering-work-order",
      "work-done",
      "purchase-orders",
      "grn-master",
      "work-order",
      "material-request",
      "stock-ledger",
      "tickets",
      "followup-applicants",
      "followup-bookings",
      "reports",
      "tasks",
    ],
    actions: ["view", "create", "edit"],
  },
  finance: {
    label: "Finance",
    pages: [
      "dashboard",
      "finance-dashboard",
      "expense-booking",
      "new-payment",
      "received-payment",
      "bank-master",
      "account-head",
      "general-ledger",
      "cheque-master",
      "brs",
      "debit-note",
      "reports",
      "tasks",
    ],
    actions: ["view", "create", "edit", "print", "export"],
  },
  store: {
    label: "Store Manager",
    pages: [
      "dashboard",
      "material-dashboard",
      "purchase-orders",
      "grn-master",
      "work-order",
      "material-request",
      "material-issues",
      "stock-ledger",
      "stock-transfers",
      "stock-update",
      "inventory-master",
      "item-master",
      "item-group",
      "reports",
      "tasks",
    ],
    actions: ["view", "create", "edit", "print", "export"],
  },
  sales: {
    label: "Sales",
    pages: [
      "dashboard",
      "sale-order",
      "sale-invoice",
      "sales-payment",
      "reports",
      "tasks",
    ],
    actions: ["view", "create", "edit", "print", "export"],
  },
  viewer: {
    label: "View Only",
    // "All pages" preset — resolved at runtime against the live DB list
    pages: [],
    actions: ["view"],
  },
};
