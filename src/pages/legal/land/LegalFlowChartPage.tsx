import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Hierarchy, SearchNormal1 } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { useProjectScope } from "@/components/legal/ProjectPicker";
import { Section, Versions } from "@/components/legal/LandVersions";
import { LandAmendmentActions } from "@/components/legal/LandAmendmentPanel";
import { getFlowEnquiry, getFlowLand, searchFlow, type FlowLand } from "@/api/legalFlowApi";

type Row = Record<string, unknown>;

function LandView({ data }: { data: FlowLand }) {
  const navigate = useNavigate();
  const l = data.land, e = data.enquiry;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border border-foreground bg-card p-4">
        <div>
          <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">{l ? "Land" : "Enquiry (not a land yet)"}</p>
          <h2 className="mt-1 text-xl font-semibold">{l ? `${l.LandCode} · ${l.LandName}` : `${e?.EnquiryNo} · ${e?.LandLocation ?? ""}`}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{[(l ?? e)?.MouzaName, (l ?? e)?.DistrictName, (l ?? e)?.ProjectName].filter(Boolean).join(" · ")}</p>
        </div>
        {l && <button onClick={() => navigate(`/legal/land/properties/${l.LandId}`)} className="h-9 border border-foreground px-4 text-xs font-semibold uppercase tracking-[0.1em] hover:bg-foreground hover:text-background">Open land profile</button>}
      </div>

      {l && <LandAmendmentActions landId={Number(l.LandId)} />}

      <Section title="Versions" count={data.versions?.length}><Versions versions={data.versions ?? []} landId={(l?.LandId as number) ?? null} code={String(l?.LandCode ?? e?.EnquiryNo ?? "land")} stages={data.stages} /></Section>
    </div>
  );
}

/** Legal Flow Chart: search a land by any number it is known by and see its whole flow, details and change history. */
/** Versions & Amendments: search a land by any number, see its versions and ask for / decide amendments. */
export default function LegalFlowChartPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [term, setTerm] = useState(q.trim());
  const { inScope } = useProjectScope();
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const landId = Number(params.get("land")) || null;
  const enquiryId = Number(params.get("enquiry")) || null;
  const search = useQuery({ queryKey: ["legal-flow-search", term], queryFn: () => searchFlow(term), enabled: term.length > 0 });
  const detail = useQuery({
    queryKey: ["legal-flow", landId, enquiryId],
    queryFn: () => (landId ? getFlowLand(landId) : getFlowEnquiry(enquiryId!)),
    enabled: !!(landId || enquiryId),
  });
  const hits = useMemo(() => (search.data?.results ?? []).filter((h) => inScope(h.ProjectId)), [search.data, inScope]);
  const open = (h: { LandId: number | null; EnquiryId: number | null }) =>
    setParams((p) => { const n = new URLSearchParams(p); n.delete("land"); n.delete("enquiry"); if (h.LandId) n.set("land", String(h.LandId)); else if (h.EnquiryId) n.set("enquiry", String(h.EnquiryId)); if (q.trim()) n.set("q", q.trim()); return n; });

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Versions & Amendments" }]} />
      <LegalShell title="Versions & Amendments" subtitle="Search a land by Land ID, Enquiry no., RS / LR Khatian or Dag number — see every version, download it, and request or approve amendments." icon={Hierarchy}>
        <div className="space-y-4">
          <div className="border border-border bg-card p-4">
            <label className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Search</label>
            <div className="mt-1.5 flex h-11 items-center gap-2 border border-foreground/40 bg-background px-3 focus-within:border-foreground">
              <SearchNormal1 size={16} className="text-muted-foreground" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 2215, DEMO/00001/2026-27, ENQ-007, Dag 1376"
                className="h-full flex-1 bg-transparent text-sm outline-none" />
            </div>
            {term && (
              <div className="mt-3">
                {search.isLoading ? <p className="text-sm text-muted-foreground">Searching…</p>
                  : search.error ? <p className="text-sm text-destructive">{(search.error as Error).message}</p>
                  : !hits.length ? <p className="text-sm text-muted-foreground">Nothing found for “{term}”{search.data?.results.length ? " in the selected project" : ""}.</p>
                  : (
                    <ul className="divide-y divide-border border border-border">
                      {hits.map((h) => {
                        const active = (h.LandId && h.LandId === landId) || (!h.LandId && h.EnquiryId === enquiryId);
                        return (
                          <li key={`${h.LandId}-${h.EnquiryId}`}>
                            <button onClick={() => open(h)} className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm hover:bg-primary/5 ${active ? "bg-primary/10" : ""}`}>
                              <b className="font-mono">{h.LandCode ?? h.EnquiryNo}</b>
                              <span>{h.LandName ?? h.EnquiryLocation}</span>
                              <span className="text-xs text-muted-foreground">{[h.MouzaName, h.LandId ? h.WorkflowStatus : `Enquiry · ${h.EnquiryStatus ?? ""}`].filter(Boolean).join(" · ")}</span>
                              <span className="ml-auto text-xs text-muted-foreground">Matched: {h.Matched}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
              </div>
            )}
          </div>

          {(landId || enquiryId) ? (
            detail.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
              : detail.error ? <p className="text-sm text-destructive">{(detail.error as Error).message}</p>
              : detail.data ? <LandView data={detail.data} /> : null
          ) : !term && (
            <p className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Type any number the land is known by to see its versions and amendments.</p>
          )}
        </div>
      </LegalShell>
    </>
  );
}
