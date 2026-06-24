import {
  BarChart3,
  Receipt,
  ClipboardList,
  ArrowLeftRight,
  Repeat2,
  FilePenLine,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const materialNavItems: NavItem[] = [
  { label: "Proceeding", icon: BarChart3, path: "/material", pageKey: "material-dashboard" },
  {
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "Material Request", path: "/material/material-request", pageKey: "material-request" },
      { label: "Purchase Order",   path: "/material/purchase-order",   pageKey: "purchase-orders" },
      { label: "Vehicle In/Out",   path: "/material/vehicle-in-out",   pageKey: "vehicle-in-out" },
      { label: "GRN",              path: "/material/grn",              pageKey: "grn-master" },
      { label: "Issues",           path: "/material/issues",           pageKey: "material-issues" },
      { label: "Invoice",          path: "/material/expense-booking",  pageKey: "expense-booking" },
    ],
  },
  { label: "Stock",          icon: ArrowLeftRight, path: "/material/stock",          pageKey: "stock-ledger" },
  { label: "Transfer",       icon: Repeat2,        path: "/material/stock-transfer", pageKey: "stock-transfers" },
  { label: "Debit Note",     icon: ClipboardList,  path: "/material/debit-note",     pageKey: "debit-note" },
  { label: "Amendment Menu", icon: FilePenLine,    path: "/material/amendment-menu", pageKey: "amendments" },
];
