import { BarChart3, Receipt, ClipboardList, FilePenLine } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const engineeringNavItems: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/engineering", pageKey: "engineering-dashboard", isDashboard: true },
  {
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "BOQ",        path: "/engineering/boq",        pageKey: "boq" },
      { label: "Work Order", path: "/engineering/work-order", pageKey: "engineering-work-order" },
      { label: "Work Done",  path: "/engineering/work-done",  pageKey: "work-done" },
    ],
  },
  { label: "DPR",       icon: ClipboardList, path: "/engineering/dpr",              pageKey: "dpr" },
  { label: "Amendment", icon: FilePenLine,   path: "/engineering/amendment-menu",   pageKey: "amendments" },
];
