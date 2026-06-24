import { BarChart3, Landmark, Scale } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const buildFinanceNavItems = (_overdueCount: number): NavItem[] => [
  { label: "Proceeding", icon: BarChart3, path: "/finance", pageKey: "finance-dashboard" },
  {
    label: "Transaction",
    icon: Landmark,
    children: [
      { label: "Payment",          path: "/payments",          pageKey: "new-payment" },
      { label: "Received Payment", path: "/received-payments", pageKey: "received-payment" },
      { label: "BRS",              path: "/brs",               pageKey: "brs" },
    ],
  },
  {
    label: "Query",
    icon: Scale,
    children: [
      { label: "Trial Balance", path: "/transactions", pageKey: "transactions" },
    ],
  },
];
