import { Chart2, Hierarchy, Profile2User, TaskSquare, DocumentText, ShieldTick } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// Room Composition, Room Categories and Room Master are reachable from the
// TopNavbar's quick-access "Setup" menu (civilWorkDprSetupItems, same as
// Engineering's Activity/Dependency masters) rather than duplicated here —
// matching the existing convention every other module already follows
// (Follow-Up's own Department Master is likewise not repeated in
// FollowupSidebar.ts).
//
// pendingApprovalCount is how many Completed, QC-passed activities are
// sitting at an approval level the viewer can act on right now (see
// dependencyActivityAssignmentApi.ts's getPendingApprovalCount) — surfaced
// as a badge on Reporting, the natural place to open one and act on it via
// its Approval tab. Same "poll a count into a badge" shape as Admin's own
// Approval Inbox badge (buildAdminNavItems).
export const buildCivilWorkDprNavItems = (pendingApprovalCount: number): NavItem[] => [
  {
    label: "Dashboard",
    icon: Chart2,
    path: "/civilworkdpr",
    pageKey: "civilworkdpr-dashboard",
    isDashboard: true,
  },
  {
    label: "Work Allocation",
    icon: TaskSquare,
    path: "/civilworkdpr/work-allocation",
    pageKey: "civilworkdpr-work-done",
  },
  {
    label: "Reporting",
    icon: DocumentText,
    path: "/civilworkdpr/activity-reporting",
    pageKey: "civilworkdpr-activity-reporting",
    badge: pendingApprovalCount > 0 ? pendingApprovalCount : undefined,
  },
  {
    label: "Quality Check",
    icon: ShieldTick,
    path: "/civilworkdpr/quality-check",
    pageKey: "civilworkdpr-quality-check",
  },
  {
    label: "Dependency",
    icon: Hierarchy,
    path: "/civilworkdpr/dependency",
    pageKey: "civilworkdpr-dependency",
  },
  {
    label: "Attendance",
    icon: Profile2User,
    path: "/civilworkdpr/worker-attendance",
    pageKey: "civilworkdpr-worker-attendance",
  },
];
