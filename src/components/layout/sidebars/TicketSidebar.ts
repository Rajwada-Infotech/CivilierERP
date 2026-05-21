import {
  BarChart3,
  MessageSquare,
  Plus,
  FileText,
  Clock,
  CheckCircle2,
  LayoutList,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const buildTicketNavItems = (isAdminUser: boolean): NavItem[] => [
  { label: "Dashboard", icon: BarChart3, path: "/ticket" },
  {
    label: "Tickets",
    icon: MessageSquare,
    children: [
      { label: "Create Ticket", path: "/ticket/create" },
      { label: "My Tickets", path: "/ticket/my-tickets" },
      // Admin-only items
      ...(isAdminUser
        ? [
            { label: "All Tickets", path: "/ticket/all" },
            { label: "Pending Tickets", path: "/ticket/pending" },
          ]
        : []),
      { label: "Resolved Tickets", path: "/ticket/resolved" },
    ],
  },
];
