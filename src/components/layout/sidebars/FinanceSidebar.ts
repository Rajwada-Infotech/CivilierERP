import { Chart2, Bank, Judge, DocumentText } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const buildFinanceNavItems = (_overdueCount: number): NavItem[] => [
  { label: "Proceeding", icon: Chart2, path: "/finance", pageKey: "finance-dashboard", isDashboard: true },
  {
    label: "Transaction",
    icon: Bank,
    children: [
      { label: "Invoice",          path: "/finance/invoice",   pageKey: "expense-booking" },
      { label: "Payment",          path: "/payments",          pageKey: "new-payment" },
      { label: "Received Payment", path: "/received-payments", pageKey: "received-payment" },
      { label: "BRS",              path: "/brs",               pageKey: "brs" },
    ],
  },
  { label: "Journal Voucher", icon: DocumentText, path: "/journal-voucher", pageKey: "journal-voucher" },
  {
    label: "Query",
    icon: Judge,
    children: [
      { label: "Trial Balance", path: "/trial-balance", pageKey: "trial-balance" },
    ],
  },
];
