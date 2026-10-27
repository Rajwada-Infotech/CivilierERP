import { useSheetAsk } from "@/components/sheet/SheetAsk";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateRoomData } from "@/lib/roomQueries";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ChevronDown, ChevronRight, Pencil, Plus, X } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { NamingPanel } from "./autoSetup/NamingPanel";
import { ProjectTypeBar } from "./autoSetup/ProjectTypeBar";
import { BlockStackEditor } from "./autoSetup/BlockStackEditor";
import ParkingSetup from "./autoSetup/ParkingSetup";
import { ProjectPicker } from "./autoSetup/ProjectPicker";
import { BlockFloorTree, FloorUnitList, TowerOverview, useUnitEditing } from "./autoSetup/UnitTree";
import { LandInventory, PlotLayoutStep, PlotOverview, PlotSummaryPanel } from "./autoSetup/PlotParts";
import {
  API, EMPTY_ITEMS, INP, KEY_INK, KEY_LINE, LBL, NUM, Notice, PANEL, RULE, RULE_SOFT, Section, SetupProgress, TEXT_LINK, chip,
  fetchApplicablePlans, fetchStatus, generateNames, isDuplicateBlockName, plural,
  type KindRow, type NamingScheme, type PaymentPlan, type PlotSummary,
} from "./autoSetup/config";
import { getLayoutTypes, LAYOUT_TYPES_QUERY_KEY, type LayoutType } from "@/api/unitBhkConfigApi";

const CrmProjectAutoSetup: React.FC = () => {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const rights = usePageRights("crm-auto-project-setup");
  // Parking is a separate component with its own project and state (no route change), so nothing on one tab
  // refetches or re-renders the other.
  const [activeTab, setActiveTab] = useState<"setup" | "parking">("setup");
  // Strict Company -> Project gate, as on every Company -> Project master.
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [blockCount, setBlockCount] = useState("2");
  const [namingScheme, setNamingScheme] = useState<NamingScheme>("Alphabetical");
  const [blockNames, setBlockNames] = useState<string[]>(generateNames(2, "Alphabetical"));
  const [floorCounts, setFloorCounts] = useState<Record<number, string>>({});
  const [savingBlocks, setSavingBlocks] = useState(false);
  const [savingFloors, setSavingFloors] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editingBlockName, setEditingBlockName] = useState("");
  // "Add more blocks" opens on demand once blocks exist; a new project shows the create form.
  const [showAddBlockForm, setShowAddBlockForm] = useState(false);
  // Rename / delete on blocks and floors sit behind an Edit toggle, so a visit to read the plan isn't all pencils.
  const [blocksEditMode, setBlocksEditMode] = useState(false);
  const [floorsEditMode, setFloorsEditMode] = useState(false);
  // Each place a floor can be opened keeps its own open floor (the overview keeps its own inside TowerOverview).
  const [expandedFloorId, setExpandedFloorId] = useState<number | null>(null); // Unit generation
  const [blocksExpandedFloorId, setBlocksExpandedFloorId] = useState<number | null>(null);
  const [floorPlanExpandedFloorId, setFloorPlanExpandedFloorId] = useState<number | null>(null);
  const [blocksExpandedBlocks, setBlocksExpandedBlocks] = useState<Record<number, boolean>>({});
  // A block with floors shows them as tags; its floor-count input opens on "Add floors".
  const [floorFormOpenFor, setFloorFormOpenFor] = useState<Record<number, boolean>>({});
  // A fully generated block collapses to a summary; this re-opens its editor.
  const [unitTemplateOpenFor, setUnitTemplateOpenFor] = useState<Record<number, boolean>>({});

  const { data: unitTypesMaster = [] } = useQuery<LayoutType[]>({ queryKey: LAYOUT_TYPES_QUERY_KEY, queryFn: getLayoutTypes, staleTime: 60_000 });
  const { data: applicablePlans = [] } = useQuery<PaymentPlan[]>({
    queryKey: ["applicable-plans-for-project", projectId],
    queryFn: () => fetchApplicablePlans(projectId),
    enabled: !!projectId,
    staleTime: 2 * 60_000,
  });
  const { data: status, isLoading: statusLoading, isError: statusFailed, error: statusError } = useQuery({
    queryKey: ["crm-auto-project-setup-status", projectId],
    queryFn: () => fetchStatus(projectId),
    enabled: !!projectId,
  });

  const refetchStatus = () => qc.invalidateQueries({ queryKey: ["crm-auto-project-setup-status", projectId] });
  const invalidateSyncedMasters = () => {
    qc.invalidateQueries({ queryKey: ["unit-master"] });
    qc.invalidateQueries({ queryKey: ["block-master"] });
    qc.invalidateQueries({ queryKey: ["parking-master"] });
    qc.invalidateQueries({ queryKey: ["crm-unit-matrix"] });
    qc.invalidateQueries({ queryKey: ["crm-parking-matrix"] });
    qc.invalidateQueries({ queryKey: ["crm-payment-plans"] });
    // Flat Master (Civil Work DPR) — generating/editing units here also builds/adjusts their rooms there.
    invalidateRoomData(qc);
  };
  const changed = () => { refetchStatus(); invalidateSyncedMasters(); };

  const blocks: any[] = status?.blocks ?? EMPTY_ITEMS;
  const floors: any[] = status?.floors ?? EMPTY_ITEMS;
  const existingBlockNamesLower = useMemo(() => new Set(blocks.map((b) => String(b.BlockName).trim().toLowerCase())), [blocks]);

  // The "add blocks" names follow the count and scheme, always skipping names this project already has.
  useEffect(() => {
    const n = Math.max(1, Math.min(100, parseInt(blockCount, 10) || 0));
    const nextNames = generateNames(n, namingScheme, existingBlockNamesLower);
    setBlockNames((current) =>
      current.length === nextNames.length && current.every((name, index) => name === nextNames[index]) ? current : nextNames,
    );
  }, [blockCount, namingScheme, existingBlockNamesLower]);

  const floorsByBlock = useMemo(() => {
    const map = new Map<number, any[]>();
    floors.forEach((f) => {
      if (!map.has(f.BlockId)) map.set(f.BlockId, []);
      map.get(f.BlockId)!.push(f);
    });
    return map;
  }, [floors]);

  // Seed each block's floor count with what it has now, so adding 2 floors to a 10-floor block starts from 10.
  // Never overwrites a value being edited.
  useEffect(() => {
    if (!blocks.length) return;
    setFloorCounts((prev) => {
      let dirty = false;
      const next = { ...prev };
      blocks.forEach((b) => {
        if (next[b.Id] === undefined) {
          const current = (floorsByBlock.get(b.Id) || []).length;
          next[b.Id] = current > 0 ? String(current) : "";
          dirty = true;
        }
      });
      return dirty ? next : prev;
    });
  }, [blocks, floorsByBlock]);

  // Floors or plots per block, from its effective type's HasFloors (resolved server-side, never from a name); a
  // project with no type lays out floors. A mixed township sets up both side by side.
  const towerBlocks = blocks.filter((b: any) => b.HasFloors !== false);
  const plotBlocks = blocks.filter((b: any) => b.HasFloors === false);
  const hasTowers = towerBlocks.length > 0;
  const hasPlots = plotBlocks.length > 0;
  // Whole-project wording: plotted when every block is plots, or no blocks yet and the type has no floors.
  const isPlotted = blocks.length ? !hasTowers : (status?.projectType ? !status.projectType.HasFloors : false);
  // Whether the type also builds on its plots (Plotted + Villa), from SellsConstruction.
  const buildsVillas = !!status?.projectType?.SellsConstruction;
  const { data: plotSummary } = useQuery<PlotSummary>({
    queryKey: ["plot-summary", projectId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/projects/${projectId}/plot-summary`);
      if (!r.ok) throw new Error("Could not load plot summary");
      return r.json();
    },
    enabled: !!projectId && hasPlots,
    staleTime: 15_000,
  });

  const step1Done = blocks.length > 0;
  const step2Done = floors.length > 0;

  // Unit kinds this project's type may use.
  const { data: kindsData } = useQuery<{ project: KindRow[]; blocks: Record<string, KindRow[]>; defaultKind?: string | null }>({
    queryKey: ["auto-setup-kinds", projectId, status?.blocks?.map((b: any) => `${b.Id}:${b.OwnTypeId ?? ""}`).join(",")],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/kinds?ProjectId=${projectId}`);
      return r.ok ? r.json() : { project: [], blocks: {}, defaultKind: null };
    },
    enabled: !!projectId,
    staleTime: 60 * 1000,
  });
  // Each block allows what its OWN effective type sells (block override, else project).
  const kindsFor = (blockId: number): KindRow[] => kindsData?.blocks?.[blockId] ?? kindsData?.project ?? [];
  // Commercial kinds any block here may use — offered when editing a unit; the server refuses a kind the unit's own
  // block type doesn't sell.
  const projectCommercialKinds: KindRow[] = useMemo(() => Object.values(kindsData?.blocks ?? {}).flat()
    .filter((k, i, all) => k.IsCommercial && all.findIndex((x) => x.Code === k.Code) === i), [kindsData]);

  const { ctx: unitCtx, toggle: toggleFloor, loadFloor } = useUnitEditing({
    unitTypesMaster, commercialKinds: projectCommercialKinds, defaultKind: kindsData?.defaultKind,
    canEdit: rights.canEdit, canDelete: rights.canDelete, confirm: ask.confirm, onChanged: changed,
  });

  const handleSaveBlocks = async () => {
    if (!projectId) { toast.error("Select a project"); return; }
    if (blockNames.some((n) => !n.trim())) { toast.error("Every block name is required"); return; }
    // The server's case-insensitive uniqueness rule, checked first: against this project's blocks and this batch.
    const dupeIdx = blockNames.findIndex((n, i) => isDuplicateBlockName(n, i, blockNames, existingBlockNamesLower));
    if (dupeIdx !== -1) { toast.error(`Block "${blockNames[dupeIdx].trim()}" already exists — choose a different name.`); return; }
    setSavingBlocks(true);
    try {
      const res = await fetchWithAuth(`${API}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId), Names: blockNames }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save blocks");
      toast.success(`${data.blocks.length} block(s) created`);
      setBlockNames(generateNames(Math.max(1, Math.min(100, parseInt(blockCount, 10) || 1)), namingScheme));
      setShowAddBlockForm(false);
      changed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingBlocks(false);
    }
  };

  // Sends only blocks with a count filled in; POST /floors only adds what's missing, so an unchanged count is a
  // no-op. True when saved (the open forms close only then; they used to close on a failure too).
  const handleSaveFloors = async () => {
    const payload = towerBlocks
      .map((b) => ({ BlockId: b.Id, FloorCount: parseInt(floorCounts[b.Id] || "", 10) }))
      .filter((p) => Number.isFinite(p.FloorCount) && p.FloorCount >= 1);
    if (!payload.length) { toast.error("Enter a floor count for at least one block"); return false; }
    setSavingFloors(true);
    try {
      const res = await fetchWithAuth(`${API}/floors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId), Blocks: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save floors");
      toast.success("Floors generated");
      changed();
      return true;
    } catch (e: any) {
      toast.error(translateError(e.message));
      return false;
    } finally {
      setSavingFloors(false);
    }
  };

  const handleRenameBlock = async (b: any) => {
    const name = editingBlockName.trim();
    if (!name || name === b.BlockName) { setEditingBlockId(null); return; }
    const collides = blocks.some((other) => other.Id !== b.Id && String(other.BlockName).trim().toLowerCase() === name.toLowerCase());
    if (collides) { toast.error(`Block "${name}" already exists in this Project.`); return; }
    try {
      const res = await fetchWithAuth(`${API}/blocks/${b.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BlockName: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to rename block");
      toast.success("Block renamed");
      changed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setEditingBlockId(null);
    }
  };

  // The server refuses (409, with the reason) while anything is still under the block — see getBlockLockReason.
  const handleDeleteBlock = async (b: any) => {
    if (!(await ask.confirm(`Delete block "${b.BlockName}"?`, { okLabel: "Delete", danger: true }))) return;
    try {
      const res = await fetchWithAuth(`${API}/blocks/${b.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete block");
      toast.success(data.message || "Block deleted");
      changed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleDeleteFloor = async (f: any) => {
    if (!(await ask.confirm(`Delete floor "${f.FloorLabel}"?`, { okLabel: "Delete", danger: true }))) return;
    try {
      const res = await fetchWithAuth(`${API}/floors/${f.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete floor");
      toast.success(data.message || "Floor deleted");
      changed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetchWithAuth(`${API}/generate-units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to generate units");
      if (data.createdCount === 0) {
        toast.info("No eligible floors to generate — set a unit count on at least one floor first");
      } else {
        toast.success(
          `${data.createdCount} unit(s) created — e.g. ${data.sample.slice(0, 3).join(", ")}`
          + (data.roomsCreated ? ` · ${data.roomsCreated} room(s) built in Flat Master from their layouts` : ""),
        );
        const noRooms: { unitType: string; count: number }[] = data.unitsWithoutRooms ?? [];
        if (noRooms.length) {
          toast.warning(
            `No rooms built for ${noRooms.map((r) => `${r.count} × ${r.unitType}`).join(", ")} — that Unit Type has no layout yet. `
            + "Define it in Civil Work DPR › Unit Composition, then use Flat Master's \"Generate Rooms in Bulk\".",
            { duration: 12000 },
          );
        }
      }
      changed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setGenerating(false);
    }
  };

  const generatedUnits = floors.reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);
  // Anything a block could still generate now — the server's own rule (not generated, has units, a count above 0).
  const anyToGenerate = towerBlocks.some((b) => {
    const bf = floorsByBlock.get(b.Id) || [];
    const g = bf.find((f) => f.FloorNo === 0);
    return bf.filter((f) => f.FloorNo !== 0).some((f) => !f.IsGenerated && f.UnitCount > 0) || (!!g && !g.IsGenerated && !!g.HasUnits && g.UnitCount > 0);
  });

  // A block's floors as tags (Floor plan step); a generated floor opens to its units below them.
  const floorTags = (blockFloors: any[]) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {blockFloors.map((f) => {
        const open = floorPlanExpandedFloorId === f.Id;
        const clickable = !floorsEditMode && f.IsGenerated && f.FloorNo !== -1;
        return (
          <span key={f.Id} className={`${chip(open)} ${NUM} ${f.FloorNo === -1 ? "!border-destructive text-destructive" : ""}`}>
            {clickable ? (
              <button onClick={() => toggleFloor(f, floorPlanExpandedFloorId, setFloorPlanExpandedFloorId)}>{f.FloorLabel}</button>
            ) : <span>{f.FloorNo === -1 ? "Unassigned" : f.FloorLabel}</span>}
            {floorsEditMode && rights.canDelete && f.FloorNo !== -1 && (
              <button onClick={() => handleDeleteFloor(f)} title="Delete floor" className="hover:text-destructive"><X size={11} /></button>
            )}
          </span>
        );
      })}
    </div>
  );

  const steps = (() => {
    const blocksStep = { label: "Blocks", detail: step1Done ? `${plural(blocks.length, "block")} created` : "Create the project's blocks", done: step1Done, active: !step1Done };
    // A plotted project has no floors: its steps are blocks -> plots (-> villas when the type builds on them).
    if (isPlotted) {
      const ps = plotSummary;
      const plotsDone = !!ps && ps.Plots > 0;
      const out = [blocksStep, { label: "Plots", detail: plotsDone ? `${ps!.Plots} plots · ${ps!.Sold} sold · ${ps!.Available} available` : "Lay out the plots", done: plotsDone, active: step1Done && !plotsDone }];
      if (buildsVillas) {
        const villasDone = !!ps && ps.Villas > 0 && ps.VillaRoomsWithoutDpr === 0;
        out.push({ label: "Villas", detail: ps && ps.Villas > 0 ? `${ps.Villas} built · ${ps.VillasWithDpr} on DPR` : "Convert plots to villas in Plot Master", done: villasDone, active: plotsDone && !villasDone });
      }
      return out;
    }
    return [
      blocksStep,
      { label: "Floors", detail: step2Done ? `${plural(floors.length, "floor")} planned` : "Set floors for each block", done: step2Done, active: step1Done && !step2Done },
      { label: "Units", detail: generatedUnits ? `${plural(generatedUnits, "unit")} generated` : "Define unit types & generate", done: step2Done && generatedUnits > 0 && !floors.some((f) => !f.IsGenerated && f.HasUnits && f.UnitCount > 0), active: step2Done },
    ];
  })();

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Project Auto Setup"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Auto Project Setup"
        subtitle={activeTab === "parking"
          ? "Parking slots per block: the mix of types, their charges, and the slots made from them."
          : isPlotted
            ? "A project's plot blocks and land. Plot Master stays the sales inventory until construction creates a Unit Master record."
            : "Pick a project, then make its blocks, floors and units in one place instead of one row at a time."}
        action={
          <div className="seg">
            <button className={activeTab === "setup" ? "on" : ""} onClick={() => setActiveTab("setup")}>{isPlotted ? "Blocks & plots" : "Blocks, floors & units"}</button>
            <button className={activeTab === "parking" ? "on" : ""} onClick={() => setActiveTab("parking")}>Parking</button>
          </div>
        }
      >
        {ask.node}
        {activeTab === "parking" ? (
          <ParkingSetup />
        ) : (
          <div className="space-y-5">
            <ProjectPicker companyId={companyId} projectId={projectId}
              onCompany={(v) => { setCompanyId(v); setProjectId(""); }} onProject={setProjectId} />

            {!projectId && (
              <div className="bg-card px-6 py-10 text-center" style={{ border: RULE_SOFT }}>
                <p className="text-sm font-medium">No project selected</p>
                <p className="text-xs text-muted-foreground mt-1">Pick a company and project above to see and manage its blocks, floors and units.</p>
              </div>
            )}
            {projectId && statusLoading && <p className="text-sm text-muted-foreground">Loading the project…</p>}
            {projectId && statusFailed && <Notice tone="error">{(statusError as Error)?.message}</Notice>}

            {projectId && status && (
              <>
                <SetupProgress steps={steps} />
                {hasPlots && plotSummary && <PlotSummaryPanel s={plotSummary} buildsVillas={buildsVillas} projectId={projectId} canEdit={rights.canEdit} />}

                {!status.shortCodeValid && (
                  <Notice tone="error">
                    This project has no valid short name (letters and numbers only). Set one in Project Master first — it becomes the first part of every generated unit name (e.g. RYG/A/1001).
                  </Notice>
                )}

                {/* What this project is — type, what it sells, and each block's layout. */}
                <ProjectTypeBar projectId={Number(projectId)} status={status} canEdit={rights.canEdit}
                  onChanged={() => { changed(); qc.invalidateQueries({ queryKey: ["auto-setup-kinds", projectId] }); }} />

                {!isPlotted && status.legacyUnitCount > 0 && (
                  <Notice tone="fix">
                    <span className={NUM}>{plural(status.legacyUnitCount, "unit")}</span> with no floor — the Unassigned row in the overview. Edit each to give it a floor, or use{" "}
                    <Link to="/crm/setup/unit-master" className={TEXT_LINK}>Unit Master</Link>.
                  </Notice>
                )}

                {blocks.length > 0 && (isPlotted
                  ? <PlotOverview projectName={status.project?.Name} typeName={status.projectType?.Name} blocks={blocks} canDelete={rights.canDelete} confirm={ask.confirm} onChanged={changed} />
                  : <TowerOverview projectName={status.project?.Name} blocks={blocks} floors={floors} floorsByBlock={floorsByBlock} ctx={unitCtx} toggle={toggleFloor} />)}

                {/* 1 · Blocks */}
                <Section tag="1" title={isPlotted ? "Plot blocks" : "Blocks"} done={step1Done}
                  note={step1Done ? `${isPlotted ? "A block opens in Plot Master." : "Open a block to see its floors."}${rights.canEdit || rights.canDelete ? " Edit renames or removes blocks." : ""}` : "Create the towers / blocks of this project."}
                  right={<>
                    {(rights.canEdit || rights.canDelete) && step1Done && (
                      <button onClick={() => { setBlocksEditMode((v) => !v); setEditingBlockId(null); }} className={`${blocksEditMode ? KEY_INK : KEY_LINE} h-8 px-3`}>
                        <Pencil size={12} /> {blocksEditMode ? "Done" : "Edit"}
                      </button>
                    )}
                    {rights.canCreate && step1Done && !showAddBlockForm && (
                      <button onClick={() => setShowAddBlockForm(true)} className={`${KEY_LINE} h-8 px-3`}><Plus size={12} /> Add blocks</button>
                    )}
                  </>}>
                  {step1Done && (
                    <div className="flex items-center flex-wrap gap-1.5">
                      {blocks.map((b) => (
                        <span key={b.Id} className={chip(!blocksEditMode && !isPlotted && !!blocksExpandedBlocks[b.Id])}>
                          {editingBlockId === b.Id ? (
                            <input autoFocus type="text" value={editingBlockName}
                              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} name={`block-rename-${b.Id}`}
                              onChange={(e) => setEditingBlockName(e.target.value)}
                              onBlur={() => handleRenameBlock(b)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleRenameBlock(b); if (e.key === "Escape") setEditingBlockId(null); }}
                              className="w-16 bg-transparent border-b border-foreground outline-none" />
                          ) : blocksEditMode ? (
                            <>
                              <span className="font-medium">{b.BlockName}</span>
                              {rights.canEdit && (
                                <button onClick={() => { setEditingBlockId(b.Id); setEditingBlockName(b.BlockName); }} title="Rename block" className="hover:text-primary"><Pencil size={11} /></button>
                              )}
                              {rights.canDelete && (
                                <button onClick={() => handleDeleteBlock(b)} title="Delete block" className="hover:text-destructive"><X size={12} /></button>
                              )}
                            </>
                          ) : isPlotted ? (
                            <Link to="/crm/setup/plot-master" className="font-medium hover:text-primary">{b.BlockName}</Link>
                          ) : (
                            <button onClick={() => setBlocksExpandedBlocks((m) => ({ ...m, [b.Id]: !m[b.Id] }))} className="inline-flex items-center gap-1 font-medium">
                              {blocksExpandedBlocks[b.Id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {b.BlockName}
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {!isPlotted && blocks.filter((b) => blocksExpandedBlocks[b.Id]).map((b) => (
                    <div key={b.Id} className={`${PANEL} px-3 py-2`}>
                      <div className={`${LBL} py-1`}>Block {b.BlockName}</div>
                      <BlockFloorTree blockFloors={floorsByBlock.get(b.Id) || []} expandedFloorId={blocksExpandedFloorId} ctx={unitCtx}
                        onToggleFloor={(f) => toggleFloor(f, blocksExpandedFloorId, setBlocksExpandedFloorId)} />
                    </div>
                  ))}

                  {rights.canCreate && (!step1Done || showAddBlockForm) && (
                    <div className={step1Done ? `${PANEL} p-4 space-y-4` : "space-y-4"}>
                      {step1Done && (
                        <div className="flex items-center justify-between">
                          <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">Add more {isPlotted ? "plot " : ""}blocks</span>
                          <button onClick={() => setShowAddBlockForm(false)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block space-y-1">
                          <span className={`block ${LBL}`}>Number of blocks</span>
                          <input type="number" min={1} max={100} value={blockCount} onChange={(e) => setBlockCount(e.target.value)} className={`${INP} ${NUM}`} />
                        </label>
                        <div className="space-y-1">
                          <span className={`block ${LBL}`}>Naming scheme</span>
                          <div className="seg">
                            {(["Alphabetical", "Numeric", "Custom"] as NamingScheme[]).map((s) => (
                              <button key={s} type="button" className={namingScheme === s ? "on" : ""} onClick={() => setNamingScheme(s)}>{s}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className={`block ${LBL}`}>Block names</span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                          {blockNames.map((name, i) => {
                            const dupe = isDuplicateBlockName(name, i, blockNames, existingBlockNamesLower);
                            return (
                              <div key={i}>
                                <input type="text" value={name} placeholder={`Block ${i + 1}`}
                                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                                  name={`block-name-${i}-${projectId || "new"}`}
                                  onChange={(e) => setBlockNames((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))}
                                  className={`${INP} ${dupe ? "!border-destructive text-destructive" : ""}`} />
                                {dupe && <div className="text-[0.625rem] text-destructive mt-0.5">Already exists</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex justify-end pt-3" style={{ borderTop: RULE_SOFT }}>
                        <button onClick={handleSaveBlocks} disabled={savingBlocks || blockNames.some((n, i) => isDuplicateBlockName(n, i, blockNames, existingBlockNamesLower))}
                          className={`${KEY_INK} h-9 px-5 w-full sm:w-auto`}>
                          {savingBlocks ? "Saving…" : step1Done ? "Add blocks" : "Create blocks"}
                        </button>
                      </div>
                    </div>
                  )}
                  {!rights.canCreate && !step1Done && <p className="text-xs text-muted-foreground">No blocks yet, and you may not create them.</p>}
                </Section>

                {/* A plot block has no floors: the floor step is replaced (the server refuses POST /floors for it). */}
                {step1Done && hasPlots && (
                  <PlotLayoutStep blocks={plotBlocks} projectTypeName={status.projectType?.Name} canEdit={rights.canEdit} canCreate={rights.canCreate} onChanged={changed} />
                )}
                {step1Done && hasPlots && plotBlocks.some((b) => b.PlotTemplate?.IsGenerated) && (
                  <LandInventory blocks={plotBlocks} projectId={projectId} canDelete={rights.canDelete} confirm={ask.confirm} onChanged={changed} />
                )}

                {/* 2 · Floor plan — every count stays editable, prefilled with what's there. */}
                {step1Done && hasTowers && (
                  <Section tag="2" title="Floor plan" done={step2Done}
                    note={step2Done ? `Open a floor to see its units.${rights.canDelete ? " Edit removes empty floors." : ""}` : "Enter how many floors each block has."}
                    right={rights.canDelete && step2Done && (
                      <button onClick={() => setFloorsEditMode((v) => !v)} className={`${floorsEditMode ? KEY_INK : KEY_LINE} h-8 px-3`}>
                        <Pencil size={12} /> {floorsEditMode ? "Done" : "Edit"}
                      </button>
                    )}>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {towerBlocks.map((b) => {
                        const blockFloors = floorsByBlock.get(b.Id) || [];
                        const hasFloors = blockFloors.length > 0;
                        // Open while there's nothing to show yet, or once "Add floors" is pressed.
                        const isOpen = rights.canCreate && (!hasFloors || !!floorFormOpenFor[b.Id]);
                        const openFloor = blockFloors.find((x) => x.Id === floorPlanExpandedFloorId);
                        return (
                          <div key={b.Id} className={`${PANEL} p-3 space-y-2.5`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">Block {b.BlockName}</span>
                              {hasFloors && <span className="text-xs text-muted-foreground"><span className={NUM}>{blockFloors.length}</span> floor{blockFloors.length === 1 ? "" : "s"}</span>}
                              {hasFloors && !isOpen && rights.canCreate && (
                                <button onClick={() => setFloorFormOpenFor((m) => ({ ...m, [b.Id]: true }))} className={`${KEY_LINE} h-7 px-2.5 ml-auto`}><Plus size={11} /> Add floors</button>
                              )}
                            </div>
                            {isOpen && (
                              <div className="flex items-center gap-2">
                                <input type="number" min={1} max={100} placeholder="Number of floors" value={floorCounts[b.Id] || ""}
                                  onChange={(e) => setFloorCounts((m) => ({ ...m, [b.Id]: e.target.value }))} className={`${INP} ${NUM}`} />
                                {hasFloors && (
                                  <button onClick={() => setFloorFormOpenFor((m) => ({ ...m, [b.Id]: false }))} className={`${KEY_LINE} h-9 px-3`}>Cancel</button>
                                )}
                              </div>
                            )}
                            {!hasFloors && !rights.canCreate && <p className="text-xs text-muted-foreground">No floors yet.</p>}
                            {hasFloors && floorTags(blockFloors)}
                            {openFloor && <FloorUnitList floorId={openFloor.Id} ctx={unitCtx} />}
                          </div>
                        );
                      })}
                    </div>
                    {rights.canCreate && towerBlocks.some((b) => !(floorsByBlock.get(b.Id) || []).length || floorFormOpenFor[b.Id]) && (
                      <div className="flex justify-end pt-3" style={{ borderTop: RULE_SOFT }}>
                        <button onClick={async () => { if (await handleSaveFloors()) setFloorFormOpenFor({}); }} disabled={savingFloors}
                          className={`${KEY_INK} h-9 px-5 w-full sm:w-auto`}>
                          {savingFloors ? "Saving…" : step2Done ? "Add floors" : "Generate floors"}
                        </button>
                      </div>
                    )}
                  </Section>
                )}

                {/* 3 · Unit types & generation */}
                {step2Done && hasTowers && (
                  <Section tag="3" title="Unit types & generation" note="Set each block's unit mix (a typical floor, or a floor's own), then generate the units.">
                    {/* How the units will be named — project default, block and floor overrides, previewed first. */}
                    <NamingPanel projectId={Number(projectId)} shortName={status.project?.ShortCode} blocks={towerBlocks} floorsByBlock={floorsByBlock} canEdit={rights.canEdit} />

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {towerBlocks.map((b) => {
                        const bf = floorsByBlock.get(b.Id) || [];
                        const nonGroundFloors = bf.filter((f) => f.FloorNo !== 0);
                        const groundFloor = bf.find((f) => f.FloorNo === 0);
                        // Fully done: every non-ground floor (and a sellable ground floor) is generated.
                        const blockFullyGenerated = nonGroundFloors.length > 0
                          && nonGroundFloors.every((f) => f.IsGenerated)
                          && (!groundFloor || groundFloor.IsGenerated || !groundFloor.HasUnits);
                        const totalGenerated = bf.reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);
                        const summaryFloors = [groundFloor, ...nonGroundFloors].filter(Boolean);
                        return (
                          <div key={b.Id} className={`${PANEL} p-3 sm:p-4 space-y-3`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">Block {b.BlockName}</span>
                              {blockFullyGenerated && <SheetMark text={`${plural(totalGenerated, "unit")} generated`} tone="done" />}
                              {blockFullyGenerated && (
                                <button onClick={() => setUnitTemplateOpenFor((m) => ({ ...m, [b.Id]: !m[b.Id] }))} className={`${KEY_LINE} h-7 px-2.5 ml-auto`}>
                                  {unitTemplateOpenFor[b.Id] ? "Collapse" : "Manage mix / units"}
                                </button>
                              )}
                            </div>
                            {blockFullyGenerated && !unitTemplateOpenFor[b.Id] ? (
                              // Nothing pending: the floors as tags, each opening to its units.
                              <>
                                <div className="flex flex-wrap gap-1.5">
                                  {summaryFloors.map((f: any) => (
                                    <button key={f.Id} onClick={() => toggleFloor(f, expandedFloorId, setExpandedFloorId)} className={`${chip(expandedFloorId === f.Id)} ${NUM}`}>
                                      {f.FloorNo === 0 ? "Ground" : f.FloorLabel} · {f.GeneratedUnitCount || 0}
                                    </button>
                                  ))}
                                </div>
                                {summaryFloors.some((f: any) => f.Id === expandedFloorId) && <FloorUnitList floorId={expandedFloorId!} ctx={unitCtx} />}
                              </>
                            ) : (
                              // The block as a building: typical floor once, any floor its own mix.
                              <BlockStackEditor blockId={b.Id} blockName={b.BlockName} kinds={kindsFor(b.Id)} layoutTypes={unitTypesMaster} paymentPlans={applicablePlans}
                                onOpenGeneratedFloor={(f) => loadFloor(f)}
                                renderGeneratedFloor={(fid) => <FloorUnitList floorId={fid} ctx={unitCtx} />}
                                canEdit={rights.canEdit} onChanged={changed} />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Only when something can be generated — otherwise it just leads to "No eligible floors". */}
                    {anyToGenerate && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 bg-primary/5" style={{ border: RULE, boxShadow: "inset 3px 0 0 hsl(var(--foreground))" }}>
                        <p className="text-xs text-muted-foreground flex-1">
                          <span className="font-semibold text-foreground">Ready to generate.</span> Units will be made for every floor with a unit count that isn&apos;t generated yet.
                        </p>
                        {rights.canCreate
                          ? <button onClick={handleGenerate} disabled={generating} className={`${KEY_INK} h-9 px-5 w-full sm:w-auto`}>{generating ? "Generating…" : "Generate units"}</button>
                          : <span className="text-xs text-muted-foreground">You may not generate units.</span>}
                      </div>
                    )}
                  </Section>
                )}
              </>
            )}
          </div>
        )}
      </SheetShell>
    </>
  );
};

export default CrmProjectAutoSetup;
