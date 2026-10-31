import React, { useRef } from "react";
import { Judge } from "iconsax-react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { LegalDocumentPreview, PANEL_DOCK_MIN_WIDTH } from "./LegalDocumentPreview";
import { useElementWidth } from "./useElementWidth";
import { LegalAskHost } from "./LegalAsk";

// Single source of truth for the Legal module's accent — change this one value (and its twins in
// moduleDefs.tsx / AppSidebar.tsx / index.css) to re-theme the whole module.
// "Law-book walnut" — the brown of leather-bound law reports. No other module uses brown (Projects' gold
// is a mustard yellow), so it reads as its own module. Red stays for statuses only (rejected, cancelled…).
export const LEGAL_ACCENT = "#7c4a2e";
/** Walnut → saddle → tan, for hero / call-to-action surfaces. */
export const LEGAL_GRADIENT = "linear-gradient(135deg, #7c4a2e 0%, #a06a3f 60%, #c48e5c 100%)";

interface LegalShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Shared glass-themed wrapper for every Legal module page. */
// The side panel docks on the right of the page; on phone-width pages it is a bottom sheet instead.
// Decided from the real width of the page area, not the screen (the ERP sidebars take part of it).
export const LegalShell: React.FC<LegalShellProps> = ({ title, subtitle, icon = Judge, action, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const dock = width >= PANEL_DOCK_MIN_WIDTH;
  return (
    <GlassShell title={title} subtitle={subtitle} icon={icon} action={action} accentColor={LEGAL_ACCENT}>
      <div ref={ref} className={`flex gap-4 ${dock ? "flex-row items-start" : "flex-col"}`}>
        <div className="min-w-0 flex-1">{children}</div>
        <LegalDocumentPreview dock={dock} />
      </div>
      <LegalAskHost />
    </GlassShell>
  );
};
