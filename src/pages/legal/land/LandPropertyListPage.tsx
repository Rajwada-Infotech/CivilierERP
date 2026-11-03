import { useNavigate, useSearchParams } from "react-router-dom";
import { Global } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalMasterTable } from "../LegalMasterPage";
import { legalMasterByKey } from "../legalMasters";
import type { LegalRow } from "@/api/legalMastersApi";

// ?filter=… from the dashboard's land tiles: the same rules the dashboard counts with (landPipeline.js /stats).
const FILTERS: Record<string, { label: string; test: (r: LegalRow) => boolean }> = {
  "in-progress": { label: "In progress", test: (r) => !r.IsOnHold && r.WorkflowStatus !== "Completed" },
  "on-hold": { label: "On hold", test: (r) => !!r.IsOnHold },
  "pending-verification": { label: "Pending verification", test: (r) => Number(r.StepsAwaitingVerification) > 0 },
  completed: { label: "Completed", test: (r) => r.WorkflowStatus === "Completed" },
};

// The Land Property Master register. "Open" goes to the land's pipeline; ?edit=ID opens its edit form
// (the link from the pipeline's Land Property step).
export default function LandPropertyListPage() {
  const entry = legalMasterByKey("land")!;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS[params.get("filter") ?? ""];
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", entry.label]} />
      <LegalShell title={entry.label} subtitle="Every land property by its Land ID. Open one to work through its pipeline." icon={Global}>
        {filter && (
          <div className="mb-3 flex flex-wrap items-center gap-2 border border-border px-3 py-2 text-xs">
            <span className="text-muted-foreground">Showing:</span>
            <span className="font-semibold text-foreground">{filter.label}</span>
            <button onClick={() => { params.delete("filter"); setParams(params); }} className="ml-auto border border-border px-2 py-1 hover:bg-muted">
              Show all
            </button>
          </div>
        )}
        <LegalMasterTable
          entry={entry}
          requestEditId={params.get("edit")}
          rowFilter={filter?.test}
          rowActions={(raw) => (
            <span className="inline-flex gap-1.5">
              <button onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Open</button>
              <button onClick={() => navigate(`/legal/land/properties/${raw.LandId}/details`)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" title="Everything on this land, with PDF">Details</button>
            </span>
          )}
        />
      </LegalShell>
    </>
  );
}
