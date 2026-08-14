import { Chart2, Hierarchy, Building3, Profile2User, TaskSquare, Grid2, Category } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const civilWorkDprNavItems: NavItem[] = [
  {
    label: "Dashboard",
    icon: Chart2,
    path: "/civilworkdpr",
    pageKey: "civilworkdpr-dashboard",
    isDashboard: true,
  },
  {
    label: "Work Done",
    icon: TaskSquare,
    path: "/civilworkdpr/work-done",
    pageKey: "civilworkdpr-work-done",
  },
  {
    label: "Room Composition",
    icon: Grid2,
    path: "/civilworkdpr/room-composition",
    pageKey: "room-composition-builder",
  },
  {
    label: "Room Categories",
    icon: Category,
    path: "/civilworkdpr/room-category-master",
    pageKey: "room-category-master",
  },
  {
    label: "Dependency",
    icon: Hierarchy,
    path: "/civilworkdpr/dependency",
    pageKey: "civilworkdpr-dependency",
  },
  {
    label: "Contractor",
    icon: Building3,
    path: "/civilworkdpr/contractor-register",
    pageKey: "civilworkdpr-contractor-register",
  },
  {
    label: "Attendance",
    icon: Profile2User,
    path: "/civilworkdpr/worker-attendance",
    pageKey: "civilworkdpr-worker-attendance",
  },
];
