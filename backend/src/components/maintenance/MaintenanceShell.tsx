import React from "react";
import { Wrench } from "lucide-react";
import { GlassShell } from "@/components/dashboard/GlassShell";

// Single source of truth for the Maintenance module's accent — change this
// one value (and its HSL twin in TopNavbar.tsx's MODULE_COLORS, and the
// ModuleStrip/AppSidebar entries) to re-theme the whole module.
export const MAINTENANCE_ACCENT = "#65a30d"; // lime-600

interface MaintenanceShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Shared glass-themed wrapper for every Maintenance module page — a thin
 *  GlassShell wrapper so the module's accent lives in one place. */
export const MaintenanceShell: React.FC<MaintenanceShellProps> = ({
  title,
  subtitle,
  icon = Wrench,
  action,
  children,
}) => (
  <GlassShell title={title} subtitle={subtitle} icon={icon} action={action} accentColor={MAINTENANCE_ACCENT}>
    {children}
  </GlassShell>
);
