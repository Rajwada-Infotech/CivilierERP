import { Chart2, Hierarchy, Building3, Profile2User, TaskSquare } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// Room Composition and Room Categories are reachable from the TopNavbar's
// quick-access "Setup" menu (civilWorkDprSetupItems, same as Engineering's
// Activity/Dependency masters) rather than duplicated here — matching the
// existing convention every other module already follows (Follow-Up's own
// Department Master is likewise not repeated in FollowupSidebar.ts).
export const civilWorkDprNavItems: NavItem[] = [
  {
    label: "Dashboard",
    icon: Chart2,
    path: "/civilworkdpr",
    pageKey: "civilworkdpr-dashboard",
    isDashboard: true,
  },
  {
    label: "Work Reporting",
    icon: TaskSquare,
    path: "/civilworkdpr/work-done",
    pageKey: "civilworkdpr-work-done",
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
