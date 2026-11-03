import { useNavigate, useSearchParams } from "react-router-dom";
import { Global } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalMasterTable } from "../LegalMasterPage";
import { legalMasterByKey } from "../legalMasters";
import type { LegalRow } from "@/api/legalMastersApi";

const BACKLOG = "Existing / Backlog";

// ?filter=… from the dashboard's land tiles: the same rules the dashboard counts with (landPipeline.js /stats).
const FILTERS: Record<string, { label: string; test: (r: LegalRow) => boolean }> = {
  "in-progress": { label: "In progress", test: (r) => r.EntryType !== BACKLOG && !r.IsOnHold && r.WorkflowStatus !== "Completed" },
  "on-hold": { label: "On hold", test: (r) => !!r.IsOnHold },
  "pending-verification": { label: "Pending verification", test: (r) => Number(r.StepsAwaitingVerification) > 0 },
  completed: { label: "Completed", test: (r) => r.EntryType !== BACKLOG && r.WorkflowStatus === "Completed" },
  "new-acquisition": { label: "New acquisitions", test: (r) => r.EntryType !== BACKLOG },
  backlog: { label: "Existing / backlog land", test: (r) => r.EntryType === BACKLOG },
};

// The central Land Register: every land of both entry types. /legal/land/register-existing (or ?entry=backlog)
// opens the form to register an already-owned land; saving it opens that land's page on its first next step
// (ownership history). ?edit=ID opens a land's edit form.
export default function LandPropertyListPage({ registerExisting = false }: { registerExisting?: boolean }) {
  const entry = legalMasterByKey("land")!;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS[params.get("filter") ?? ""];
  const registeringBacklog = registerExisting || params.get("entry") === "backlog";
  const set = (k: string, v: string | null) => { if (v) params.set(k, v); else params.delete(k); setParams(params); };
  const tabBtn = (on: boolean) => `border px-2.5 py-1 text-xs font-heading font-semibold ${on ? "border-foreground bg-foreground text-card" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", registeringBacklog ? "Register Existing Land" : entry.label]} />
      <LegalShell
        title={registeringBacklog ? "Register Existing Land" : entry.label}
        subtitle="The central land register — new acquisitions and existing / backlog land, one Land ID each."
        icon={Global}
        action={
          <button
            onClick={() => navigate(registeringBacklog ? "/legal/land/properties" : "/legal/land/register-existing")}
            className="border border-foreground bg-foreground px-3 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card hover:opacity-85"
          >
            {registeringBacklog ? "Back to new acquisition" : "Register existing land"}
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button className={tabBtn(!filter)} onClick={() => set("filter", null)}>All land</button>
          <button className={tabBtn(params.get("filter") === "new-acquisition")} onClick={() => set("filter", "new-acquisition")}>New acquisitions</button>
          <button className={tabBtn(params.get("filter") === "backlog")} onClick={() => set("filter", "backlog")}>Existing / backlog</button>
          {filter && !["new-acquisition", "backlog"].includes(params.get("filter") ?? "") && (
            <span className="ml-2 text-xs text-muted-foreground">Showing: <b className="text-foreground">{filter.label}</b></span>
          )}
        </div>
        {registeringBacklog && (
          <p className="mb-3 border border-border px-3 py-2 text-xs text-muted-foreground">
            <b className="text-foreground">Registering existing / backlog land</b> — land the company already owns. Fill what you know and save; unknown
            details can be added later. Then open the land (View) to enter its ownership, documents, legal, loan, mutation, payment and tax history.
            This does not start a purchase or the acquisition pipeline.
          </p>
        )}
        <LegalMasterTable
          key={registeringBacklog ? "backlog" : "new"}
          entry={entry}
          requestEditId={params.get("edit")}
          defaults={registeringBacklog ? { EntryType: BACKLOG, LandStatus: "Owned" } : {}}
          rowFilter={filter?.test}
          // An existing land is registered, then its history is entered: go straight to its first next step.
          onCreated={registeringBacklog ? (newId) => navigate(`/legal/land/properties/${newId}/profile?tab=ownership&new=1`) : undefined}
          rowActions={(raw) => (
            <span className="inline-flex gap-1.5">
              <button onClick={() => navigate(`/legal/land/properties/${raw.LandId}/profile`)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" title="Everything on this land">View</button>
              {raw.EntryType !== BACKLOG && (
                <button onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" title="The 31-step acquisition pipeline">Pipeline</button>
              )}
            </span>
          )}
        />
      </LegalShell>
    </>
  );
}
