// RN port of MenuRights.tsx's ALL_ACTIONS / MODULE_COLORS / ROLE_PRESETS
// (web) — same 7 actions, same preset definitions, module colors as hex
// instead of Tailwind classes.
export const ALL_ACTIONS: { key: string; label: string }[] = [
  { key: "view", label: "View" },
  { key: "create", label: "Add" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "print", label: "Print" },
  { key: "export", label: "Export" },
  { key: "post-approval", label: "Post-Appr." },
];

export const MODULE_COLORS: Record<string, string> = {
  General: "#94a3b8",
  Finance: "#10b981",
  Material: "#3b82f6",
  Engineering: "#f97316",
  "Follow-Up": "#14b8a6",
  Ticket: "#ef4444",
  Sales: "#ec4899",
  "Civil Work DPR": "#06b6d4",
  Masters: "#06b6d4",
  Reports: "#eab308",
};

export const ROLE_PRESETS: Record<string, { label: string; pages: string[]; actions: string[] }> = {
  engineer: {
    label: "Engineer",
    pages: [
      "dashboard", "engineering-dashboard", "boq", "engineering-work-order", "work-done",
      "purchase-orders", "grn-master", "work-order", "material-request", "stock-ledger",
      "tickets", "followup-applicants", "followup-bookings", "reports", "tasks",
    ],
    actions: ["view", "create", "edit"],
  },
  finance: {
    label: "Finance",
    pages: [
      "dashboard", "finance-dashboard", "expense-booking", "new-payment", "received-payment",
      "bank-master", "account-head", "general-ledger", "cheque-master", "brs",
      "debit-note", "amendments", "reports", "tasks",
    ],
    actions: ["view", "create", "edit", "print", "export"],
  },
  store: {
    label: "Store Manager",
    pages: [
      "dashboard", "material-dashboard", "purchase-orders", "grn-master", "work-order",
      "material-request", "material-issues", "stock-ledger", "stock-transfers",
      "inventory-master", "item-master", "item-group", "reports", "tasks",
    ],
    actions: ["view", "create", "edit", "print", "export"],
  },
  sales: {
    label: "Sales",
    pages: ["dashboard", "sale-order", "sale-invoice", "sales-payment", "reports", "tasks"],
    actions: ["view", "create", "edit", "print", "export"],
  },
  viewer: {
    label: "View Only",
    pages: [], // resolved against every loaded page def at apply-time
    actions: ["view"],
  },
};
