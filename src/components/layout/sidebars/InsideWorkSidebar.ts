import { BarChart3, FileClock } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const insideWorkNavItems: NavItem[] = [
  {
    label: "Dashboard",
    icon: BarChart3,
    path: "/insidework",
    pageKey: "insidework-dashboard",
  },
  {
    label: "Activity",
    icon: FileClock,
    path: "/insidework/activity",
    pageKey: "insidework-activity",
  },
];
