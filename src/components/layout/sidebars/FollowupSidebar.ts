import { Category2, TickCircle, ArrowSwapHorizontal, Chart2, Chart, Tag, DocumentText, CloseCircle } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  // These three share the "task-performance-report" pageKey deliberately —
  // they're all the same underlying live TaskMaster/TagMaster data, just
  // sliced/charted differently (same precedent as /material/work-order
  // sharing "engineering-work-order").
  { label: "Dashboard", icon: Chart, path: "/followup/task-dashboard", pageKey: "task-performance-report" },
  { label: "Follow-Up", icon: Category2, path: "/followup", pageKey: "followup-dashboard", isDashboard: true },
  { label: "Close Task", icon: TickCircle, path: "/followup/close-tasks", pageKey: "followup-close-tasks" },
  { label: "Cancelled Tasks", icon: CloseCircle, path: "/followup/cancelled-tasks", pageKey: "followup-cancelled-tasks" },
  { label: "Task Transfer", icon: ArrowSwapHorizontal, path: "/followup/task-transfer", pageKey: "followup-task-transfer" },
  { label: "Task Performance Report", icon: Chart2, path: "/followup/task-performance-report", pageKey: "task-performance-report", wrapLabel: true },
  { label: "Tag Performance Report", icon: Tag, path: "/followup/tag-performance-report", pageKey: "task-performance-report", wrapLabel: true },
  {
    label: "Entry Type & Document Report",
    icon: DocumentText,
    path: "/followup/entry-type-doc-followup-report",
    pageKey: "entry-type-doc-followup-report",
    wrapLabel: true,
  },
];
