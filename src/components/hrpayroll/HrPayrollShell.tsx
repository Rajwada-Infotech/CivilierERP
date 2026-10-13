import React from "react";
import { Profile2User } from "iconsax-react";
import { GlassShell } from "@/components/dashboard/GlassShell";

// Single source of truth for the HR and Payroll module's accent — change
// this one value (and its twins in ModuleStrip.tsx / AppSidebar.tsx) to
// re-theme the whole module.
// "Royal Orchid" — the widest unused gap on the colour wheel (~285–325°), between Sales' purple
// (271°) and Ticket's pink (330°), so it can't be mistaken for any other module.
export const HR_PAYROLL_ACCENT = "#ca19e6";
/** Deep orchid → orchid → light orchid glow, for hero / call-to-action surfaces. */
export const HR_GRADIENT = "linear-gradient(135deg, #ca19e6 0%, #ec3cec 60%, #f25fde 100%)";

interface HrPayrollShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Shared glass-themed wrapper for every HR and Payroll module page — a
 *  thin GlassShell wrapper so the module's accent lives in one place. */
export const HrPayrollShell: React.FC<HrPayrollShellProps> = ({
  title,
  subtitle,
  icon = Profile2User,
  action,
  children,
}) => (
  <GlassShell title={title} subtitle={subtitle} icon={icon} action={action} accentColor={HR_PAYROLL_ACCENT}>
    {children}
  </GlassShell>
);
