import { BarChart3, FileText, Percent, Tag } from "lucide-react";
import type { ReportDef } from "@/pages/reports/types";

// Follow-Up performance reports (launchers to their own pages). Part of the one report list assembled in ../registry.ts.
export const FOLLOWUP_REPORTS: ReportDef[] = [
  // ── Follow-Up performance reports ─────────────────────────────────────────
  // These live as their own pages (FollowupShell-wrapped charts/tables), so
  // the catalog tile is a launcher — clicking it navigates to the route
  // rather than rendering an inline table. Moved here out of the Follow-Up
  // module sidebar.
  {
    id: "task-performance-report",
    label: "Task Performance Report",
    description: "Completion rates, delays & performance by assignee / department",
    icon: BarChart3,
    color: "#0d9488",
    route: "/followup/task-performance-report",
    apiPath: "",
    columns: [],
  },
  {
    id: "tag-performance-report",
    label: "Tag Performance Report",
    description: "Task volume, turnaround & ageing sliced by tag",
    icon: Percent,
    color: "#0d9488",
    route: "/followup/tag-performance-report",
    apiPath: "",
    columns: [],
  },
  {
    id: "entry-type-doc-followup-report",
    label: "Entry Type & Document Report",
    description: "Follow-up activity by entry type and linked document",
    icon: FileText,
    color: "#0d9488",
    route: "/followup/entry-type-doc-followup-report",
    apiPath: "",
    columns: [],
  },
];
