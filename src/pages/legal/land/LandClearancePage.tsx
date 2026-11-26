import { usePaged } from "@/components/legal/usePaged";
import React from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardTick } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LandClearancePanel } from "@/components/legal/LandClearancePanel";
import { usePageRights } from "@/hooks/usePageRights";
import { getClearanceList } from "@/api/legalLandApi";

/** Pipeline step between Deed Process and Deed Registration: LA and ULC clearance per land — apply, then obtain, with dates. */
export default function LandClearancePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = usePageRights("legal-land-master").canEdit;
  const list = usePaged(["legal-clearance-list"], (qs) => getClearanceList(qs));
  const { data, isLoading, error } = list;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-clearance-list"] }); qc.invalidateQueries({ queryKey: ["legal-post-registration"] }); };
  const lands = data?.lands ?? []; // one page, already limited to the picked project on the server
  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "LA & ULC Clearance" }]} />
      <LegalShell stage="clearance" title="LA & ULC Clearance" subtitle="Land Acquisition and Urban Land Ceiling clearance: apply, track, obtain. The certificate is attached at Post-Registration." icon={ClipboardTick}>
        {list.search("Search land ID, name, mouza…")}
        {error ? <p className="p-6 text-destructive">{(error as Error).message}</p> : isLoading ? <p className="p-6 text-muted-foreground">Loading…</p> : !lands.length ? (
          <p className="border border-border p-6 text-sm text-muted-foreground">No land at this stage yet. Lands appear here once they reach Deed Process.</p>
        ) : (
          <div className="space-y-4">
            {lands.map((l) => {
              const done = l.clearances.filter((c) => ["Approved", "Obtained", "Not Applicable"].includes(c.Status)).length;
              return (
                <section key={l.LandId} className="border border-border bg-card">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <button className="text-left hover:underline" onClick={() => navigate(`/legal/land/properties/${l.LandId}`)}>
                      <b className="font-mono">{l.LandCode}</b> · {l.LandName}
                      <span className="ml-2 text-xs text-muted-foreground">{[l.MouzaName, l.DistrictName].filter(Boolean).join(" · ")}</span>
                    </button>
                    <span className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">{l.WorkflowStatus}</span>
                      <b className={done === l.clearances.length ? "text-emerald-600" : "text-amber-600"}>{done} / {l.clearances.length} obtained</b>
                    </span>
                  </header>
                  <LandClearancePanel landId={l.LandId} canEdit={canEdit} items={l.clearances} onSaved={refresh} />
                </section>
              );
            })}
          </div>
        )}
        {list.pager}
      </LegalShell>
    </>
  );
}
