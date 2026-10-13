import React from "react";
import { ModuleIcons } from "@/components/icons/moduleIcons";
import type { Module } from "@/contexts/module.utils";

// The one list of modules — id, icon, name, colour — that the desktop module strip, the top bar's
// glow and the mobile navigation all read, so a module looks the same (and is called the same)
// everywhere. Add a module here once; don't re-declare it in a layout file.
//
// ringRgb: raw "r,g,b" used to build valid RGBA strings at runtime (kept equal to `color`).

// Icons come from components/icons/moduleIcons (Tabler), shared with the sidebar headers.
export type ModuleIcon = React.ElementType;

export type ModuleDef = {
  id: NonNullable<Module>;
  icon: ModuleIcon;
  label: string;
  desc: string;
  color: string;
  bg: string;
  ringRgb: string;
};

export const MODULES: ModuleDef[] = [
  {
    id: "finance",
    icon: ModuleIcons.finance,
    label: "Finance",
    desc: "Ledger, payments & BRS",
    color: "#6366f1",
    bg: "rgba(99,102,241,0.22)",
    ringRgb: "99,102,241",
  },
  {
    id: "material",
    icon: ModuleIcons.material,
    label: "Material",
    desc: "GRN, PO & inventory",
    color: "#10b981",
    bg: "rgba(16,185,129,0.22)",
    ringRgb: "16,185,129",
  },
  {
    id: "fixed-asset",
    icon: ModuleIcons.fixedAsset,
    label: "Fixed Asset",
    desc: "Tagging, records & depreciation",
    color: "#eab308",
    bg: "rgba(234,179,8,0.22)",
    ringRgb: "234,179,8",
  },
  {
    id: "loan",
    icon: ModuleIcons.loan,
    label: "Loan",
    desc: "Loan management",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.22)",
    ringRgb: "34,197,94",
  },
  {
    id: "engineering",
    icon: ModuleIcons.engineering,
    label: "Engineering",
    desc: "Projects, work orders & site",
    color: "#f97316",
    bg: "rgba(249,115,22,0.22)",
    ringRgb: "249,115,22",
  },
  {
    id: "civilworkdpr",
    icon: ModuleIcons.civilWorkDpr,
    label: "Civil Work DPR",
    desc: "Internal operations workspace",
    color: "#0891b2",
    bg: "rgba(8,145,178,0.22)",
    ringRgb: "8,145,178",
  },
  {
    id: "followup",
    icon: ModuleIcons.followup,
    label: "Follow-Up",
    desc: "Sales, agreements & CRM",
    color: "#0d9488",
    bg: "rgba(13,148,136,0.18)",
    ringRgb: "13,148,136",
  },
  {
    id: "ticket",
    icon: ModuleIcons.ticket,
    label: "Ticket",
    desc: "Support & issue tracking",
    color: "#ec4899",
    bg: "rgba(236,72,153,0.22)",
    ringRgb: "236,72,153",
  },
  {
    id: "sales",
    icon: ModuleIcons.sales,
    label: "Sales",
    desc: "Sale orders & payments",
    color: "#a855f7",
    bg: "rgba(168,85,247,0.22)",
    ringRgb: "168,85,247",
  },
  {
    id: "sales-automation",
    icon: ModuleIcons.salesAutomation,
    label: "Sales Automation",
    desc: "Campaigns, leads & bookings",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.22)",
    ringRgb: "245,158,11",
  },
  {
    id: "crm",
    icon: ModuleIcons.crm,
    label: "CRM",
    desc: "Applications, bookings & agreements",
    color: "#0ea5e9",
    bg: "rgba(14,165,233,0.22)",
    ringRgb: "14,165,233",
  },
  {
    id: "maintenance",
    icon: ModuleIcons.maintenance,
    label: "Maintenance",
    desc: "Upkeep, repairs & servicing",
    color: "#65a30d",
    bg: "rgba(101,163,13,0.22)",
    ringRgb: "101,163,13",
  },
  {
    id: "hr-payroll",
    icon: ModuleIcons.hrPayroll,
    label: "HR and Payroll",
    desc: "Employees, attendance & payroll",
    color: "#eab308",
    bg: "rgba(234,179,8,0.22)",
    ringRgb: "234,179,8",
  },
  // Records is always last — new modules get inserted above this entry
  {
    id: "records",
    icon: ModuleIcons.records,
    label: "Records",
    desc: "Every attachment, in one place",
    color: "#e11d48",
    bg: "rgba(225,29,72,0.18)",
    ringRgb: "225,29,72",
  },
];

export const ADMIN_MODULE: ModuleDef = {
  id: "admin",
  icon: ModuleIcons.admin,
  label: "Admin",
  desc: "Users, rights & configuration",
  color: "#3b82f6",
  bg: "rgba(59,130,246,0.22)",
  ringRgb: "59,130,246",
};

/** Every module, regular ones in strip order, Admin last. */
export const ALL_MODULES: ModuleDef[] = [...MODULES, ADMIN_MODULE];

/** "#rrggbb" → { h, s, l } with s and l as percentages (rounded), for hsl() styling. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
