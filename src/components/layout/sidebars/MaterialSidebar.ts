import { Chart2, Receipt21, ClipboardText, ArrowSwapHorizontal, Repeat, TrendUp, Cpu, Archive } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const materialNavItems: NavItem[] = [
  { label: "Proceeding", icon: Chart2, path: "/material", pageKey: "material-dashboard", isDashboard: true },
  {
    label: "Transaction",
    icon: Receipt21,
    children: [
      { label: "Material Request", path: "/material/material-request", pageKey: "material-request" },
      { label: "Quotation",        path: "/material/quotation",        pageKey: "quotation" },
      { label: "Purchase Order",   path: "/material/purchase-order",   pageKey: "purchase-orders" },
      { label: "Vehicle In/Out",   path: "/material/vehicle-in-out",   pageKey: "vehicle-in-out" },
      { label: "GRN",              path: "/material/grn",              pageKey: "grn-master" },
      { label: "Issues",           path: "/material/issues",           pageKey: "material-issues" },
      { label: "Issue Return",     path: "/material/issue-return",     pageKey: "material-issue-return" },
    ],
  },
  { label: "Short Close",    icon: Archive,       path: "/material/short-close",    pageKey: "short-close" },
  { label: "L1 Chart",       icon: TrendUp,       path: "/material/l1-chart",       pageKey: "l1-chart" },
  { label: "Stock",          icon: ArrowSwapHorizontal, path: "/material/stock",          pageKey: "stock-ledger" },
  { label: "Transfer",       icon: Repeat,        path: "/material/stock-transfer", pageKey: "stock-transfers" },
  { label: "Debit Note",     icon: ClipboardText,  path: "/material/debit-note",     pageKey: "debit-note" },
  { label: "Fixed Asset Record", icon: Cpu, path: "/material/fixed-asset-record", pageKey: "fixed-asset-record" },
];
