// The one list of SaLead.Status values, in lifecycle order. Backend
// transitions live in STATUS_TRANSITIONS (backend/constants/saStatuses.js) — keep
// the keys in step with that. Used by the Pipeline board, the Lead/Inquiry
// status pickers and the dashboard workflow strip.

export interface LeadStage {
  key: string;
  label: string;
  hint: string;
  /** Where staff act on leads at this stage. */
  path: string;
  /** Hex colour for the dashboard strip. */
  hex: string;
  /** Tailwind classes for the Pipeline board column. */
  boardClass: string;
}

export const LEAD_STAGES: LeadStage[] = [
  { key: "New",            label: "New",             hint: "Awaiting a rep",        path: "/sales-automation/distribution",    hex: "#64748b", boardClass: "border-slate-400 bg-slate-50 dark:bg-slate-900/30" },
  { key: "Assigned",       label: "Assigned",        hint: "Not yet called",        path: "/sales-automation/leads",           hex: "#3b82f6", boardClass: "border-blue-400 bg-blue-50 dark:bg-blue-900/20" },
  { key: "Contacted",      label: "Contacted",       hint: "First call done",       path: "/sales-automation/lead-activities", hex: "#eab308", boardClass: "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" },
  { key: "FollowUp",       label: "Follow Up",       hint: "Calls in progress",     path: "/sales-automation/followups",       hex: "#f97316", boardClass: "border-orange-400 bg-orange-50 dark:bg-orange-900/20" },
  { key: "VisitScheduled", label: "Visit Scheduled", hint: "Site visit booked",     path: "/sales-automation/site-visits",     hex: "#a855f7", boardClass: "border-purple-400 bg-purple-50 dark:bg-purple-900/20" },
  { key: "Visited",        label: "Visited",         hint: "Ready to close",        path: "/sales-automation/site-visits",     hex: "#6366f1", boardClass: "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20" },
  { key: "Converted",      label: "Converted",       hint: "In CRM leads pool",     path: "/crm/leads",                        hex: "#14b8a6", boardClass: "border-teal-400 bg-teal-50 dark:bg-teal-900/20" },
  { key: "Booking",        label: "Booking",         hint: "CRM booking made",      path: "/sales-automation/pipeline",        hex: "#22c55e", boardClass: "border-green-400 bg-green-50 dark:bg-green-900/20" },
  { key: "Lost",           label: "Lost",            hint: "Dropped out",           path: "/sales-automation/leads",           hex: "#ef4444", boardClass: "border-red-400 bg-red-50 dark:bg-red-900/20" },
];

export const LEAD_STATUS_KEYS = LEAD_STAGES.map((s) => s.key);
