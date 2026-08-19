import { Chart2, Bank, Judge, DocumentText } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const buildFinanceNavItems = (_overdueCount: number): NavItem[] => [
  { label: "Proceeding", icon: Chart2, path: "/finance", pageKey: "finance-dashboard", isDashboard: true },
  { label: "Contract", icon: DocumentText, path: "/finance/contracts", pageKey: "finance-contracts" },
  {
    label: "Transaction",
    icon: Bank,
    children: [
      { label: "Invoice",          path: "/finance/invoice",   pageKey: "expense-booking" },
      { label: "Payment",           path: "/payments",               pageKey: "new-payment" },
      { label: "On A/C Adjustment", path: "/on-account-adjustment",  pageKey: "on-account-adjustment" },
      { label: "Received Payment",  path: "/received-payments",      pageKey: "received-payment" },
      { label: "Fund Transfer",     path: "/fund-transfer",          pageKey: "fund-transfer" },
      { label: "BRS",               path: "/brs",                    pageKey: "brs" },
      { label: "Cheque Cancellation", path: "/finance/cheque-cancellation", pageKey: "cheque-cancellation" },
    ],
  },
  { label: "Journal Voucher", icon: DocumentText, path: "/journal-voucher", pageKey: "journal-voucher" },
  {
    label: "Query",
    icon: Judge,
    children: [
      { label: "Trial Balance",      path: "/trial-balance",       pageKey: "trial-balance" },
      { label: "Balance Sheet",      path: "/balance-sheet",       pageKey: "balance-sheet" },
      { label: "Profit & Loss",      path: "/profit-and-loss",     pageKey: "profit-and-loss" },
      { label: "Balance Enquiry",    path: "/finance/balance-enquiry", pageKey: "balance-enquiry" },
      { label: "Year-End Close",      path: "/finance/year-end-close",  pageKey: "year-end-close" },
    ],
  },
];
