import { MoneyRecive, DocumentText } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const loanNavItems: NavItem[] = [
  { label: "Dashboard", icon: MoneyRecive, path: "/loan", isDashboard: true, pageKey: "loan-dashboard" },
  { label: "Loan Sanction", icon: DocumentText, path: "/loan/sanction", pageKey: "loan-sanction" },
];
