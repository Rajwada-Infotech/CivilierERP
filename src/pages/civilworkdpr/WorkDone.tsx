import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { getRoomInstancesForUnit } from "@/api/unitBhkConfigApi";
import { getDependencyMasters, getDependencyMaster, type DependencyMasterListRow } from "@/api/dependencyMasterApi";
import { ActivityChainPreview } from "@/pages/masters/DependencyMaster/components/ActivityChainPreview";
import { Hammer, Layers, Building2, LayoutGrid, DoorOpen, MapPin, GitBranch, Loader2, Tag } from "lucide-react";

// ── Field styling — same cyan-accent convention as the rest of the Civil
// Work DPR module (see WorkerAttendance.tsx's inputCls). ────────────────────
const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

// unit-master already carries Project/Block/Floor for every unit — reusing
// that one flat list (same source CrmApplication.tsx's own Project -> Block
// -> Floor -> Unit tree picker derives from) instead of standing up a
// separate Tower/Floor master. There is no dedicated "Floor master": floor
// is just the FloorNo column on UnitMaster, so Floor options here are the
// distinct FloorNo values present under the selected Block, same as every
// other cascading picker in the app already does it.
const UNIT_API = "/api/unit-master";

async function fetchProjects(): Promise<{ Id: number; Name: string }[]> {
  try {
    const r = await fetchWithAuth(`${UNIT_API}/projects`);
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}
async function fetchUnits(): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${UNIT_API}?isActive=1`);
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}

interface WorkDoneLocationForm {
  ProjectId: string;
  BlockId: string;
  FloorNo: string;
  UnitId: string;
  // Value is the synthetic "<categoryId>-<index>" key from
  // getRoomInstancesForUnit — there's no per-room table yet, just a
  // category+quantity count, so this key only ever exists for the
  // lifetime of this form (nothing persists it).
  RoomId: string;
}
const EMPTY_FORM: WorkDoneLocationForm = { ProjectId: "", BlockId: "", FloorNo: "", UnitId: "", RoomId: "" };

export default function WorkDone() {
  const rights = usePageRights("civilworkdpr-work-done");
  const [form, setForm] = useState<WorkDoneLocationForm>(EMPTY_FORM);

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["civilworkdpr-work-done-projects"],
    queryFn: fetchProjects,
    staleTime: 5 * 60 * 1000,
  });
  const { data: units = [], isLoading: loadingUnits } = useQuery({
    queryKey: ["civilworkdpr-work-done-units"],
    queryFn: fetchUnits,
    staleTime: 5 * 60 * 1000,
  });
  const loadingMasters = loadingProjects || loadingUnits;

  // Tree: Project -> Tower/Block -> Floor -> Unit, all derived client-side
  // from the flat UnitMaster list — same lightweight cascade pattern
  // CrmApplication.tsx's own Project/Block/Floor/Unit picker already uses,
  // reused here rather than duplicated against a second API shape.
  const unitsForProject = useMemo(() => {
    if (!form.ProjectId) return [];
    return (units as any[]).filter((u: any) => String(u.ProjectId) === form.ProjectId);
  }, [units, form.ProjectId]);

  const towersForProject = useMemo(() => {
    const map = new Map<string, string>();
    unitsForProject.forEach((u: any) => {
      if (u.BlockId != null) map.set(String(u.BlockId), u.BlockName);
    });
    return Array.from(map, ([Id, Name]) => ({ Id, Name }));
  }, [unitsForProject]);

  const unitsForTower = useMemo(() => {
    if (!form.BlockId) return [];
    return unitsForProject.filter((u: any) => String(u.BlockId) === form.BlockId);
  }, [unitsForProject, form.BlockId]);

  const floorsForTower = useMemo(() => {
    const set = new Set<string>();
    unitsForTower.forEach((u: any) => {
      if (u.FloorNo != null) set.add(String(u.FloorNo));
    });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [unitsForTower]);

  const unitsForFloor = useMemo(() => {
    if (!form.FloorNo) return [];
    return unitsForTower.filter((u: any) => String(u.FloorNo) === form.FloorNo);
  }, [unitsForTower, form.FloorNo]);

  const selectedUnit = useMemo(
    () => (units as any[]).find((u: any) => String(u.Id) === form.UnitId) || null,
    [units, form.UnitId],
  );

  // Room instances (Bathroom 1, Bathroom 2, ...) generated live from the
  // selected Unit's saved room composition — current Alias at render time,
  // so a renamed category shows up immediately without touching any stored
  // data (see RoomCompositionBuilder.tsx / RoomCategoryMaster.tsx).
  const selectedUnitId = form.UnitId ? parseInt(form.UnitId, 10) : null;
  const { data: roomInstances = [], isLoading: loadingRooms } = useQuery({
    queryKey: ["work-done-room-instances", selectedUnitId],
    queryFn: () => getRoomInstancesForUnit(selectedUnitId as number),
    enabled: !!selectedUnitId,
  });
  const selectedProject = useMemo(
    () => (projects as any[]).find((p: any) => String(p.Id) === form.ProjectId) || null,
    [projects, form.ProjectId],
  );
  const selectedTower = useMemo(
    () => towersForProject.find((t) => t.Id === form.BlockId) || null,
    [towersForProject, form.BlockId],
  );

  // Changing any parent level clears every level below it — nothing
  // dependent is ever left pointing at a selection that no longer applies.
  const handleProjectChange = (v: string) =>
    setForm({ ProjectId: v, BlockId: "", FloorNo: "", UnitId: "", RoomId: "" });
  const handleTowerChange = (v: string) =>
    setForm((f) => ({ ...f, BlockId: v, FloorNo: "", UnitId: "", RoomId: "" }));
  const handleFloorChange = (v: string) =>
    setForm((f) => ({ ...f, FloorNo: v, UnitId: "", RoomId: "" }));
  const handleUnitChange = (v: string) =>
    setForm((f) => ({ ...f, UnitId: v, RoomId: "" }));

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Work Done" },
        ]}
      />
      <CivilWorkDprShell
        title="Work Done"
        subtitle="Tag a work-done entry to the exact Project / Tower / Floor / Unit"
        icon={Hammer}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
              <MapPin size={14} className="text-cyan-600 dark:text-cyan-400" />
              <span className="text-sm font-heading font-semibold text-foreground">
                Location
              </span>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* 1. Project */}
                <div>
                  <label className={labelCls}>
                    <Building2 size={11} /> Project
                  </label>
                  {loadingMasters ? (
                    <div className="w-full h-10 rounded-lg border border-border bg-muted/30 animate-pulse" />
                  ) : (
                    <select value={form.ProjectId} onChange={(e) => handleProjectChange(e.target.value)} className={inputCls}>
                      <option value="">Select project…</option>
                      {(projects as any[]).map((p: any) => (
                        <option key={p.Id} value={String(p.Id)}>
                          {p.Name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 2. Tower / Block — depends on Project */}
                <div>
                  <label className={labelCls}>
                    <Layers size={11} /> Tower
                  </label>
                  <select
                    value={form.BlockId}
                    onChange={(e) => handleTowerChange(e.target.value)}
                    disabled={!form.ProjectId}
                    className={inputCls}
                  >
                    <option value="">
                      {!form.ProjectId ? "Select a project first" : "Select tower…"}
                    </option>
                    {towersForProject.map((t) => (
                      <option key={t.Id} value={t.Id}>
                        {t.Name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3. Floor — depends on Tower */}
                <div>
                  <label className={labelCls}>
                    <LayoutGrid size={11} /> Floor
                  </label>
                  <select
                    value={form.FloorNo}
                    onChange={(e) => handleFloorChange(e.target.value)}
                    disabled={!form.BlockId}
                    className={inputCls}
                  >
                    <option value="">
                      {!form.BlockId ? "Select a tower first" : "Select floor…"}
                    </option>
                    {floorsForTower.map((fl) => (
                      <option key={fl} value={fl}>
                        Floor {fl}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 4. Unit — depends on Floor */}
                <div>
                  <label className={labelCls}>
                    <DoorOpen size={11} /> Unit
                  </label>
                  <select
                    value={form.UnitId}
                    onChange={(e) => handleUnitChange(e.target.value)}
                    disabled={!form.FloorNo}
                    className={inputCls}
                  >
                    <option value="">
                      {!form.FloorNo ? "Select a floor first" : "Select unit…"}
                    </option>
                    {unitsForFloor.map((u: any) => (
                      <option key={u.Id} value={String(u.Id)}>
                        {u.UnitName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 5. Room — generated from the selected Unit's saved room
                    composition (Room Category Master x quantity, via
                    RoomCompositionBuilder.tsx). Empty/disabled until a Unit
                    with a saved composition is picked. */}
                <div>
                  <label className={labelCls}>
                    <DoorOpen size={11} /> Room
                  </label>
                  <select
                    value={form.RoomId}
                    onChange={(e) => setForm((f) => ({ ...f, RoomId: e.target.value }))}
                    disabled={!form.UnitId || loadingRooms || roomInstances.length === 0}
                    className={inputCls}
                  >
                    <option value="">
                      {!form.UnitId
                        ? "Select a unit first"
                        : loadingRooms
                          ? "Loading rooms…"
                          : roomInstances.length === 0
                            ? "No rooms configured for this unit"
                            : "Select room…"}
                    </option>
                    {roomInstances.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Selected-location summary — pure UX confirmation, no save/
                  submit wired up yet since none was specified for this
                  first slice of the page. */}
              {selectedUnit && (
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 flex items-center gap-2 text-sm">
                  <MapPin size={14} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                  <span className="text-foreground">
                    <span className="font-semibold">{selectedProject?.Name}</span>
                    {selectedTower && <> — {selectedTower.Name}</>}
                    {form.FloorNo && <> — Floor {form.FloorNo}</>}
                    <> — {selectedUnit.UnitName}</>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </CivilWorkDprShell>
    </>
  );
}
