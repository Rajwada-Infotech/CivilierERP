import React from "react";
import { SheetShell } from "@/components/sheet/Sheet";

interface TicketShellProps {
  title: string;
  subtitle?: string;
  /** Kept for callers; the sheet title block has no icon. */
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

// Ticket pages use the same drawing-sheet look as Finance and Legal: ink on paper, no module colour inside the page.
// The pink stays only as the module's mark in the sidebar and top bar.
export const TicketShell: React.FC<TicketShellProps> = ({ title, subtitle, action, children }) => (
  <SheetShell eyebrow="CivilierERP · Tickets" title={title} subtitle={subtitle} action={action}>
    {children}
  </SheetShell>
);
