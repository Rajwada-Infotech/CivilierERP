import { BarChart3, Landmark, Scale, Archive } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const buildFinanceNavItems = (overdueCount: number): NavItem[] => [
  { label: "Dashboard", icon: BarChart3, path: "/finance" },
  {
    label: "Transaction",
    icon: Landmark,
    children: [
      { label: "Expense Booking", path: "/material/expense-booking" },
      { label: "Debit Note", path: "/masters/debit-note" },
      { label: "Received Payment", path: "/received-payments" },
      { label: "BRS", path: "/brs" },
      { label: "TDS", path: "/masters/tds" },
      { label: "EMI", path: "/payments" },
    ],
  },
  {
    label: "Query",
    icon: Scale,
    children: [
      { label: "Trial Balance", path: "/transactions" },
      {
        label: "Tasks",
        path: "/tasks",
        badge: overdueCount > 0 ? overdueCount : undefined,
      },
    ],
  },
  {
    label: "Record Management",
    icon: Archive,
    children: [{ label: "Records", path: "/records" }],
  },
];
