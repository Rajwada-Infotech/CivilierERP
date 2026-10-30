import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalRows } from "@/api/legalMastersApi";
import { initDueDiligence } from "@/api/legalLandApi";
import { StepTabs, stepCard } from "./StepTabs";

// Phase 3 pipeline steps: 7 Legal Case & Mortgage Verification, 9 Legal Due Diligence, 10 Legal Clearance.
// The server decides when each can complete; these screens hold the records it checks.

export const CaseMortgageStep: React.FC<{ landId: number; onSaved: () => void }> = ({ landId, onSaved }) => (
  <StepTabs landId={landId} onSaved={onSaved} tabs={[
    { key: "cases", label: "Court cases", tables: [{ key: "legal-case", label: "Court Cases" }, { key: "case-hearing", label: "Hearings" }] },
    { key: "mortgages", label: "Mortgages & loans", tables: [{ key: "mortgage", label: "Mortgages & Loans" }] },
    {
      key: "checks", label: "Verification checks", tables: [{ key: "verification-check", label: "Legal Verification Checks" }],
      note: <>Encumbrance search and court case verification are needed to complete this step. <b>Not Found</b> is a result;
        <b> Not Checked</b> and <b>Search Failed</b> mean the search still has to be done.</>,
    },
  ]} />
);

const DueDiligenceSetup: React.FC<{ landId: number; onSaved: () => void }> = ({ landId, onSaved }) => {
  const rights = usePageRights("legal-land-master");
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["legal-master", "due-diligence", landId], queryFn: () => getLegalRows("due-diligence", landId) });
  const [busy, setBusy] = useState(false);
  if (!rights.canEdit || (data && data.length >= 12)) return null;
  return (
    <div className={`${stepCard} flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}>
      <span className="text-muted-foreground">{data?.length ? `${data.length} of 12 checks on the list.` : "No due diligence checks yet."} Add the full checklist to review it item by item.</span>
      <button
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            toast.success((await initDueDiligence(landId)).message);
            await queryClient.invalidateQueries({ queryKey: ["legal-master", "due-diligence"] });
            onSaved();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not create the checklist");
          } finally {
            setBusy(false);
          }
        }}
      >
        <ListChecks size={13} /> Add all 12 checks
      </button>
    </div>
  );
};

export const DueDiligenceStep: React.FC<{ landId: number; onSaved: () => void }> = ({ landId, onSaved }) => (
  <StepTabs landId={landId} onSaved={onSaved} tabs={[
    {
      key: "checklist", label: "Due diligence checklist", tables: [{ key: "due-diligence", label: "Due Diligence Checklist" }],
      content: <DueDiligenceSetup landId={landId} onSaved={onSaved} />,
      note: "Each check is Clear or Issue Found (with findings). Results are set by a reviewer with the approve right.",
    },
    { key: "advocates", label: "Advocate assignment", tables: [{ key: "advocate-assignment", label: "Advocate Assignments" }] },
    {
      key: "opinions", label: "Legal opinion", tables: [{ key: "legal-opinion", label: "Legal Opinions" }],
      note: "The system never declares a title valid. An opinion counts once an authorised reviewer sets it to Approved.",
    },
  ]} />
);

export const ClearanceStep: React.FC<{ landId: number; onSaved: () => void }> = ({ landId, onSaved }) => (
  <StepTabs landId={landId} onSaved={onSaved} tabs={[
    {
      key: "clearance", label: "Clearance decision", tables: [{ key: "legal-clearance", label: "Legal Clearance" }],
      note: <>The latest decision counts. <b>Cleared</b> moves on; <b>Cleared with Conditions</b> moves on once the conditions are marked met;
        <b> Not Cleared</b> or <b>On Hold</b> puts the land on hold with every record kept.</>,
    },
  ]} />
);
