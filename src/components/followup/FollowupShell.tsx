import React from "react";
import { useModule } from "@/contexts/ModuleContext";
import { CrmShell } from "@/components/crm/CrmShell";
import { SheetShell } from "@/components/sheet/Sheet";

interface FollowupShellProps {
  title: string;
  subtitle?: React.ReactNode;
  /** Kept for callers; the sheet title block has no icon. */
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

// Follow-Up pages use the same drawing-sheet look as Finance and Legal: ink on paper, no module colour inside the page.
// The teal stays only as the module's mark in the sidebar and top bar.
export const FOLLOWUP_ACCENT = "hsl(var(--foreground))";

// Several Follow-Up setup masters are also served under /crm/setup/*; opened
// from CRM they take the CRM shell so the page matches the CRM module.
export const FollowupShell: React.FC<FollowupShellProps> = (props) => {
  const { activeModule } = useModule();
  if (activeModule === "crm") return <CrmShell {...props} />;
  const { title, subtitle, action, children } = props;
  return (
    <SheetShell eyebrow="CivilierERP · Follow-Up" title={title} subtitle={typeof subtitle === "string" ? subtitle : undefined} action={action}>
      {children}
    </SheetShell>
  );
};
