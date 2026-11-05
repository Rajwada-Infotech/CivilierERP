import React, { useRef } from "react";
import { SheetShell } from "@/components/sheet/Sheet";
import { LegalDocumentPreview, PANEL_DOCK_MIN_WIDTH } from "./LegalDocumentPreview";
import { useElementWidth } from "./useElementWidth";
import { LegalAskHost } from "./LegalAsk";

// Legal pages use the same drawing-sheet look as Finance: ink on paper, no module colour inside the page.
// The walnut brown stays only as the module's mark in the sidebar (moduleDefs.tsx / AppSidebar.tsx / index.css).
export const LEGAL_ACCENT = "hsl(var(--foreground))";
/** Primary buttons, progress bars and icon chips — the sheet's ink. Pair with `text-card` for the label. */
export const LEGAL_GRADIENT = "hsl(var(--foreground))";

interface LegalShellProps {
  title: string;
  subtitle?: string;
  /** Kept for callers; the sheet title block has no icon. */
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

// On a phone the sheet's frame, title block and body padding take a third of the width; tighten them so forms,
// tables and buttons get the room. The header's action button goes under the title at full width.
const LEGAL_MOBILE_CSS = `
@media (max-width: 640px) {
  .legal-sheet .sheet-frame { margin: 0; outline: 0; }
  .legal-sheet .sheet-frame > div:first-child { padding: 14px 12px 12px !important; }
  .legal-sheet .sheet-frame > div:first-child > div:last-child:not(:first-child) { width: 100%; }
  .legal-sheet .sheet-frame > .cell { padding: 12px 10px 16px !important; gap: 14px !important; }
}`;

/** Shared sheet wrapper for every Legal module page. */
// The side panel docks on the right of the page; on phone-width pages it is a bottom sheet instead.
// Decided from the real width of the page area, not the screen (the ERP sidebars take part of it).
export const LegalShell: React.FC<LegalShellProps> = ({ title, subtitle, action, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const dock = width >= PANEL_DOCK_MIN_WIDTH;
  return (
    <div className="legal-sheet">
    <style>{LEGAL_MOBILE_CSS}</style>
    <SheetShell eyebrow="CivilierERP · Legal" title={title} subtitle={subtitle} action={action}>
      <div ref={ref} className={`flex gap-4 ${dock ? "flex-row items-start" : "flex-col"}`}>
        <div className="min-w-0 flex-1">{children}</div>
        <LegalDocumentPreview dock={dock} />
      </div>
      <LegalAskHost />
    </SheetShell>
    </div>
  );
};
