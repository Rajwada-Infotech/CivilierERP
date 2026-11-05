import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { getLandProjectMap, setLandProject, type ProjectLand } from "@/api/legalLandApi";

// Which company land serves which project. Every land sits under one project (or "Not mapped yet"), split into
// Complete (documents in, verified and fully approved — L2) and Under process (anything still in draft / L1 / L2).
// Only approved land can be mapped; land under process shows "After approval".

type View = "all" | "complete" | "process";
const small = "rounded-md border border-border px-2 py-1 text-xs hover:bg-muted";
const NONE = "Not mapped to a project yet";

const areaText = (rows: ProjectLand[]) => {
  const byUnit = new Map<string, number>();
  rows.forEach((r) => r.Area && byUnit.set(r.UnitName || "", (byUnit.get(r.UnitName || "") ?? 0) + Number(r.Area)));
  return [...byUnit].map(([u, a]) => `${+a.toFixed(4)} ${u}`.trim()).join(" + ") || "—";
};

const stage = (l: ProjectLand) =>
  l.IsComplete ? "Approved"
    : l.IsOnHold ? "On hold"
    : l.L2Status === "Rejected" ? "Rejected"
    : l.L1Status === "Approved" ? "Waiting for L2 approval"
    : l.VerificationStatus === "Verified" ? "Waiting for L1 review"
    : "Verification pending";

export default function LandProjectMapPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-land-project-map"], queryFn: getLandProjectMap });
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<number | null>(null);

  const lands = data?.lands ?? [];
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lands.filter((l) =>
      (view === "all" || (view === "complete" ? l.IsComplete : !l.IsComplete)) &&
      (!q || [l.LandCode, l.LandName, l.ProjectName, l.MouzaName, l.CurrentOwners].some((v) => v?.toLowerCase().includes(q))));
  }, [lands, view, search]);

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
      toast.success(projectId ? `${l.LandCode} mapped to ${data?.projects.find((p) => p.id === projectId)?.name}` : `${l.LandCode} taken off its project`);
      await qc.invalidateQueries({ queryKey: ["legal-land-project-map"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the project");
    } finally {
      setSaving(null);
    }
  };

  const complete = lands.filter((l) => l.IsComplete).length;
  const tiles: [string, string][] = [
    ["Company land", String(lands.length)],
    ["Complete (approved)", String(complete)],
    ["Under process", String(lands.length - complete)],
    ["Projects with land", String(new Set(lands.filter((l) => l.ProjectId).map((l) => l.ProjectId)).size)],
    ["Not mapped yet", String(lands.filter((l) => !l.ProjectId).length)],
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land & Projects"]} />
      <LegalShell
        title="Land & Projects"
        subtitle="Which company land is under which project. Complete = all documents in, verified and fully approved (L2); everything else is under process. Only approved land can be mapped to a project."
        icon={Building}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(([l, v]) => (
            <div key={l} className="border border-border bg-card p-3">
              <div className="text-lg font-heading font-bold tabular-nums text-foreground">{v}</div>
              <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {([["all", "All land"], ["complete", "Complete"], ["process", "Under process"]] as [View, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${view === k ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
              {label}
            </button>
          ))}
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
                  {rows.length} land · {areaText(rows)} · {rows.filter((r) => r.IsComplete).length} complete, {rows.filter((r) => !r.IsComplete).length} under process
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
                      <th className="px-3 py-2 font-medium">Approval stage</th>
                      <th className="px-3 py-2 font-medium">Project</th>
                      <th className="px-3 py-2" />
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
                          {!l.IsComplete && !l.ProjectId ? <span className="text-muted-foreground">After approval</span> : (
                          <select value={l.ProjectId ?? ""} disabled={saving === l.LandId}
                            onChange={(e) => move(l, e.target.value ? Number(e.target.value) : null)}
                            className="h-7 max-w-[200px] rounded-md border border-border bg-background px-1.5 text-xs">
                            <option value="">— Not mapped —</option>
                            {l.IsComplete && (data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            {!l.IsComplete && l.ProjectId && <option value={l.ProjectId}>{l.ProjectName}</option>}
                          </select>)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button className={small} onClick={() => navigate(`/legal/land/properties/${l.LandId}`)}>Land</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </LegalShell>
    </>
  );
}
