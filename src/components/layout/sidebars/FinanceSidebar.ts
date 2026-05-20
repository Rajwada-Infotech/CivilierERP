import { BarChart3, Landmark, Scale } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const buildFinanceNavItems = (_overdueCount: number): NavItem[] => [
  { label: "Proceeding", icon: BarChart3, path: "/finance" },
  {
    label: "Transaction",
    icon: Landmark,
    children: [
      { label: "Payment", path: "/payments" },
      { label: "Received Payment", path: "/received-payments" },
      { label: "BRS", path: "/brs" },
    ],
  },
  {
    label: "Query",
    icon: Scale,
    children: [{ label: "Trial Balance", path: "/transactions" }],
  },
];
