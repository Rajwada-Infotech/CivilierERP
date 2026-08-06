import { MoneyRecive, DocumentText } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const loanNavItems: NavItem[] = [
  { label: "Dashboard", icon: MoneyRecive, path: "/loan", isDashboard: true },
  { label: "Loan Sanction", icon: DocumentText, path: "/loan/sanction" },
];
