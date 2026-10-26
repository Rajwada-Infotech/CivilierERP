import { Category2, TickCircle, ArrowSwapHorizontal, Chart, CloseCircle } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  // ── Dashboard ──────────────────────────────────────────────────────────────
  { label: "Dashboard", icon: Category2, path: "/followup", pageKey: "followup-dashboard", isDashboard: true },

  // ── Operational Workflow ───────────────────────────────────────────────────
  { label: "Task Performance", icon: Chart, path: "/followup/task-dashboard", pageKey: "task-performance-report" },
  { label: "Close Task", icon: TickCircle, path: "/followup/close-tasks", pageKey: "followup-close-tasks" },
  { label: "Cancelled Tasks", icon: CloseCircle, path: "/followup/cancelled-tasks", pageKey: "followup-cancelled-tasks" },
  { label: "Task Transfer", icon: ArrowSwapHorizontal, path: "/followup/task-transfer", pageKey: "followup-task-transfer" },

  // Task Master is reference/config data — lives in the Setup dropdown (followupSetupItems).
  // Reports (Task/Tag Performance, Entry Type & Doc) live in the Reports launcher.
];
