import React from "react";
import { Judge } from "iconsax-react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { LegalDocumentPreview } from "./LegalDocumentPreview";

// Single source of truth for the Legal module's accent — change this one value (and its twins in
// moduleDefs.tsx / AppSidebar.tsx / index.css) to re-theme the whole module.
// "Seal maroon" — the deep red of a court seal; darker than Records' red and Sales Automation's rose,
// so it reads as its own module.
export const LEGAL_ACCENT = "#9b2335";
/** Maroon → crimson → rose glow, for hero / call-to-action surfaces. */
export const LEGAL_GRADIENT = "linear-gradient(135deg, #9b2335 0%, #b8344a 60%, #d4566a 100%)";

interface LegalShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Shared glass-themed wrapper for every Legal module page. */
export const LegalShell: React.FC<LegalShellProps> = ({ title, subtitle, icon = Judge, action, children }) => (
  <GlassShell title={title} subtitle={subtitle} icon={icon} action={action} accentColor={LEGAL_ACCENT}>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">{children}</div>
      <LegalDocumentPreview />
    </div>
  </GlassShell>
);
