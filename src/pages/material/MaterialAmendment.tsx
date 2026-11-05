import React from "react";
import { SheetShell } from "@/components/sheet/Sheet";
import { AmendmentLogPage } from "@/components/amendment/AmendmentLogPage";
import { usePageRights } from "@/hooks/usePageRights";

// The amendment log takes whichever shell its module uses; Material is on the sheet.
const MaterialSheetShell: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, action, children }) => (
  <SheetShell eyebrow="CivilierERP · Material" title={title} subtitle={typeof subtitle === "string" ? subtitle : undefined} action={action}>
    {children}
  </SheetShell>
);

export default function MaterialAmendment() {
  usePageRights("material-amendment");
  return <AmendmentLogPage module="material" title="Amendments" Shell={MaterialSheetShell} />;
}
