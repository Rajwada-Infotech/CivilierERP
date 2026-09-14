import { Chart2, ShoppingCart, Receipt21, Card } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const salesNavItems: NavItem[] = [
  { label: "Dashboard",    icon: Chart2,     path: "/sales",              pageKey: "sales-dashboard", isDashboard: true },
  { label: "Sale Order",   icon: ShoppingCart, path: "/sales/sale-order",   pageKey: "sale-order" },
  { label: "Sale Invoice", icon: Receipt21,      path: "/sales/sale-invoice", pageKey: "sale-invoice" },
  { label: "Payment",      icon: Card,   path: "/sales/payment",      pageKey: "sales-payment" },
];
