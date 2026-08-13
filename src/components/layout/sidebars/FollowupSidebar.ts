import { Category2, TickCircle } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  { label: "Follow-Up", icon: Category2, path: "/followup", pageKey: "followup-dashboard", isDashboard: true },
  { label: "Close Task", icon: TickCircle, path: "/followup/close-tasks", pageKey: "followup-close-tasks" },
];
