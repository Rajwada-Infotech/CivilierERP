import React from "react";
import { SheetShell } from "@/components/sheet/Sheet";

// HR and Payroll pages use the same drawing-sheet look as Finance, Legal and Follow-Up: ink on paper, no module colour
// inside the page. The orchid stays only as the module's mark in the sidebar and top bar (ModuleStrip / AppSidebar).
export const HR_PAYROLL_ACCENT = "hsl(var(--foreground))";
/** Primary buttons, progress bars and icon chips — the sheet's ink. Pair with `text-card` for the label. */
export const HR_GRADIENT = "hsl(var(--foreground))";

interface HrPayrollShellProps {
  title: string;
  subtitle?: string;
  /** Kept for callers; the sheet title block has no icon. */
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Shared sheet wrapper for every HR and Payroll page. */
export const HrPayrollShell: React.FC<HrPayrollShellProps> = ({ title, subtitle, action, children }) => (
  <SheetShell eyebrow="CivilierERP · HR & Payroll" title={title} subtitle={subtitle} action={action}>
    {children}
  </SheetShell>
);
