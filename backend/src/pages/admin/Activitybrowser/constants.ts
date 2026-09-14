// pages/admin/activity-browser/constants.ts
import {
  ActivityLogFilters,
  type ActivityActionType,
} from "@/api/userActivityApi";

export const PRESETS = [
  { label: "Today", period: "today" as const },
  { label: "Yesterday", period: "yesterday" as const },
  { label: "This Week", period: "this-week" as const },
  { label: "This Month", period: "this-month" as const },
  { label: "Last Month", period: "last-month" as const },
  { label: "This Year", period: "this-year" as const },
] satisfies Array<{ label: string; period: ActivityLogFilters["period"] }>;

export const YEARS = [2026, 2025, 2024, 2023];

export const MONTHS = [
  { label: "January", value: 0 },
  { label: "February", value: 1 },
  { label: "March", value: 2 },
  { label: "April", value: 3 },
  { label: "May", value: 4 },
  { label: "June", value: 5 },
  { label: "July", value: 6 },
  { label: "August", value: 7 },
  { label: "September", value: 8 },
  { label: "October", value: 9 },
  { label: "November", value: 10 },
  { label: "December", value: 11 },
];

export const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  admin: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  user: "bg-slate-500/10 text-slate-600 border-slate-500/20",
};

export const ACTION_COLORS: Record<string, string> = {
  login: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  logout: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  read: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  create: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  update: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  delete: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  write: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  export: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  settings_change: "bg-orange-500/10 text-orange-600 border-orange-500/20",
};
