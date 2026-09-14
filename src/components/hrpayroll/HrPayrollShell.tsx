import React from "react";
import { Profile2User } from "iconsax-react";
import { GlassShell } from "@/components/dashboard/GlassShell";

// Single source of truth for the HR and Payroll module's accent — change
// this one value (and its twins in ModuleStrip.tsx / AppSidebar.tsx) to
// re-theme the whole module.
export const HR_PAYROLL_ACCENT = "#8b5cf6"; // violet-500

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
