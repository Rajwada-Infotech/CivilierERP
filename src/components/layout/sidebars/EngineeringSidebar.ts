import { BarChart3, Receipt } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const engineeringNavItems: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/engineering" },
  {
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "BOQ", path: "/engineering/boq" },
      { label: "Work Order", path: "/engineering/work-order" },
      { label: "Work Done", path: "/engineering/work-done" },
    ],
  },
];
