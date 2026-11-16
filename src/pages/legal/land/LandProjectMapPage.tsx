import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { getLandProjectMap, setLandProject, type ProjectLand } from "@/api/legalLandApi";
import { getLegalLookup } from "@/api/legalMastersApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// Which company land serves which project. Only land whose deed is registered (Deed Registration → Submit) is listed;
// each sits under one project or "Not mapped yet". A project that does not exist yet can be created from here.

const NONE = "Existing land — project not set";

const areaText = (rows: ProjectLand[]) => {
  const byUnit = new Map<string, number>();
  rows.forEach((r) => r.Area && byUnit.set(r.UnitName || "", (byUnit.get(r.UnitName || "") ?? 0) + Number(r.Area)));
  return [...byUnit].map(([u, a]) => `${+a.toFixed(4)} ${u}`.trim()).join(" + ") || "—";
};

const stage = (l: ProjectLand) =>
  l.WorkflowStatus === "Registered" ? "Deed registered"
    : l.WorkflowStatus === "Deed Completed" ? "Deed completed"
    : l.WorkflowStatus === "Deed Process" ? "In Deed Process"
    : l.IsComplete ? "Approved"
    : l.IsOnHold ? "On hold"
    : "Final verification pending";

export default function LandProjectMapPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-land-project-map"], queryFn: getLandProjectMap });
  // "Create new project" for one land: name + company, then the land is mapped to it.
  const [creating, setCreating] = useState<{ land: ProjectLand; name: string; companyId: string; pick: string } | null>(null);
  const { data: companies = [] } = useQuery({ queryKey: ["legal-lookup", "company"], queryFn: () => getLegalLookup("company"), enabled: !!creating, staleTime: 5 * 60_000 });
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<number | null>(null);

  const lands = data?.lands ?? [];
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lands.filter((l) =>
      (!q || [l.LandCode, l.LandName, l.ProjectName, l.MouzaName, l.CurrentOwners].some((v) => v?.toLowerCase().includes(q))));
  }, [lands, search]);

  // Group by project; unmapped land last.
  const groups = useMemo(() => {
    const m = new Map<string, ProjectLand[]>();
    shown.forEach((l) => { const k = l.ProjectName ?? NONE; m.set(k, [...(m.get(k) ?? []), l]); });
    return [...m].sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)));
  }, [shown]);

  const move = async (l: ProjectLand, projectId: number | null) => {
    setSaving(l.LandId);
    try {
      await setLandProject(l.LandId, projectId);
      setCreating(null);
      toast.success(projectId ? `${l.LandCode} mapped to ${data?.projects.find((p) => p.id === projectId)?.name}` : `${l.LandCode} taken off its project`);
      await qc.invalidateQueries({ queryKey: ["legal-land-project-map"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the project");
    } finally {
      setSaving(null);
    }
  };

  const createProject = async () => {
    if (!creating) return;
    const name = creating.name.trim();
    if (!name) { toast.error("Enter the project name"); return; }
    setSaving(creating.land.LandId);
    try {
      // The ERP's own Project Master create (sets up the project the same way as Setup → Project Master).
      const res = await fetchWithAuth("/api/project-master", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, companyId: creating.companyId ? Number(creating.companyId) : null, status: "Planning", isActive: true }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 403 ? "Only an admin can create a project" : body?.error || "Could not create the project");
      const fresh = await getLandProjectMap();
      const made = fresh.projects.filter((p) => p.name === name).sort((a, b) => b.id - a.id)[0];
      if (!made) throw new Error("Project created, but it could not be found to map — pick it from the list");
      await setLandProject(creating.land.LandId, made.id);
      toast.success(`Project ${name} created and ${creating.land.LandCode} mapped to it`);
      setCreating(null);
      await qc.invalidateQueries({ queryKey: ["legal-land-project-map"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the project");
    } finally { setSaving(null); }
  };

  const tiles: [string, string][] = [
    ["Registered land", String(lands.length)],
    ["Projects with land", String(new Set(lands.filter((l) => l.ProjectId).map((l) => l.ProjectId)).size)],
    ["Existing land, project not set", String(lands.filter((l) => !l.ProjectId).length)],
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land & Projects"]} />
      <LegalShell
        title="Land & Projects"
        subtitle="Registered company land by project. Land from an enquiry takes the enquiry's project; only existing land without an enquiry needs its project set here."
        icon={Building}
      >
        <div className="mb-4 grid grid-cols-3 gap-3">
          {tiles.map(([l, v]) => (
            <div key={l} className="border border-border bg-card p-3">
              <div className="text-lg font-heading font-bold tabular-nums text-foreground">{v}</div>
              <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search land, project, mouza, owner…"
            className="ml-auto h-8 w-full rounded-lg border border-border bg-background px-3 text-xs sm:w-72" />
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {!isLoading && !error && groups.length === 0 && <p className="text-sm text-muted-foreground">No land matches.</p>}

        <div className="space-y-4">
          {groups.map(([project, rows]) => (
            <section key={project} className="border border-border bg-card">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className={`text-sm font-heading font-semibold ${project === NONE ? "text-muted-foreground" : "text-foreground"}`}>{project}</h2>
                <span className="text-xs text-muted-foreground">
                  {rows.length} land · {areaText(rows)}
                </span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 font-medium">Land ID</th>
                      <th className="px-3 py-2 font-medium">Land</th>
                      <th className="px-3 py-2 font-medium">Mouza / District</th>
                      <th className="px-3 py-2 text-right font-medium">Area</th>
                      <th className="px-3 py-2 font-medium">Current owners</th>
                      <th className="px-3 py-2 font-medium">Documents</th>
                      <th className="px-3 py-2 font-medium">Stage</th>
                      <th className="px-3 py-2 font-medium">Project</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.LandId} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-mono">{l.LandCode}</td>
                        <td className="px-3 py-2">
                          {l.LandName}
                          {l.LandStatus === "Disposed / Transferred" && <span className="ml-1.5 text-muted-foreground">(sold)</span>}
                        </td>
                        <td className="px-3 py-2">{[l.MouzaName, l.DistrictName].filter(Boolean).join(", ") || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.Area != null ? `${+Number(l.Area).toFixed(4)} ${l.UnitName ?? ""}` : "—"}</td>
                        <td className="px-3 py-2">{l.CurrentOwners || "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{l.Documents}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-1.5 py-0.5 ${l.IsComplete ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                            {stage(l)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {l.EnquiryNo ? (
                            // Project set on the enquiry (Land Enquiries are raised per project).
                            <span className="flex flex-col">
                              <span className="w-fit rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-foreground">{l.ProjectName ?? "—"}</span>
                              <span className="text-[0.6875rem] text-muted-foreground">from enquiry {l.EnquiryNo}</span>
                            </span>
                          ) : l.ProjectId ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-foreground">{l.ProjectName}</span>
                              <button className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setCreating({ land: l, name: "", companyId: "", pick: String(l.ProjectId) })}>Change</button>
                            </span>
                          ) : (
                            <button disabled={saving === l.LandId} onClick={() => setCreating({ land: l, name: "", companyId: "", pick: "" })}
                              title="Existing land (no enquiry): set its project here"
                              className="rounded-md border border-foreground px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-40">Set project</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
        {/* Map a land to a project: pick an existing one, or create a new project and map in one step. */}
        <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Map {creating?.land.LandCode} to a project</DialogTitle>
              <DialogDescription>{creating?.land.LandName}</DialogDescription>
            </DialogHeader>
            {creating && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Existing project</p>
                  <select value={creating.pick} onChange={(e) => setCreating({ ...creating, pick: e.target.value })}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                    <option value="">Select a project…</option>
                    {(data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={!creating.pick || saving === creating.land.LandId || creating.pick === String(creating.land.ProjectId ?? "")}
                      onClick={() => move(creating.land, Number(creating.pick))}
                      className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-40">Map</button>
                    {creating.land.ProjectId && (
                      <button disabled={saving === creating.land.LandId} onClick={() => move(creating.land, null)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Remove from {creating.land.ProjectName}</button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
                </div>

                <div className="space-y-2">
                  <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Create a new project</p>
                  <input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder="Project name"
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" />
                  <select value={creating.companyId} onChange={(e) => setCreating({ ...creating, companyId: e.target.value })}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                    <option value="">Company (optional)…</option>
                    {companies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <button disabled={!creating.name.trim() || saving === creating.land.LandId} onClick={createProject}
                    className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-40">Create & map</button>
                  <p className="text-[0.6875rem] text-muted-foreground">Admins only. Other project details can be filled later in Setup → Project Master.</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </LegalShell>
    </>
  );
}
