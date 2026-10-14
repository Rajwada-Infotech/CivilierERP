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
