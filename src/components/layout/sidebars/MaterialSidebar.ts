import {
  BarChart3,
  Receipt,
  ClipboardList,
  ArrowLeftRight,
  Repeat2,
  FilePenLine,
  IdCard,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const materialNavItems: NavItem[] = [
  { label: "Proceeding", icon: BarChart3, path: "/material" },
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
  { label: "Stock", icon: ArrowLeftRight, path: "/material/stock" },
  { label: "Transfer", icon: Repeat2, path: "/material/stock-transfer" },
  { label: "Debit Note", icon: ClipboardList, path: "/material/debit-note" },
  {
    label: "Amendment Menu",
    icon: FilePenLine,
    path: "/material/amendment-menu",
  },
];
