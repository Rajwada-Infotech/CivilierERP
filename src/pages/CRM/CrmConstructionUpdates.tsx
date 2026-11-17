// Read-only construction progression, sourced directly from DPR.
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Check, ChevronDown, HardHat, RefreshCw } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { KEY_LINE, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/construction-updates";
const pct = (value: unknown) => Math.min(100, Math.max(0, Number(value) || 0));
const ago = (value: unknown) => {
  if (!value) return "";
  const days = Math.floor((Date.now() - new Date(String(value)).getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
};

async function getJson(url: string, what: string) {
  const response = await fetchWithAuth(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Could not load ${what} (${response.status}).`);
  return payload;
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return <div className={`h-2 overflow-hidden bg-muted ${className}`}><div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct(value)}%` }} /></div>;
}

const CrmConstructionUpdates: React.FC = () => {
  const qc = useQueryClient();
  usePageRights("crm-construction-updates");
  const [selectedId, setSelectedId] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const projectsQ = useQuery({
    queryKey: ["crm-construction-progress"],
    queryFn: () => getJson(`${API}/progress`, "construction progress"),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
  const projects: any[] = projectsQ.data?.projects?.filter((project: any) => project.hasDpr) ?? [];
  const selected = selectedId ? projects.find((project) => String(project.projectId) === selectedId) : undefined;
  const detailUrl = selected ? `${API}/progress/${selected.projectId}${selectedBlockId ? `?blockId=${selectedBlockId}` : ""}` : "";
  const baseDetailQ = useQuery({
    queryKey: ["crm-construction-detail", selected?.projectId, selectedBlockId],
    queryFn: () => getJson(detailUrl, "project progression"),
    enabled: Boolean(selected?.projectId),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
  const unitDetailQ = useQuery({
    queryKey: ["crm-construction-unit-detail", selected?.projectId, selectedBlockId, selectedUnitId],
    queryFn: () => getJson(`${detailUrl}${detailUrl.includes("?") ? "&" : "?"}unitId=${selectedUnitId}`, "unit progression"),
    enabled: Boolean(selected?.projectId && selectedUnitId),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
  const detailQ = selectedUnitId ? unitDetailQ : baseDetailQ;
  const detail = detailQ.data;
  const selectedBlockName = baseDetailQ.data?.towers?.find((tower: any) => String(tower.blockId) === selectedBlockId)?.blockName;
  const selectedUnitName = baseDetailQ.data?.units?.find((unit: any) => String(unit.unitId) === selectedUnitId)?.unitName;
  const focusName = selectedUnitName || selectedBlockName || selected?.projectName;
  const focusType = selectedUnitId ? "Unit" : selectedBlockId ? "Block" : "Project";
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["crm-construction-progress"] });
    if (selected?.projectId) {
      qc.invalidateQueries({ queryKey: ["crm-construction-detail", selected.projectId] });
      qc.invalidateQueries({ queryKey: ["crm-construction-unit-detail", selected.projectId] });
    }
  };
  const updatedAt = detail?.feed?.[0]?.at;
  const completion = useMemo(() => pct(detail?.pct ?? selected?.pct), [detail?.pct, selected?.pct]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Construction Updates"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · After-sales"
        title="Construction Progress"
        subtitle="See how construction is progressing across your projects, blocks, and units."
        action={
          <button onClick={refresh} disabled={projectsQ.isFetching || detailQ.isFetching} aria-label="Refresh progression" title="Refresh progression" className={`${KEY_LINE} inline-flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60`}>
            <RefreshCw size={15} className={projectsQ.isFetching || detailQ.isFetching ? "animate-spin" : ""} /><span className="hidden sm:inline">Refresh</span>
          </button>
        }
      >
        <div className="space-y-5 pb-2">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: RULE_SOFT }}>
              <div><span className="label">{selected ? "Project" : "All projects"}</span><span className="ml-3 text-xs text-muted-foreground">{projects.length} project{projects.length === 1 ? "" : "s"}</span></div>
              <div className="relative w-full sm:w-72">
                <select aria-label="Select project" value={selected?.projectId ?? ""} onChange={(event) => { setSelectedId(event.target.value); setSelectedBlockId(""); setSelectedUnitId(""); }} className="h-9 w-full appearance-none border border-foreground/25 bg-background px-3 pr-9 text-sm outline-none focus:border-primary">
                  <option value="">Select a project</option>
                  {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            {selected && <div className="px-5 py-4 flex flex-wrap items-end justify-between gap-4">
              <div><div className="label">{focusType} progress</div><div className="mt-1 font-heading text-xl font-semibold text-foreground">{focusName}</div><div className="mt-1 text-xs text-muted-foreground">Automatically updated from site progress</div></div>
              <div className="text-right"><div className="font-heading text-4xl font-semibold tabular-nums text-foreground">{completion}%</div><div className="label mt-1">{focusType} complete</div></div>
            </div>}
          </div>

          {projectsQ.isError ? (
            <div className="bg-card px-5 py-4 text-sm text-destructive" style={{ border: RULE }}>{(projectsQ.error as Error).message}</div>
          ) : projectsQ.isLoading ? (
            <div className="bg-card p-10 text-center text-sm text-muted-foreground" style={{ border: RULE }}>Loading DPR progression…</div>
          ) : projects.length === 0 ? (
            <div className="bg-card px-6 py-16 text-center" style={{ border: RULE }}>
              <HardHat size={22} className="mx-auto text-muted-foreground" />
              <h2 className="mt-4 text-base font-semibold text-foreground">No DPR progression available</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Project progress will appear here automatically when site updates are recorded.</p>
            </div>
          ) : !selected ? (
            <>
              <div className="bg-card" style={{ border: RULE }}>
                <div className="px-5 py-3" style={{ borderBottom: RULE }}><span className="label text-foreground">All projects</span><span className="ml-3 text-xs text-muted-foreground">Portfolio overview</span></div>
                <div className="statrow four px-4 py-4 sm:px-5">
                  {[
                    { label: "Projects", value: projects.length, note: "With construction progress" },
                    { label: "Construction tasks", value: projects.reduce((n, p) => n + Number(p.steps || 0), 0), note: "Across all projects" },
                    { label: "Finished", value: projects.reduce((n, p) => n + Number(p.done || 0), 0), note: "Construction tasks complete" },
                    { label: "Underway", value: projects.reduce((n, p) => n + Number(p.moving || 0), 0), note: "Tasks currently active" },
                  ].map((metric) => <div key={metric.label}><span className="label">{metric.label}</span><div className="figure mt-2 text-2xl">{metric.value.toLocaleString("en-IN")}</div><div className="mt-1 text-xs text-muted-foreground">{metric.note}</div></div>)}
                </div>
              </div>

              <section className="bg-card" style={{ border: RULE }}>
                <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: RULE }}><h2 className="label m-0 text-foreground">Your projects</h2><span className="ml-auto label">Choose a project to see its progress</span></div>
                <div className="grid gap-0 md:grid-cols-2">
                  {projects.map((project, index) => <button key={project.projectId} onClick={() => { setSelectedId(String(project.projectId)); setSelectedBlockId(""); setSelectedUnitId(""); }} className={"group min-w-0 p-5 text-left transition-colors hover:bg-primary/5 " + (index % 2 ? "md:border-l" : "") + (index >= 2 ? " border-t" : "")} style={{ borderColor: "hsl(var(--foreground) / 0.15)" }}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0"><div className="truncate text-base font-semibold text-foreground">{project.projectName}</div><div className="mt-1 text-xs text-muted-foreground">{project.allDone ? "All construction tasks finished" : project.now?.length ? "Happening now · " + project.now.slice(0, 2).map((work: any) => work.name + " " + work.pct + "%").join(" · ") : project.next ? "Coming next · " + project.next : "Construction not started"}</div></div>
                      <div className="shrink-0 text-right"><div className="font-heading text-2xl font-semibold tabular-nums">{pct(project.pct)}%</div><div className="label mt-1">complete</div></div>
                    </div>
                    <ProgressBar value={project.pct} className="mt-4" />
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{Number(project.done || 0).toLocaleString("en-IN")} of {Number(project.steps || 0).toLocaleString("en-IN")} tasks finished</span><span className="font-semibold text-primary group-hover:underline">View project →</span></div>
                  </button>)}
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div><label htmlFor="construction-block" className="mb-1 block label">Block</label><select id="construction-block" value={selectedBlockId} onChange={(event) => { setSelectedBlockId(event.target.value); setSelectedUnitId(""); }} className="h-9 min-w-44 border border-foreground/25 bg-background px-3 text-sm">
                    <option value="">All blocks</option>
                    {(baseDetailQ.data?.towers ?? []).map((tower: any) => <option key={tower.blockId} value={tower.blockId}>{tower.blockName || `Block ${tower.blockId}`}</option>)}
                  </select></div>
                  {selectedBlockId && <div><label htmlFor="construction-unit" className="mb-1 block label">Unit in this block</label><select id="construction-unit" value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)} className="h-9 min-w-44 max-w-64 border border-foreground/25 bg-background px-3 text-sm">
                    <option value="">All units</option>
                    {(baseDetailQ.data?.units ?? []).map((unit: any) => <option key={unit.unitId} value={unit.unitId}>{unit.unitName}</option>)}
                  </select></div>}
                </div>
                <button onClick={() => { setSelectedId(""); setSelectedBlockId(""); setSelectedUnitId(""); }} className={`${KEY_LINE} h-9 px-3 text-xs`}>All projects</button>
              </div>
              {detailQ.isError && <div className="bg-card px-5 py-4 text-sm text-destructive" style={{ border: RULE }}>{(detailQ.error as Error).message}</div>}
              <div className="bg-card" style={{ border: RULE }}>
                <div className="statrow four px-4 py-4 sm:px-5">
                  {[
                    { label: "Construction tasks", value: detail?.steps ?? selected.steps ?? 0, note: "Tasks being tracked" },
                    { label: "Finished", value: detail?.done ?? selected.done ?? 0, note: "Tasks completed" },
                    { label: "Underway", value: detail?.moving ?? selected.moving ?? 0, note: "Tasks currently active" },
                    selectedBlockId || selectedUnitId
                      ? { label: "Tasks remaining", value: Math.max(0, Number(detail?.steps ?? selected.steps ?? 0) - Number(detail?.done ?? selected.done ?? 0)), note: "Not yet finished" }
                      : { label: "Behind schedule", value: detail?.late ?? selected.late ?? 0, note: "Past planned finish date" },
                  ].map((metric) => <div key={metric.label}><span className="label">{metric.label}</span><div className="figure mt-2 text-2xl">{metric.value.toLocaleString("en-IN")}</div><div className="mt-1 text-xs text-muted-foreground">{metric.note}</div></div>)}
                </div>
              </div>

              <section className="bg-card" style={{ border: RULE }}>
                <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: RULE }}><h3 className="label m-0 text-foreground">Construction stages</h3><span className="ml-auto label">In build order</span></div>
                {detailQ.isLoading ? <div className="px-5 py-8 text-sm text-muted-foreground">Loading work stages…</div> : (
                  <div className="px-5 py-1">
                    {(detail?.works ?? selected.works ?? []).map((work: any, index: number, list: any[]) => {
                      const finished = pct(work.pct) >= 100;
                      const active = !finished && ((detail?.now ?? selected.now ?? []).some((current: any) => current.name === work.name) || Number(work.moving) > 0);
                      return <div key={work.groupId ?? work.name} className="grid grid-cols-[2rem_minmax(8rem,0.7fr)_minmax(8rem,1fr)_3.5rem] items-center gap-3 py-3" style={{ borderBottom: index < list.length - 1 ? RULE_SOFT : undefined }}>
                        <span className={`grid h-7 w-7 place-items-center text-xs font-semibold ${finished ? "bg-emerald-50 text-emerald-700" : active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{finished ? <Check size={14} /> : String(index + 1).padStart(2, "0")}</span>
                        <div className="min-w-0"><div className="truncate text-sm font-medium">{work.name}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{finished ? "Complete" : active ? "In progress" : "Upcoming"} · {work.done} of {work.steps} tasks</div></div>
                        <ProgressBar value={work.pct} className="h-1.5" />
                        <span className="text-right text-xs font-semibold tabular-nums">{pct(work.pct)}%</span>
                      </div>;
                    })}
                    {!(detail?.works ?? selected.works ?? []).length && <p className="py-8 text-center text-sm text-muted-foreground">No work stages have been recorded in DPR.</p>}
                  </div>
                )}
              </section>

              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <section className="bg-card" style={{ border: RULE }}>
                <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: RULE }}><h3 className="label m-0 text-foreground">{selectedUnitId ? "Selected block" : "Progress by block"}</h3></div>
                  <div>
                    {(selectedBlockId ? (detail?.towers ?? []).filter((tower: any) => String(tower.blockId) === selectedBlockId) : (detail?.towers ?? selected.towers ?? [])).length ? (selectedBlockId ? (detail?.towers ?? []).filter((tower: any) => String(tower.blockId) === selectedBlockId) : (detail?.towers ?? selected.towers)).map((tower: any) => (
                      <div key={tower.blockId ?? tower.blockName} className="px-5 py-3" style={{ borderBottom: RULE_SOFT }}>
                        <div className="mb-2 flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{tower.blockName || "Unassigned tower"}</span><span className="text-xs font-semibold tabular-nums">{pct(tower.pct)}%</span></div><ProgressBar value={tower.pct} />
                      </div>
                    )) : <p className="px-5 py-8 text-center text-sm text-muted-foreground">Tower-level progression is not recorded in DPR.</p>}
                  </div>
                </section>

                <section className="bg-card" style={{ border: RULE }}>
                  <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: RULE }}><h3 className="label m-0 text-foreground">Latest site updates</h3></div>
                  <div>
                    {detailQ.isLoading ? <p className="px-5 py-8 text-sm text-muted-foreground">Loading recent activity…</p> : detail?.feed?.length ? detail.feed.slice(0, 8).map((event: any, index: number) => (
                      <div key={`${event.at}-${event.activity}-${index}`} className="flex gap-3 px-5 py-3" style={{ borderBottom: RULE_SOFT }}>
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${event.completed ? "bg-emerald-600" : "bg-primary"}`} />
                        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className="text-sm font-medium">{event.activity}</span><time className="text-xs text-muted-foreground">{ago(event.at)}</time></div><p className="mt-0.5 truncate text-xs text-muted-foreground">{[event.tower && `Tower ${event.tower}`, event.unit, event.room, event.work].filter(Boolean).join(" · ")}</p></div>
                        <span className="shrink-0 self-center text-xs font-semibold tabular-nums">{event.completed ? "Done" : event.from != null ? `${event.from}% → ${event.to}%` : `${event.to}%`}</span>
                      </div>
                    )) : <p className="px-5 py-8 text-center text-sm text-muted-foreground">No recent DPR progression records.</p>}
                  </div>
                  {updatedAt && <div className="px-5 py-2.5 text-[11px] text-muted-foreground" style={{ borderTop: RULE_SOFT }}>Latest recorded activity {ago(updatedAt).toLowerCase()}</div>}
                </section>
              </div>

                <section className="bg-card" style={{ border: RULE }}>
                  <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: RULE }}><h3 className="label m-0 text-foreground">{selectedBlockId ? `Units in ${selectedBlockName || "this block"}` : "Unit progress"}</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead><tr><th className="px-5 py-3">Unit</th><th className="px-5 py-3">Progress</th><th className="px-5 py-3">Current work</th><th className="px-5 py-3 text-right">Complete</th></tr></thead>
                    <tbody>{detail?.units?.length ? detail.units.filter((unit: any) => !selectedUnitId || String(unit.unitId) === selectedUnitId).map((unit: any) => <tr key={unit.unitId}><td className="px-5 py-3 font-medium">{unit.unitName}</td><td className="w-[30%] px-5 py-3"><ProgressBar value={unit.pct} /></td><td className="max-w-[20rem] truncate px-5 py-3 text-xs text-muted-foreground">{unit.now?.length ? unit.now.map((work: any) => `${work.name} ${work.pct}%`).join(" · ") : unit.next ? `Next: ${unit.next}` : "No active work"}</td><td className="px-5 py-3 text-right font-semibold tabular-nums">{pct(unit.pct)}%</td></tr>) : <tr><td colSpan={4} className="px-5 py-9 text-center text-sm text-muted-foreground">Unit-level progression is not recorded in DPR.</td></tr>}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          <p className="text-right text-[11px] text-muted-foreground">Read-only · Automatically refreshed every 2 minutes</p>
        </div>
      </SheetShell>
    </>
  );
};

export default CrmConstructionUpdates;
