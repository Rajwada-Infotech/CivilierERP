import {
  BarChart3,
  Receipt,
  ClipboardList,
  Truck,
  PackageOpen,
  BookOpen,
  FileEdit,
  FileWarning,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const materialNavItems: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/material" },
  {
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "Material Request", path: "/material/material-request" },
      { label: "Purchase Order", path: "/material/purchase-order" },
      { label: "GRN", path: "/material/grn" },
      { label: "Issues", path: "/material/issues" },
      { label: "Expense Booking", path: "/material/expense-booking" },
    ],
  },
  { label: "Debit Note", icon: FileWarning, path: "/material/debit-note" },
  { label: "Amendment Menu", icon: FileEdit, path: "/material/amendment-menu" },
];
