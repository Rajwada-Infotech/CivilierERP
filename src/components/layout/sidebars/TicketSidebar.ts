import { Chart2, Message2 } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const buildTicketNavItems = (isAdminUser: boolean): NavItem[] => [
  { label: "Dashboard", icon: Chart2, path: "/ticket", pageKey: "ticket-dashboard", isDashboard: true },
  {
    label: "Tickets",
    icon: Message2,
    children: [
      { label: "Create Ticket",    path: "/ticket/create",     pageKey: "tickets" },
      { label: "My Tickets",       path: "/ticket/my-tickets", pageKey: "tickets" },
      ...(isAdminUser
        ? [{ label: "Pending Tickets", path: "/ticket/pending", pageKey: "tickets" }]
        : []),
      { label: "Resolved Tickets", path: "/ticket/resolved",   pageKey: "tickets" },
    ],
  },
];
