import React from "react";
import { SheetShell } from "@/components/sheet/Sheet";
import { AmendmentLogPage } from "@/components/amendment/AmendmentLogPage";
import { usePageRights } from "@/hooks/usePageRights";
import { AmendmentRequests } from "@/components/amendment/AmendmentRequests";

// The amendment log takes whichever shell its module uses; Engineering is on the sheet.
const EngineeringSheetShell: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, action, children }) => (
  <SheetShell eyebrow="CivilierERP · Engineering" title={title} subtitle={typeof subtitle === "string" ? subtitle : undefined} action={action}>
    {children}
  </SheetShell>
);

export default function EngineeringAmendment() {
  usePageRights("engineering-amendment");
  // Amendment requests (raised with Amend on an approved document, applied once approved) above the log of changes.
  return <AmendmentLogPage module="engineering" title="Amendments" Shell={EngineeringSheetShell} before={<AmendmentRequests module="engineering" />} />;
}
