import React from "react";
import { SheetShell } from "@/components/sheet/Sheet";
import { AmendmentLogPage } from "@/components/amendment/AmendmentLogPage";
import { usePageRights } from "@/hooks/usePageRights";

// The amendment log takes whichever shell its module uses; Finance is on the sheet.
const FinanceSheetShell: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, action, children }) => (
  <SheetShell eyebrow="CivilierERP · Finance" title={title} subtitle={typeof subtitle === "string" ? subtitle : undefined} action={action}>
    {children}
  </SheetShell>
);

export default function FinanceAmendment() {
  usePageRights("finance-amendment");
  return <AmendmentLogPage module="finance" title="Amendments" Shell={FinanceSheetShell} />;
}
