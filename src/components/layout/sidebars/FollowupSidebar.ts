import { Category2, TickCircle, ArrowSwapHorizontal, Chart, CloseCircle, TaskSquare } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  { label: "Dashboard", icon: Chart, path: "/followup/task-dashboard", pageKey: "task-performance-report" },
  { label: "Follow-Up", icon: Category2, path: "/followup", pageKey: "followup-dashboard", isDashboard: true },
  { label: "Close Task", icon: TickCircle, path: "/followup/close-tasks", pageKey: "followup-close-tasks" },
  { label: "Cancelled Tasks", icon: CloseCircle, path: "/followup/cancelled-tasks", pageKey: "followup-cancelled-tasks" },
  { label: "Task Transfer", icon: ArrowSwapHorizontal, path: "/followup/task-transfer", pageKey: "followup-task-transfer" },
  // Moved out of the Setup fly-out into the module sidebar — it's the master
  // list of tasks the whole Follow-Up module is built around, not a rarely
  // touched configuration screen. Route/pageKey unchanged ("task-master").
  { label: "Task Master", icon: TaskSquare, path: "/followup/setup/task-master", pageKey: "task-master" },
  // Task Performance / Tag Performance / Entry Type & Document reports moved
  // to Reports → Follow-Up (see Reports.tsx — they open as launcher tiles).
];
