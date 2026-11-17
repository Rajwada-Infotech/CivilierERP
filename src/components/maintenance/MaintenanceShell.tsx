import React from "react";
import { SheetShell } from "@/components/sheet/Sheet";

// Maintenance pages use the drawing-sheet look (docs/DESIGN.md): ink on paper, no module colour inside the page.
// The module's green stays only as its mark in the sidebar and top bar (ModuleStrip / AppSidebar).
export const MAINTENANCE_ACCENT = "hsl(var(--foreground))";

interface MaintenanceShellProps {
  title: string;
  subtitle?: string;
  /** Kept for callers; the sheet title block has no icon. */
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Shared sheet wrapper for every Maintenance page (and its setup masters). */
export const MaintenanceShell: React.FC<MaintenanceShellProps> = ({ title, subtitle, action, children }) => (
  <SheetShell eyebrow="CivilierERP · Maintenance" title={title} subtitle={subtitle} action={action}>
    {children}
  </SheetShell>
);
