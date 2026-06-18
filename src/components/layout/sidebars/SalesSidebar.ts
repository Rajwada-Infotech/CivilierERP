import { ShoppingCart, CreditCard } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const salesNavItems: NavItem[] = [
  { label: "Sale Order", icon: ShoppingCart, path: "/sales/sale-order" },
  { label: "Payment", icon: CreditCard, path: "/sales/payment" },
];
