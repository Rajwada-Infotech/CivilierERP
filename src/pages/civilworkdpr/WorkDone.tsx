import React, { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { getRoomInstancesForUnit } from "@/api/unitBhkConfigApi";
import { getDependencyMasters, getDependencyMaster, type DependencyMasterListRow, type LadderActivity } from "@/api/dependencyMasterApi";
import { ActivityChainPreview } from "@/pages/masters/DependencyMaster/components/ActivityChainPreview";
import { RungAssignmentModal } from "@/pages/civilworkdpr/RungAssignmentModal";
import { getReportedAssignments } from "@/api/dependencyActivityAssignmentApi";
import { AssignmentStatusSelect } from "@/components/civilworkdpr/AssignmentStatusSelect";
import {
  Hammer,
  Layers,
  Building2,
  LayoutGrid,
  DoorOpen,
  MapPin,
  GitBranch,
  Loader2,
  Tag,
  X,
  UserRound,
  CalendarDays,
  ListChecks,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ── Field styling — same cyan-accent convention as the rest of the Civil
// Work DPR module (see WorkerAttendance.tsx's inputCls). ────────────────────
const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

// Leaner variant for the Location row's Project/Tower/Floor/Unit/Room
// selects — same look as WorkerAttendance.tsx's filterInputCls, so a chain
// of five fields doesn't feel oversized next to the compact chips they
// collapse into once picked.
const leanInputCls =
  "w-full px-2.5 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const leanLabelCls = "text-[10px] font-heading font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1.5";

// unit-master already carries Project/Block/Floor for every unit — reusing
// that one flat list (same source CrmApplication.tsx's own Project -> Block
// -> Floor -> Unit tree picker derives from) instead of standing up a
// separate Tower/Floor master. There is no dedicated "Floor master": floor
// is just the FloorNo column on UnitMaster, so Floor options here are the
// distinct FloorNo values present under the selected Block, same as every
// other cascading picker in the app already does it.
const UNIT_API = "/api/unit-master";

// A picked location level collapses into one of these instead of staying a
// full-width dropdown — five equal-weight selects made every level look
// equally "in progress" even after it was done; a chip reads as settled and
// gives the row's space back to whichever level is actually next.
function LocationChip({
  icon: Icon,
  label,
  value,
  onClear,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-xs">
      <Icon size={11} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
      <button
        type="button"
        onClick={onClear}
        title={`Change ${label.toLowerCase()}`}
        className="ml-0.5 w-4 h-4 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-cyan-500/20 transition-colors"
      >
        <X size={10} />
      </button>
    </div>
  );
}

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
  const [activeAssignment, setActiveAssignment] = useState<{ rung: LadderActivity; chain: DependencyMasterListRow } | null>(null);

  // Dependency Chains browser — every chain with its allocated room and a
  // Pending/Done read on each of its activities, shown up front with no
  // Project/Tower/Floor/Unit selection required. This is deliberately NOT
  // the same view as the standalone Reporting page (that's the full
  // engineer/date/material/7-state-status table) — here it's grouped by
  // chain, shows the room each chain is already scoped to, and collapses
  // status to a single Pending/Done read so it's a fast glance, not a
  // management table.
  const { data: allChains = [] } = useQuery({
    queryKey: ["civilworkdpr-work-done-all-chains"],
    queryFn: getDependencyMasters,
    enabled: rights.canView,
  });
  const chainDetailQueries = useQueries({
    queries: (allChains as DependencyMasterListRow[]).map((c) => ({
      queryKey: ["civilworkdpr-work-done-dependency-detail", String(c.id)],
      queryFn: () => getDependencyMaster(c.id),
      enabled: rights.canView,
    })),
  });
  const { data: allAssignments = [] } = useQuery({
    queryKey: ["civilworkdpr-work-done-saved-flow"],
    queryFn: () => getReportedAssignments(),
    enabled: rights.canView,
  });
  const allAssignmentByRungId = useMemo(() => {
    const map = new Map<number, (typeof allAssignments)[number]>();
    allAssignments.forEach((a) => map.set(a.rungId, a));
    return map;
  }, [allAssignments]);

  // Group chains by the room they're allocated to — a room with several
  // chains (e.g. Bedroom 1 having both a Flooring Sequence and a Snag
  // Rectification chain) now shows as one collapsible cluster instead of
  // scattered rows, same grouping convention as GRN's PO grouping.
  const chainGroupsByRoom = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; scopePath: string; projectName: string | null; chains: { chain: DependencyMasterListRow; index: number }[] }
    >();
    (allChains as DependencyMasterListRow[]).forEach((chain, index) => {
      // Hide chains that are already fully allocated — this browser exists
      // to pick a chain and allocate work against it, so once every one of
      // its activities already has an assignment there's nothing left to do
      // here. A chain whose detail hasn't loaded yet (rungs still empty)
      // stays visible rather than being hidden before its status is known.
      const rungs = chainDetailQueries[index]?.data?.activities ?? [];
      const fullyAllocated =
        rungs.length > 0 &&
        rungs.every((rung) => rung.rungId != null && allAssignmentByRungId.has(rung.rungId));
      if (fullyAllocated) return;

      const key = chain.scopePath;
      if (!groups.has(key)) groups.set(key, { key, scopePath: key, projectName: chain.projectName, chains: [] });
      groups.get(key)!.chains.push({ chain, index });
    });
    return Array.from(groups.values());
  }, [allChains, chainDetailQueries, allAssignmentByRungId]);
  const [collapsedChainGroups, setCollapsedChainGroups] = useState<Record<string, boolean>>({});
  const toggleChainGroup = (key: string) =>
    setCollapsedChainGroups((prev) => ({ ...prev, [key]: !prev[key] }));

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

  // Dependency link — appears once a Room is selected. Work Allocation's
  // "Room" is a synthetic per-category instance (RoomCompositionBuilder's
  // category+quantity model, no real dbo.RoomMaster row behind it — see
  // RoomInstance's {key,label} shape), while a Dependency Master's own scope
  // is tied to a real RoomMaster row. The two "Room" concepts can't be
  // cross-referenced, so matching is scoped to Project/Tower/Floor/Unit —
  // the levels both sides genuinely share — and the user picks the specific
  // chain themselves rather than the page guessing a Room match that isn't
  // really there.
  const [linkedDependencyId, setLinkedDependencyId] = useState<string>("");
  const { data: allDependencies = [], isLoading: loadingDependencies } = useQuery({
    queryKey: ["civilworkdpr-work-done-dependencies"],
    queryFn: getDependencyMasters,
    staleTime: 60 * 1000,
    enabled: !!form.RoomId,
  });
  const matchingDependencies = useMemo(() => {
    if (!form.RoomId) return [];
    return (allDependencies as DependencyMasterListRow[]).filter(
      (d) =>
        String(d.projectId) === form.ProjectId &&
        String(d.towerId) === form.BlockId &&
        String(d.floor) === form.FloorNo &&
        String(d.flatId) === form.UnitId,
    );
  }, [allDependencies, form.ProjectId, form.BlockId, form.FloorNo, form.UnitId, form.RoomId]);
  const linkedDependency = useMemo(
    () => matchingDependencies.find((d) => String(d.id) === linkedDependencyId) || null,
    [matchingDependencies, linkedDependencyId],
  );
  const { data: linkedDependencyDetail, isLoading: loadingDependencyDetail } = useQuery({
    queryKey: ["civilworkdpr-work-done-dependency-detail", linkedDependencyId],
    queryFn: () => getDependencyMaster(parseInt(linkedDependencyId, 10)),
    enabled: !!linkedDependencyId,
  });

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
  // The linked dependency is scoped to Project/Tower/Floor/Unit too, so it
  // resets right alongside them.
  const handleProjectChange = (v: string) => {
    setForm({ ProjectId: v, BlockId: "", FloorNo: "", UnitId: "", RoomId: "" });
    setLinkedDependencyId("");
  };
  const handleTowerChange = (v: string) => {
    setForm((f) => ({ ...f, BlockId: v, FloorNo: "", UnitId: "", RoomId: "" }));
    setLinkedDependencyId("");
  };
  const handleFloorChange = (v: string) => {
    setForm((f) => ({ ...f, FloorNo: v, UnitId: "", RoomId: "" }));
    setLinkedDependencyId("");
  };
  const handleUnitChange = (v: string) => {
    setForm((f) => ({ ...f, UnitId: v, RoomId: "" }));
    setLinkedDependencyId("");
  };
  const handleRoomChange = (v: string) => {
    setForm((f) => ({ ...f, RoomId: v }));
    setLinkedDependencyId("");
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Work Allocation" },
        ]}
      />
      <CivilWorkDprShell
        title="Work Allocation"
        subtitle="Tag a work-done entry to the exact Project / Tower / Floor / Unit"
        icon={Hammer}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
              <MapPin size={14} className="text-cyan-600 dark:text-cyan-400" />
              <span className="text-sm font-heading font-semibold text-foreground">
                Location
              </span>
            </div>

            <div className="p-5">
              {/* Each level collapses into a chip once picked (see
                  LocationChip) and only the next level's dropdown is ever
                  rendered — nothing downstream shows until its parent is
                  chosen, so the row is always just "what's settled" plus
                  exactly one active control. */}
              <div className="flex flex-wrap items-end gap-2.5">
                {/* 1. Project */}
                {loadingMasters ? (
                  <div className="w-56 h-[30px] rounded-lg border border-border bg-muted/30 animate-pulse" />
                ) : form.ProjectId && selectedProject ? (
                  <LocationChip
                    icon={Building2}
                    label="Project"
                    value={selectedProject.Name}
                    onClear={() => handleProjectChange("")}
                  />
                ) : (
                  <div className="w-full sm:w-56">
                    <label className={leanLabelCls}>
                      <Building2 size={11} /> Project
                    </label>
                    <select value={form.ProjectId} onChange={(e) => handleProjectChange(e.target.value)} className={leanInputCls}>
                      <option value="">Select project…</option>
                      {(projects as any[]).map((p: any) => (
                        <option key={p.Id} value={String(p.Id)}>
                          {p.Name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 2. Tower / Block — depends on Project */}
                {form.ProjectId &&
                  (form.BlockId && selectedTower ? (
                    <LocationChip
                      icon={Layers}
                      label="Tower"
                      value={selectedTower.Name}
                      onClear={() => handleTowerChange("")}
                    />
                  ) : (
                    <div className="w-full sm:w-48">
                      <label className={leanLabelCls}>
                        <Layers size={11} /> Tower
                      </label>
                      <select value={form.BlockId} onChange={(e) => handleTowerChange(e.target.value)} className={leanInputCls}>
                        <option value="">Select tower…</option>
                        {towersForProject.map((t) => (
                          <option key={t.Id} value={t.Id}>
                            {t.Name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}

                {/* 3. Floor — depends on Tower */}
                {form.BlockId &&
                  (form.FloorNo ? (
                    <LocationChip icon={LayoutGrid} label="Floor" value={form.FloorNo} onClear={() => handleFloorChange("")} />
                  ) : (
                    <div className="w-full sm:w-36">
                      <label className={leanLabelCls}>
                        <LayoutGrid size={11} /> Floor
                      </label>
                      <select value={form.FloorNo} onChange={(e) => handleFloorChange(e.target.value)} className={leanInputCls}>
                        <option value="">Select floor…</option>
                        {floorsForTower.map((fl) => (
                          <option key={fl} value={fl}>
                            Floor {fl}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}

                {/* 4. Unit — depends on Floor */}
                {form.FloorNo &&
                  (form.UnitId && selectedUnit ? (
                    <LocationChip icon={DoorOpen} label="Unit" value={selectedUnit.UnitName} onClear={() => handleUnitChange("")} />
                  ) : (
                    <div className="w-full sm:w-48">
                      <label className={leanLabelCls}>
                        <DoorOpen size={11} /> Unit
                      </label>
                      <select value={form.UnitId} onChange={(e) => handleUnitChange(e.target.value)} className={leanInputCls}>
                        <option value="">Select unit…</option>
                        {unitsForFloor.map((u: any) => (
                          <option key={u.Id} value={String(u.Id)}>
                            {u.UnitName}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}

                {/* 5. Room — generated from the selected Unit's saved room
                    composition (Room Category Master x quantity, via
                    RoomCompositionBuilder.tsx). */}
                {form.UnitId &&
                  (form.RoomId ? (
                    <LocationChip
                      icon={DoorOpen}
                      label="Room"
                      value={roomInstances.find((r) => r.key === form.RoomId)?.label || form.RoomId}
                      onClear={() => handleRoomChange("")}
                    />
                  ) : (
                    <div className="w-full sm:w-48">
                      <label className={leanLabelCls}>
                        <DoorOpen size={11} /> Room
                      </label>
                      <select
                        value={form.RoomId}
                        onChange={(e) => handleRoomChange(e.target.value)}
                        disabled={loadingRooms || roomInstances.length === 0}
                        className={leanInputCls}
                      >
                        <option value="">
                          {loadingRooms
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
                  ))}
              </div>
            </div>
          </div>

          {/* Dependency Chains browser — every chain grouped by the room
              it's allocated to, each activity showing a Pending/Done read,
              with no Project/Tower/Floor/Unit selection needed. Click an
              activity to open the same assign/edit popup used below. */}
          {allChains.length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                <GitBranch size={14} className="text-cyan-600 dark:text-cyan-400" />
                <span className="text-sm font-heading font-semibold text-foreground">Dependency Chains</span>
              </div>
              <div className="divide-y divide-border">
                {chainGroupsByRoom.map((group) => {
                  const collapsed = !!collapsedChainGroups[group.key];
                  return (
                    <div key={group.key}>
                      {/* Group header — every chain allocated to this room */}
                      <button
                        type="button"
                        onClick={() => toggleChainGroup(group.key)}
                        className="w-full flex items-center gap-2.5 px-5 py-3 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
                      >
                        {collapsed ? (
                          <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                        )}
                        <MapPin size={13} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                        <span className="text-sm font-heading font-semibold text-foreground truncate">
                          {group.projectName ? `${group.projectName} > ` : ""}
                          {group.scopePath}
                        </span>
                        <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                          {group.chains.length} chain{group.chains.length !== 1 ? "s" : ""}
                        </span>
                      </button>

                      {!collapsed && (
                        <div className="divide-y divide-border">
                          {group.chains.map(({ chain, index }) => {
                            const detail = chainDetailQueries[index]?.data;
                            const rungs = detail?.activities ?? [];
                            return (
                              <div key={chain.id} className="px-5 py-4 space-y-2.5">
                                <div>
                                  <span className="text-sm font-semibold text-foreground">{chain.alias}</span>
                                  <span
                                    className={`ml-2 text-[10px] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                                      chain.workType === "INTERNAL"
                                        ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                                        : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                                    }`}
                                  >
                                    {chain.workType}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {rungs.length === 0 ? (
                                    <span className="text-xs text-muted-foreground italic">Loading activities…</span>
                                  ) : (
                                    rungs.map((rung) => {
                                      const assignment = rung.rungId != null ? allAssignmentByRungId.get(rung.rungId) : undefined;
                                      const done = assignment?.status === "COMPLETED";
                                      return (
                                        <button
                                          key={rung.rungId ?? rung.activityId}
                                          type="button"
                                          onClick={() => setActiveAssignment({ rung, chain })}
                                          className={`flex items-center gap-1.5 rounded-full border pl-2 pr-2.5 py-1 text-xs transition-colors ${
                                            done
                                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                              : "border-border bg-muted/40 text-foreground hover:bg-muted"
                                          }`}
                                          title="Assign engineer & material"
                                        >
                                          <span className="font-medium">
                                            {rung.sequenceNo}. {rung.activityName}
                                          </span>
                                          <span
                                            className={`text-[9px] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                                              done
                                                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                                                : "bg-slate-500/15 text-slate-600 dark:text-slate-400"
                                            }`}
                                          >
                                            {done ? "Done" : "Pending"}
                                          </span>
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </>
        )}

        {/* Link Dependency — appears once a Room is picked above. Scoped to
            Project/Tower/Floor/Unit (see the note by matchingDependencies)
            rather than an exact Room match, since Work Allocation's Room is
            synthetic and Dependency Master's isn't. */}
        {rights.canView && form.RoomId && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
              <GitBranch size={14} className="text-cyan-600 dark:text-cyan-400" />
              <span className="text-sm font-heading font-semibold text-foreground">
                Link Dependency
              </span>
            </div>

            <div className="p-5 space-y-4">
              {loadingDependencies ? (
                <div className="w-full h-10 rounded-lg border border-border bg-muted/30 animate-pulse" />
              ) : matchingDependencies.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                  No dependency chains are configured for this unit yet.{" "}
                  <a href="/masters/dependency/new" className="text-cyan-600 dark:text-cyan-400 hover:underline font-medium">
                    Set one up in Dependency Master
                  </a>
                  .
                </div>
              ) : (
                <>
                  <div>
                    <label className={labelCls}>
                      <Tag size={11} /> Dependency Chain
                    </label>
                    <select
                      value={linkedDependencyId}
                      onChange={(e) => setLinkedDependencyId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select a dependency chain…</option>
                      {matchingDependencies.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.alias} — {d.roomName || "Room"} — {d.workType} ({d.activityCount} step{d.activityCount === 1 ? "" : "s"})
                        </option>
                      ))}
                    </select>
                  </div>

                  {linkedDependency && (
                    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">{linkedDependency.alias}</span>
                        <span
                          className={`text-[10px] font-heading font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                            linkedDependency.workType === "INTERNAL"
                              ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                              : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                          }`}
                        >
                          {linkedDependency.workType}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{linkedDependency.scopePath}</p>
                      {loadingDependencyDetail ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                          <Loader2 size={12} className="animate-spin" /> Loading activity chain…
                        </div>
                      ) : (
                        <ActivityChainPreview
                          rungs={linkedDependencyDetail?.activities ?? []}
                          onRungClick={(rung) => setActiveAssignment({ rung, chain: linkedDependency })}
                        />
                      )}
                    </div>
                  )}

                  {/* Saved flow — what's already been recorded for this
                      chain's rungs via the popup above (click a chip to
                      assign/edit). Rungs with nothing saved yet still show,
                      muted, so the list reads as the whole chain's progress
                      rather than just the assigned subset. Same table shape
                      as the standalone Reporting page, minus the
                      Location/Chain columns — those are already fixed by
                      the chip row and chain card above. */}
                  {linkedDependency && !loadingDependencyDetail && (linkedDependencyDetail?.activities?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelCls}>
                        <ListChecks size={11} /> Saved Flow
                      </label>
                      <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide">
                              <th className="px-3.5 py-2.5">Activity</th>
                              <th className="px-3 py-2.5">Engineer</th>
                              <th className="px-3 py-2.5">Start Date</th>
                              <th className="px-3 py-2.5">Material</th>
                              <th className="px-3.5 py-2.5">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(linkedDependencyDetail?.activities ?? []).map((rung) => {
                              const assignment = rung.rungId != null ? allAssignmentByRungId.get(rung.rungId) : undefined;
                              return (
                                <tr
                                  key={`${rung.rungId ?? rung.activityId}-${rung.sequenceNo}`}
                                  className="border-b border-border last:border-0 hover:bg-muted/20"
                                >
                                  <td className="px-3.5 py-3">
                                    <span className="text-xs font-medium text-foreground">
                                      {rung.sequenceNo}. {rung.activityName}
                                    </span>
                                  </td>
                                  {assignment ? (
                                    <>
                                      <td className="px-3 py-3">
                                        <span className="flex items-center gap-1.5 text-xs text-foreground">
                                          <UserRound size={11} className="text-muted-foreground shrink-0" />
                                          {assignment.engineerNames || (
                                            <span className="text-muted-foreground italic">Unassigned</span>
                                          )}
                                        </span>
                                      </td>
                                      <td className="px-3 py-3">
                                        <span className="flex items-center gap-1.5 text-xs text-foreground whitespace-nowrap">
                                          <CalendarDays size={11} className="text-muted-foreground shrink-0" />
                                          {assignment.startDate ? new Date(assignment.startDate).toLocaleDateString() : "—"}
                                        </span>
                                      </td>
                                      <td className="px-3 py-3">
                                        {assignment.materials.length === 0 ? (
                                          <span className="text-xs text-muted-foreground italic">—</span>
                                        ) : (
                                          <div className="flex flex-col gap-0.5">
                                            {assignment.materials.map((m, i) => (
                                              <span key={i} className="text-xs text-foreground whitespace-nowrap">
                                                {m.name}
                                                <span className="text-muted-foreground">
                                                  {" "}
                                                  · {m.quantity}
                                                  {m.uom ? ` ${m.uom}` : ""}
                                                </span>
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-3.5 py-3">
                                        <AssignmentStatusSelect rungId={assignment.rungId} status={assignment.status} />
                                      </td>
                                    </>
                                  ) : (
                                    <td colSpan={4} className="px-3 py-3">
                                      <span className="text-xs text-muted-foreground italic">Not assigned yet</span>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </CivilWorkDprShell>
      {activeAssignment && (
        <RungAssignmentModal
          rung={activeAssignment.rung}
          chain={activeAssignment.chain}
          onClose={() => setActiveAssignment(null)}
        />
      )}
    </>
  );
}
