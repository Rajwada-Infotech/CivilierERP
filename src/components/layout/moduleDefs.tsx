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
    color: "#2419e6",
    bg: "rgba(36,25,230,0.20)",
    ringRgb: "36,25,230",
  },
  {
    id: "material",
    icon: ModuleIcons.material,
    label: "Material",
    desc: "GRN, PO & inventory",
    color: "#14b84b",
    bg: "rgba(20,184,75,0.20)",
    ringRgb: "20,184,75",
  },
  {
    id: "fixed-asset",
    icon: ModuleIcons.fixedAsset,
    label: "Fixed Asset",
    desc: "Tagging, records & depreciation",
    color: "#a57e12",
    bg: "rgba(165,126,18,0.20)",
    ringRgb: "165,126,18",
  },
  {
    id: "loan",
    icon: ModuleIcons.loan,
    label: "Loan",
    desc: "Loan management",
    color: "#43a512",
    bg: "rgba(67,165,18,0.20)",
    ringRgb: "67,165,18",
  },
  {
    id: "engineering",
    icon: ModuleIcons.engineering,
    label: "Engineering",
    desc: "Projects, work orders & site",
    color: "#e66b19",
    bg: "rgba(230,107,25,0.20)",
    ringRgb: "230,107,25",
  },
  {
    id: "civilworkdpr",
    icon: ModuleIcons.civilWorkDpr,
    label: "Civil Work DPR",
    desc: "Internal operations workspace",
    color: "#14a2b8",
    bg: "rgba(20,162,184,0.20)",
    ringRgb: "20,162,184",
  },
  {
    id: "followup",
    icon: ModuleIcons.followup,
    label: "Follow-Up",
    desc: "Sales, agreements & CRM",
    color: "#14b88c",
    bg: "rgba(20,184,140,0.20)",
    ringRgb: "20,184,140",
  },
  {
    id: "ticket",
    icon: ModuleIcons.ticket,
    label: "Ticket",
    desc: "Support & issue tracking",
    color: "#e619a8",
    bg: "rgba(230,25,168,0.20)",
    ringRgb: "230,25,168",
  },
  {
    id: "sales",
    icon: ModuleIcons.sales,
    label: "Sales",
    desc: "Sale orders & payments",
    color: "#6e19e6",
    bg: "rgba(110,25,230,0.20)",
    ringRgb: "110,25,230",
  },
  {
    id: "sales-automation",
    icon: ModuleIcons.salesAutomation,
    label: "Sales Automation",
    desc: "Campaigns, leads & bookings",
    color: "#e6195d",
    bg: "rgba(230,25,93,0.20)",
    ringRgb: "230,25,93",
  },
  {
    id: "crm",
    icon: ModuleIcons.crm,
    label: "CRM",
    desc: "Applications, bookings & agreements",
    color: "#1990e6",
    bg: "rgba(25,144,230,0.20)",
    ringRgb: "25,144,230",
  },
  {
    id: "maintenance",
    icon: ModuleIcons.maintenance,
    label: "Maintenance",
    desc: "Upkeep, repairs & servicing",
    color: "#88a512",
    bg: "rgba(136,165,18,0.20)",
    ringRgb: "136,165,18",
  },
  {
    id: "hr-payroll",
    icon: ModuleIcons.hrPayroll,
    label: "HR and Payroll",
    desc: "Employees, attendance & payroll",
    color: "#ca19e6",
    bg: "rgba(202,25,230,0.20)",
    ringRgb: "202,25,230",
  },
  // Records is always last — new modules get inserted above this entry
  {
    id: "records",
    icon: ModuleIcons.records,
    label: "Records",
    desc: "Every attachment, in one place",
    color: "#e61919",
    bg: "rgba(230,25,25,0.20)",
    ringRgb: "230,25,25",
  },
];

export const ADMIN_MODULE: ModuleDef = {
  id: "admin",
  icon: ModuleIcons.admin,
  label: "Admin",
  desc: "Users, rights & configuration",
  color: "#1957e6",
  bg: "rgba(25,87,230,0.20)",
  ringRgb: "25,87,230",
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
