import { ShoppingCart, Receipt, CreditCard } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const salesNavItems: NavItem[] = [
  { label: "Sale Order",   icon: ShoppingCart, path: "/sales/sale-order",   pageKey: "sale-order" },
  { label: "Sale Invoice", icon: Receipt,      path: "/sales/sale-invoice", pageKey: "sale-invoice" },
  { label: "Payment",      icon: CreditCard,   path: "/sales/payment",      pageKey: "sales-payment" },
];
