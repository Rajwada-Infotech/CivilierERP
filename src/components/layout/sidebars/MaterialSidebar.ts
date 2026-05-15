import { BarChart3, Receipt, FileEdit } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const materialNavItems: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/material" },
  {
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "Purchase Order", path: "/material/purchase-order" },
      { label: "GRN",            path: "/material/grn" },
      { label: "Stock Ledger",   path: "/material/stock-ledger" },
    ],
  },
  { label: "Amendment Menu", icon: FileEdit, path: "/material/amendment-menu" },
];