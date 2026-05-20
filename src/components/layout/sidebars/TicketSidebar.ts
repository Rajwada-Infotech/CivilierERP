import {
  BarChart3,
  MessageSquare,
  Plus,
  FileText,
  Clock,
  CheckCircle2,
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
      // Pending — admin/super_admin/dba only
      ...(isAdminUser
        ? [{ label: "Pending Tickets", path: "/ticket/pending" }]
        : []),
      { label: "Resolved Tickets", path: "/ticket/resolved" },
    ],
  },
];
