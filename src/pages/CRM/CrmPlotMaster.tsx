import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Map as MapIcon, Home, Combine, ArrowRight, CheckCircle2, Lock, RefreshCw, Network, Settings2, Eye, Pencil, Plus, Trash2, List } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CrmShell } from "@/components/crm/CrmShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { getLayoutTypes, unitTypeOptions, LAYOUT_TYPES_QUERY_KEY, type LayoutType } from "@/api/unitBhkConfigApi";
import { PlotLayoutEditor, naturalCompare, plotOrder } from "./PlotLayoutEditor";
import { VillaTypesDialog, fetchVillaTypes, villaTypesKey, type VillaType } from "./VillaTypesDialog";

const PLOT_API = "/api/plot-master";
const SETUP_API = "/api/crm/project-auto-setup";
const FACING_API = "/api/plot-facing-master";
const ALL = "__all__";

type Plot = {
  Id: number; ProjectId: number; ProjectName: string; BlockId: number; BlockName: string;
  PlotNo: string; PlotName: string; SurveyNo?: string | null; AreaSqFt?: number | null;
  RatePerSqFt?: number | null; Facing?: string | null; IsCornerPlot?: boolean;
  RoadWidthFt?: number | null; PlotWidthFt?: number | null; PlotDepthFt?: number | null; GuidelineRatePerSqFt?: number | null;
  GridRow?: number | null; GridCol?: number | null;
  PlannedVillaTypeId?: number | null; PlannedVillaTypeCode?: string | null; PlannedVillaTypeName?: string | null;
  ConvertedUnitId?: number | null; ConvertedAt?: string | null; ConvertedUnitName?: string | null;
  LockBookingNo?: string | null; LockApplicationNo?: string | null; LockHoldId?: number | null; AdjacentPlotCount?: number;
};
type PlotBlock = { BlockId: number; BlockName: string; ProjectId: number; ProjectName: string };
type ConstructedAssetKind = { Id: number; Code: string; Name: string; SortOrder?: number; IsActive?: boolean; IsLand?: boolean; IsCommercial?: boolean };
// Plot facing is master data (dbo.PlotFacingMaster), not a typed string, so
// "North"/"north"/"N" cannot all coexist and a facing premium has somewhere
// to live. Managed from inside this page rather than a separate screen.
type PlotFacing = { Id: number; Code: string; Name: string; PremiumPercent: number; SortOrder?: number; IsActive?: boolean; PlotCount?: number };

async function fetchFacings(all = false): Promise<PlotFacing[]> {
  const response = await fetchWithAuth(`${FACING_API}${all ? "?all=1" : ""}`);
  if (!response.ok) throw new Error("Could not load plot facings");
  return response.json();
}
async function fetchPlots(): Promise<Plot[]> {
  const response = await fetchWithAuth(PLOT_API);
  if (!response.ok) throw new Error("Failed to load Plot Master");
  return response.json();
}
async function fetchPlotBlocks(): Promise<PlotBlock[]> {
  const response = await fetchWithAuth(`${PLOT_API}/blocks`);
  if (!response.ok) throw new Error("Failed to load blocks");
  return response.json();
}
async function fetchConstructedAssetKinds(projectId?: number | null): Promise<ConstructedAssetKind[]> {
  // With a project: only the kinds that project's type sells.
  const response = await fetchWithAuth(`${PLOT_API}/constructed-kinds${projectId ? `?projectId=${projectId}` : ""}`);
  if (!response.ok) throw new Error("Failed to load constructed asset kinds");
  return response.json();
}

type StatusKind = "converted" | "booked" | "applied" | "held" | "available";
function plotStatus(plot: Plot): { kind: StatusKind; label: string; cls: string; tone: string } {
  if (plot.ConvertedUnitId) return { kind: "converted", label: "Converted", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300", tone: "border-violet-500/40 bg-violet-500/5" };
  if (plot.LockBookingNo) return { kind: "booked", label: `Booked: ${plot.LockBookingNo}`, cls: "bg-red-500/10 text-red-700 dark:text-red-300", tone: "border-red-500/40 bg-red-500/5" };
  if (plot.LockApplicationNo) return { kind: "applied", label: `Application: ${plot.LockApplicationNo}`, cls: "bg-sky-500/10 text-amber-700 dark:text-amber-300", tone: "border-sky-500/40 bg-sky-500/5" };
  if (plot.LockHoldId) return { kind: "held", label: "On hold", cls: "bg-sky-500/10 text-amber-700 dark:text-amber-300", tone: "border-sky-500/40 bg-sky-500/5" };
  return { kind: "available", label: "Available", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", tone: "border-emerald-500/35 bg-emerald-500/5" };
}

// A villa can be built on an unsold plot or on a SOLD one (plot first, villa
// after — the plot's owner then buys the villa as a separate booking). Plots
// whose ownership is still in flux (applied for, on hold) cannot.
const canConvert = (plot: Plot) => ["available", "booked"].includes(plotStatus(plot).kind);

const fieldCls = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";

const CrmPlotMaster: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const rights = usePageRights("crm-auto-project-setup");
  const [projectId, setProjectId] = useState(() => searchParams.get("projectId") || ALL);
  const [blockId, setBlockId] = useState(ALL);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [convertOpen, setConvertOpen] = useState(false);
  const [unitName, setUnitName] = useState("");
  const [unitType, setUnitType] = useState("");
  const [unitKind, setUnitKind] = useState("");
  const [villaRate, setVillaRate] = useState("");
  const [builtUpArea, setBuiltUpArea] = useState("");
  const [superBuiltUpArea, setSuperBuiltUpArea] = useState("");
  const [villaTypeId, setVillaTypeId] = useState("");
  const [villaTypesOpen, setVillaTypesOpen] = useState(false);
  // "each": one villa per plot (the default); "combine": one villa on all the ticked plots.
  const [conversionMode, setConversionMode] = useState<"each" | "combine">("each");
  // Conversion cannot be undone, so with several plots the user confirms the
  // exact outcome shown in the preview. Any change to the mode clears it.
  const [conversionConfirmed, setConversionConfirmed] = useState(false);
  // What was confirmed must be what gets created: any edit to the outcome asks again.
  React.useEffect(() => { setConversionConfirmed(false); }, [selectedIds, unitName, villaTypeId, builtUpArea, superBuiltUpArea]);
  const [converting, setConverting] = useState(false);
  const [layoutState, setLayoutState] = useState<{ blockId: number; mode: "arrange" | "neighbours"; focusId: number | null } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [facingsOpen, setFacingsOpen] = useState(false);
  const [facingDraft, setFacingDraft] = useState<Partial<PlotFacing>>({});
  const [savingFacing, setSavingFacing] = useState(false);
  const [detailPlot, setDetailPlot] = useState<Plot | null>(null);
  const [plotDraft, setPlotDraft] = useState<Record<string, any>>({});
  const [savingPlot, setSavingPlot] = useState(false);
  const [creatingPlot, setCreatingPlot] = useState(false);

  const { data: plots = [], isLoading, error, refetch, isFetching } = useQuery({ queryKey: ["plot-master"], queryFn: fetchPlots, staleTime: 30_000 });
  const { data: planBlocks = [] } = useQuery<PlotBlock[]>({ queryKey: ["plot-blocks"], queryFn: fetchPlotBlocks, staleTime: 60_000 });
  // Active facings feed the edit dropdown; the manage dialog asks for all so
  // a deactivated one is still visible to re-enable.
  const { data: facings = [], isError: facingsFailed } = useQuery({ queryKey: ["plot-facings"], queryFn: () => fetchFacings(false), staleTime: 5 * 60_000 });
  const { data: allFacings = [] } = useQuery({ queryKey: ["plot-facings", "all"], queryFn: () => fetchFacings(true), enabled: facingsOpen });
  const { data: layoutTypes = [] } = useQuery<LayoutType[]>({ queryKey: LAYOUT_TYPES_QUERY_KEY, queryFn: getLayoutTypes, staleTime: 60_000 });
  // Villa types of the project being converted, and of the plot being edited.
  const conversionProjectId = plots.find((plot: Plot) => selectedIds.includes(plot.Id))?.ProjectId ?? null;
  const { data: conversionVillaTypes = [] } = useQuery<VillaType[]>({ queryKey: villaTypesKey(conversionProjectId), queryFn: () => fetchVillaTypes(conversionProjectId!), enabled: convertOpen && conversionProjectId != null });
  const { data: editVillaTypes = [] } = useQuery<VillaType[]>({ queryKey: villaTypesKey(plotDraft.ProjectId), queryFn: () => fetchVillaTypes(plotDraft.ProjectId), enabled: editOpen && !!plotDraft.ProjectId });
  const unitTypeOptionsForConversion = useMemo(() => unitTypeOptions(layoutTypes, unitType), [layoutTypes, unitType]);

  // Picking a villa type fills the areas and room layout from the master;
  // every field stays editable.
  const applyVillaType = (id: string, types: VillaType[] = conversionVillaTypes) => {
    setVillaTypeId(id);
    const type = types.find((t) => String(t.Id) === id);
    if (!type) return;
    setBuiltUpArea(String(type.BuiltUpAreaSqFt ?? ""));
    setSuperBuiltUpArea(type.SuperBuiltUpAreaSqFt != null ? String(type.SuperBuiltUpAreaSqFt) : "");
    const layout = layoutTypes.find((l) => l.id === type.LayoutTypeId);
    if (layout) setUnitType(layout.label);
  };
  const facingName = (code?: string | null) => (code ? facings.find((facing) => facing.Code === code)?.Name ?? code : "");

  const saveFacing = async () => {
    const code = String(facingDraft.Code || "").trim().toUpperCase();
    const name = String(facingDraft.Name || "").trim();
    if (!code || !name) { toast.error("Code and name are both required"); return; }
    setSavingFacing(true);
    try {
      const editing = facingDraft.Id != null;
      const response = await fetchWithAuth(editing ? `${FACING_API}/${facingDraft.Id}` : FACING_API, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...facingDraft, Code: code, Name: name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save the facing");
      toast.success(editing ? "Facing updated" : "Facing added");
      setFacingDraft({});
      queryClient.invalidateQueries({ queryKey: ["plot-facings"] });
      queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    } catch (e: any) { toast.error(e.message); } finally { setSavingFacing(false); }
  };
  const removeFacing = async (facing: PlotFacing) => {
    try {
      const response = await fetchWithAuth(`${FACING_API}/${facing.Id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not remove the facing");
      toast.success("Facing removed");
      queryClient.invalidateQueries({ queryKey: ["plot-facings"] });
    } catch (e: any) { toast.error(e.message); }
  };

  // Blocks come from the server (so a block with no plots yet can still be picked) and are
  // topped up from the plots themselves in case that call fails.
  const blockCatalog = useMemo<PlotBlock[]>(() => {
    const map = new Map<number, PlotBlock>();
    planBlocks.forEach((block) => map.set(block.BlockId, block));
    plots.forEach((plot) => { if (!map.has(plot.BlockId)) map.set(plot.BlockId, { BlockId: plot.BlockId, BlockName: plot.BlockName, ProjectId: plot.ProjectId, ProjectName: plot.ProjectName }); });
    return Array.from(map.values()).sort((a, b) => naturalCompare(a.ProjectName, b.ProjectName) || naturalCompare(a.BlockName, b.BlockName));
  }, [planBlocks, plots]);
  const projects = useMemo(() => Array.from(new Map(blockCatalog.map((block) => [block.ProjectId, block.ProjectName])).entries()), [blockCatalog]);
  const blocks = useMemo(() => blockCatalog.filter((block) => projectId === ALL || String(block.ProjectId) === projectId), [blockCatalog, projectId]);

  const scoped = useMemo(() => plots.filter((plot) => (projectId === ALL || String(plot.ProjectId) === projectId) && (blockId === ALL || String(plot.BlockId) === blockId)), [plots, projectId, blockId]);
  const searching = search.trim().length > 0;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scoped
      .filter((plot) => !term || [plot.PlotName, plot.PlotNo, plot.ProjectName, plot.BlockName, plot.SurveyNo].some((value) => String(value || "").toLowerCase().includes(term)))
      .sort((a, b) => naturalCompare(a.ProjectName, b.ProjectName) || naturalCompare(a.BlockName, b.BlockName) || plotOrder(a, b));
  }, [scoped, search]);
  const matchIds = useMemo(() => new Set(filtered.map((plot) => plot.Id)), [filtered]);
  const selectable = useMemo(() => filtered.filter(canConvert), [filtered]);
  // Only plots that are still visible count as selected. Before, a plot ticked and then
  // filtered out was still converted, with nothing on screen to show it.
  const selectedPlots = useMemo(() => filtered.filter((plot) => selectedIds.includes(plot.Id) && canConvert(plot)), [filtered, selectedIds]);
  // Kinds offered when converting = what the selected plots' project type sells.
  const kindsProjectId = selectedPlots[0]?.ProjectId ?? null;
  const { data: constructedAssetKinds = [] } = useQuery<ConstructedAssetKind[]>({ queryKey: ["constructed-asset-kinds", kindsProjectId], queryFn: () => fetchConstructedAssetKinds(kindsProjectId), staleTime: 60_000 });
  const selectionIsCompatible = selectedPlots.length > 0 && selectedPlots.every((plot) => plot.ProjectId === selectedPlots[0].ProjectId && plot.BlockId === selectedPlots[0].BlockId);
  const totalArea = selectedPlots.reduce((total, plot) => total + Number(plot.AreaSqFt || 0), 0);
  // Counts follow the project/block filter and always add up: a converted plot with an old
  // booking used to be counted as both locked and converted.
  const stats = useMemo(() => {
    const kinds = scoped.map((plot) => plotStatus(plot).kind);
    return {
      total: scoped.length,
      available: kinds.filter((kind) => kind === "available").length,
      locked: kinds.filter((kind) => kind === "booked" || kind === "applied" || kind === "held").length,
      converted: kinds.filter((kind) => kind === "converted").length,
    };
  }, [scoped]);

  const blockSections = useMemo(() => blockCatalog
    .filter((block) => (projectId === ALL || String(block.ProjectId) === projectId) && (blockId === ALL || String(block.BlockId) === blockId))
    .map((block) => ({ block, plots: scoped.filter((plot) => plot.BlockId === block.BlockId).sort(plotOrder) }))
    .filter((section) => (searching ? section.plots.some((plot) => matchIds.has(plot.Id)) : true)),
  [blockCatalog, projectId, blockId, scoped, searching, matchIds]);

  const togglePlot = (plot: Plot) => setSelectedIds((current) => current.includes(plot.Id) ? current.filter((id) => id !== plot.Id) : [...current, plot.Id]);
  const toggleAll = () => setSelectedIds((current) => selectable.every((plot) => current.includes(plot.Id)) ? current.filter((id) => !selectable.some((plot) => plot.Id === id)) : Array.from(new Set([...current, ...selectable.map((plot) => plot.Id)])));
  const openConversion = () => {
    if (!selectionIsCompatible) { toast.error("Select plots from one project and block to create one constructed unit"); return; }
    setUnitName(selectedPlots.map((plot) => plot.PlotName).join(" + "));
    setBuiltUpArea(""); setSuperBuiltUpArea(""); setVillaTypeId(""); setConversionMode("each"); setConversionConfirmed(false);
    // One planned type across the plots pre-selects it; mixed types are left to the user.
    const planned = new Set(selectedPlots.map((plot) => plot.PlannedVillaTypeId ?? null));
    const only = planned.size === 1 ? [...planned][0] : null;
    if (only != null) {
      fetchVillaTypes(selectedPlots[0].ProjectId).then((types) => applyVillaType(String(only), types)).catch(() => {});
    }
    // No kind is assumed here (kinds are master data): a single active kind is
    // pre-picked, otherwise the user chooses — the form already requires it.
    if (!unitKind) { const usable = constructedAssetKinds.filter((kind) => !kind.IsLand && kind.IsActive !== false); if (usable.length === 1) setUnitKind(usable[0].Code); }
    setConvertOpen(true);
  };

  // Layout editor target: the block being viewed, or the block of the selected plots.
  const toolbarLayoutBlock = blockId !== ALL ? Number(blockId) : selectedPlots.length > 0 && selectedPlots.every((plot) => plot.BlockId === selectedPlots[0].BlockId) ? selectedPlots[0].BlockId : null;
  const openLayout = (targetBlockId: number, mode: "arrange" | "neighbours" = "arrange", focusId: number | null = null) => setLayoutState({ blockId: targetBlockId, mode, focusId });
  const layoutBlockInfo = layoutState ? blockCatalog.find((block) => block.BlockId === layoutState.blockId) : undefined;


  const loadPlotDetail = async (plot: Plot) => {
    const response = await fetchWithAuth(`${PLOT_API}/${plot.Id}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not load plot details");
    setDetailPlot(body);
    return body as Plot;
  };
  const openView = async (plot: Plot) => {
    setDetailPlot(plot); setDetailOpen(true);
    try { await loadPlotDetail(plot); } catch (e: any) { toast.error(e.message); }
  };
  const openEdit = async (plot: Plot) => {
    try {
      const fullPlot = await loadPlotDetail(plot);
      setCreatingPlot(false); // a cancelled "Add plot" used to leave this true, so the next edit POSTed a duplicate
      setPlotDraft({ ...fullPlot, IsCornerPlot: Boolean(fullPlot.IsCornerPlot) });
      setEditOpen(true);
    } catch (e: any) { toast.error(e.message); }
  };
  const openCreate = () => {
    const preferredBlock = blockId !== ALL ? blockCatalog.find((block) => String(block.BlockId) === blockId)
      : projectId !== ALL ? blockCatalog.find((block) => String(block.ProjectId) === projectId) : blockCatalog[0];
    setDetailPlot(null);
    setPlotDraft({ ProjectId: preferredBlock ? String(preferredBlock.ProjectId) : "", BlockId: preferredBlock ? String(preferredBlock.BlockId) : "", PlotNo: "", PlotName: "", IsCornerPlot: false });
    setCreatingPlot(true); setEditOpen(true);
  };
  const closeEdit = (open: boolean) => { setEditOpen(open); if (!open) setCreatingPlot(false); };
  const savePlot = async () => {
    if (!detailPlot && !creatingPlot) return;
    if (creatingPlot && (!plotDraft.ProjectId || !plotDraft.BlockId)) { toast.error("Choose a project and block for the new plot"); return; }
    setSavingPlot(true);
    try {
      const response = await fetchWithAuth(creatingPlot ? PLOT_API : `${PLOT_API}/${detailPlot!.Id}`, {
        method: creatingPlot ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plotDraft),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not update plot");
      toast.success(creatingPlot ? "Plot created - place it on the layout" : "Plot updated");
      setEditOpen(false); setCreatingPlot(false);
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] }); await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
    } catch (e: any) { toast.error(e.message); } finally { setSavingPlot(false); }
  };
  const deletePlot = async (plot: Plot) => {
    if (!window.confirm(`Delete ${plot.PlotName}? This cannot be undone.`)) return;
    try {
      const response = await fetchWithAuth(`${PLOT_API}/${plot.Id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not delete plot");
      toast.success("Plot deleted"); setSelectedIds((ids) => ids.filter((id) => id !== plot.Id));
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] }); await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
    } catch (e: any) { toast.error(e.message); }
  };
  // One villa per plot: each plot takes its own planned villa type (areas and
  // layout from the master); the type and areas in the dialog cover plots that
  // plan none. Each villa is named after its plot. Plots are converted one by
  // one, so a refusal on one plot does not stop the others.
  const separate = conversionMode === "each" && selectedPlots.length > 1;
  const convertEach = async () => {
    if (!unitKind) { toast.error("Select the constructed asset kind"); return; }
    const typesById = new Map(conversionVillaTypes.map((t) => [t.Id, t]));
    const jobs = selectedPlots.map((plot) => {
      const own = plot.PlannedVillaTypeId != null ? typesById.get(plot.PlannedVillaTypeId) : undefined;
      const layout = own ? layoutTypes.find((l) => l.id === own.LayoutTypeId)?.label : undefined;
      return {
        plot,
        body: {
          PlotIds: [plot.Id], UnitName: plot.PlotName, UnitType: own ? layout : unitType, UnitKind: unitKind,
          RatePerSqFt: (villaRate !== "" && Number(villaRate) > 0) ? Number(villaRate) : 0,
          VillaTypeId: own ? own.Id : (villaTypeId ? Number(villaTypeId) : null),
          BuiltUpAreaSqFt: own ? null : (builtUpArea ? Number(builtUpArea) : null),
          SuperBuiltUpAreaSqFt: own ? null : (superBuiltUpArea ? Number(superBuiltUpArea) : null),
        },
        ok: !!own || villaTypeId !== "" || Number(builtUpArea) > 0,
        // A planned type decides the rooms; one without a layout is reported,
        // never silently swapped for the dialog's type.
        typed: own ? !!layout : !!unitType,
      };
    });
    const noArea = jobs.filter((job) => !job.ok).map((job) => job.plot.PlotName);
    if (noArea.length) { toast.error(`No villa type planned on ${noArea.join(", ")} - choose a villa type or enter the built-up area for them`); return; }
    const noType = jobs.filter((job) => !job.typed).map((job) => job.plot.PlotName);
    if (noType.length) { toast.error(`No room layout for ${noType.join(", ")} — set the layout on their villa type (Villa types), or select a unit type for plots with no planned type`); return; }
    setConverting(true);
    const failed: string[] = [];
    let done = 0;
    let dprChains = 0;
    const noSteps = new Set<string>();
    for (const job of jobs) {
      try {
        const response = await fetchWithAuth(`${SETUP_API}/plots/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.body) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || body.message || "Could not convert");
        done++;
        dprChains += Number(body.DprChainsCreated) || 0;
        (body.DprRoomsWithoutTemplate || []).forEach((room: string) => noSteps.add(room.replace(/\s*\d+$/, "")));
      } catch (e: any) { failed.push(`${job.plot.PlotName}: ${e.message}`); }
    }
    setConverting(false);
    if (done) toast.success(`${done} villa${done === 1 ? "" : "s"} created, one per plot — ${dprChains} DPR room chain${dprChains === 1 ? "" : "s"} set up`);
    if (noSteps.size) toast.warning(`No DPR steps exist yet for: ${[...noSteps].join(", ")}. Set up one chain for each in Dependency Master, then run "chainless rooms" to fill these villas.`, { duration: 12000 });
    if (failed.length) toast.error(`Not converted - ${failed.join("; ")}`, { duration: 12000 });
    setSelectedIds((ids) => ids.filter((id) => jobs.some((job) => job.plot.Id === id && failed.some((f) => f.startsWith(`${job.plot.PlotName}:`)))));
    if (!failed.length) setConvertOpen(false);
    await queryClient.invalidateQueries({ queryKey: ["plot-master"] }); await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
    await queryClient.invalidateQueries({ queryKey: ["unit-master"] });
  };
  // Reverses a conversion made by mistake. The server refuses once the villa is
  // booked or held, or any DPR work has started; nothing is deleted.
  const undoConversion = async (plot: Plot) => {
    if (!plot.ConvertedUnitId) return;
    if (!window.confirm(`Undo the conversion of ${plot.PlotName}? The villa ${plot.ConvertedUnitName || ""} and its untouched DPR steps are retired and the plot can be converted again.`)) return;
    try {
      const response = await fetchWithAuth(`${SETUP_API}/plots/unconvert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ UnitId: plot.ConvertedUnitId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.message || "Could not undo the conversion");
      toast.success(body.message || "Conversion undone");
      setDetailOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] }); await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["unit-master"] });
    } catch (e: any) { toast.error(e.message); }
  };
  const convert = async () => {
    if (selectedPlots.length > 1 && !conversionConfirmed) { toast.error("Tick the confirmation under the preview first"); return; }
    if (separate) { await convertEach(); return; }
    if (!unitName.trim() || !unitType || !unitKind) { toast.error("Select the constructed unit name, type, and kind"); return; }
    if (!(Number(builtUpArea) > 0)) { toast.error("Enter the villa's built-up area"); return; }
    setConverting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const rateVal = villaRate !== "" && Number(villaRate) > 0 ? Number(villaRate) : null;
      const response = await fetchWithAuth(`${SETUP_API}/plots/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          PlotIds: selectedPlots.map((plot) => plot.Id), Combine: selectedPlots.length > 1 && conversionConfirmed, UnitName: unitName.trim(), UnitType: unitType, UnitKind: unitKind,
          RatePerSqFt: rateVal, VillaTypeId: villaTypeId ? Number(villaTypeId) : null, BuiltUpAreaSqFt: builtUpArea ? Number(builtUpArea) : null, SuperBuiltUpAreaSqFt: superBuiltUpArea ? Number(superBuiltUpArea) : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.message || "Could not convert plots");
      toast.success(`${selectedPlots.length} plot${selectedPlots.length === 1 ? "" : "s"} converted to ${unitName.trim()} in Unit Master — ${Number(body.DprChainsCreated) || 0} DPR room chains set up`);
      if (body.DprRoomsWithoutTemplate?.length) toast.warning(`No DPR steps exist yet for: ${body.DprRoomsWithoutTemplate.join(", ")}. Set up one chain for each in Dependency Master.`, { duration: 12000 });
      setSelectedIds([]); setConvertOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] }); await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["unit-master"] });
    } catch (e: any) {
      toast.error(e.name === "AbortError" ? "Request timed out — the server took too long. Please try again." : e.message);
    } finally { clearTimeout(timeout); setConverting(false); }
  };

  const editBlocks = blockCatalog.filter((block) => String(block.ProjectId) === String(plotDraft.ProjectId));

  const renderCard = (plot: Plot, style?: React.CSSProperties) => {
    const status = plotStatus(plot);
    const checked = selectedIds.includes(plot.Id);
    const dimmed = searching && !matchIds.has(plot.Id);
    return (
      <div
        key={plot.Id} role="button" tabIndex={0} style={style}
        onClick={() => openView(plot)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openView(plot); } }}
        className={`relative flex h-[88px] min-w-0 cursor-pointer flex-col justify-between rounded-lg border p-2 text-left outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-primary ${status.tone} ${checked ? "ring-2 ring-primary" : ""} ${dimmed ? "opacity-30" : ""}`}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="truncate text-sm font-medium">{plot.PlotName}</span>
          {rights.canCreate && canConvert(plot) && (
            <input type="checkbox" checked={checked} onClick={(event) => event.stopPropagation()} onChange={() => togglePlot(plot)} aria-label={`Select ${plot.PlotName}`} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
        </div>
        <div className="min-w-0">
          <span className="block truncate text-xs text-muted-foreground">
            {plot.AreaSqFt ? `${Number(plot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "Area pending"}{plot.IsCornerPlot ? " · Corner" : ""}{plot.Facing ? ` · ${plot.Facing}` : ""}{plot.PlannedVillaTypeCode ? ` · ${plot.PlannedVillaTypeCode}` : ""}
          </span>
          <span className="mt-0.5 block truncate text-[0.6875rem]">{status.label}</span>
        </div>
      </div>
    );
  };

  const renderSection = ({ block, plots: blockPlots }: { block: PlotBlock; plots: Plot[] }) => {
    const placed = blockPlots.filter((plot) => plot.GridRow != null && plot.GridCol != null);
    const unplaced = blockPlots.filter((plot) => plot.GridRow == null || plot.GridCol == null);
    const gridRows = placed.reduce((max, plot) => Math.max(max, (plot.GridRow as number) + 1), 0);
    const gridCols = placed.reduce((max, plot) => Math.max(max, (plot.GridCol as number) + 1), 0);
    return (
      <section key={block.BlockId} className="rounded-lg border border-border p-3">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold">{block.ProjectName} <span className="text-muted-foreground">/</span> {block.BlockName}</h3>
          <span className="text-xs text-muted-foreground">{blockPlots.length} plot{blockPlots.length === 1 ? "" : "s"}{placed.length ? "" : " · no layout yet, shown in order"}</span>
          {rights.canEdit && (
            <button onClick={() => openLayout(block.BlockId)} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"><Network size={13} /> Edit layout &amp; neighbours</button>
          )}
        </div>
        {blockPlots.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No plots in this block yet.</p>
        ) : placed.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(124px, 1fr))`, gridTemplateRows: `repeat(${gridRows}, 88px)` }}>
              {placed.map((plot) => renderCard(plot, { gridRow: (plot.GridRow as number) + 1, gridColumn: (plot.GridCol as number) + 1 }))}
            </div>
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>{blockPlots.map((plot) => renderCard(plot))}</div>
        )}
        {placed.length > 0 && unplaced.length > 0 && (
          <div className="mt-3 border-t border-dashed border-border pt-3">
            <p className="mb-2 text-xs text-muted-foreground">Not placed on the layout yet ({unplaced.length})</p>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>{unplaced.map((plot) => renderCard(plot))}</div>
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "CRM", path: "/crm/dashboard" }, { label: "Setup", path: "/crm/setup/auto-project-setup" }, { label: "Plot Master", path: "/crm/setup/plot-master" }]} />
      <CrmShell title="Plot Master" icon={MapIcon} action={
        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/crm/setup/auto-project-setup")} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted"><MapIcon size={14} /> Configure plots</button>
          {rights.canEdit && <button onClick={() => { setFacingDraft({}); setFacingsOpen(true); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted" title="Manage plot facings"><Settings2 size={14} /> Facings</button>}
          {rights.canEdit && <button onClick={() => setVillaTypesOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted" title="Manage villa types"><Settings2 size={14} /> Villa types</button>}
          
          <button onClick={() => refetch()} className="p-2 border border-border rounded-lg hover:bg-muted" title="Refresh"><RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /></button>
        </div>
      }>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {([["Total plots", stats.total, "text-foreground"], ["Available", stats.available, "text-emerald-600"], ["Locked", stats.locked, "text-sky-600"], ["Converted", stats.converted, "text-violet-600"]] as const).map(([label, value, color]) => (
            <div key={label} className="border border-border rounded-lg px-3 py-2.5"><p className="text-[0.6875rem] text-muted-foreground">{label}</p><p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p></div>
          ))}
        </div>

        {/* items-end + equal 36px controls: the Select trigger defaults to a taller box than the
            inputs, which pushed the Project/Block labels higher than the Search label. */}
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div className="w-full sm:w-56"><label className="text-xs text-muted-foreground block mb-1">Project</label>
            <Select value={projectId} onValueChange={(value) => { setProjectId(value); setBlockId(ALL); setSelectedIds([]); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All projects</SelectItem>{projects.map(([id, name]) => <SelectItem key={id} value={String(id)}>{name}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="w-full sm:w-48"><label className="text-xs text-muted-foreground block mb-1">Block</label>
            <Select value={blockId} onValueChange={(value) => { setBlockId(value); setSelectedIds([]); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All blocks</SelectItem>{blocks.map((block) => <SelectItem key={block.BlockId} value={String(block.BlockId)}>{block.BlockName}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="flex-1 min-w-52"><label className="text-xs text-muted-foreground block mb-1">Search</label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Plot, survey, project..." className={fieldCls} /></div>
          <div className="flex h-9 overflow-hidden rounded-lg border border-border" role="group" aria-label="Plot view">
            <button onClick={() => setViewMode("map")} className={`px-2 ${viewMode === "map" ? "bg-muted text-foreground" : "text-muted-foreground"}`} title="Site layout view"><MapIcon size={15} /></button>
            <button onClick={() => setViewMode("list")} className={`border-l border-border px-2 ${viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground"}`} title="Table view"><List size={15} /></button>
          </div>
          {rights.canCreate && <button onClick={openCreate} className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium border border-border rounded-lg hover:bg-muted"><Plus size={14} /> Add plot</button>}
          {rights.canEdit && (
            <button onClick={() => toolbarLayoutBlock != null && openLayout(toolbarLayoutBlock)} disabled={toolbarLayoutBlock == null}
              title={toolbarLayoutBlock == null ? "Pick a block (or select plots from one block) to edit its layout" : "Arrange plots and set neighbours"}
              className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium border border-border rounded-lg hover:bg-muted disabled:opacity-40"><Network size={14} /> Layout &amp; neighbours</button>
          )}
          {rights.canCreate && (
            <button onClick={openConversion} disabled={!selectedPlots.length} title={selectedPlots.length ? "Convert the selected plots" : "Tick one or more available plots first"}
              className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"><ArrowRight size={14} /> Convert to Unit</button>
          )}
        </div>

        {selectedPlots.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <span className="font-medium">{selectedPlots.length} plot{selectedPlots.length === 1 ? "" : "s"} selected</span>
            <span className="text-muted-foreground">{totalArea.toLocaleString("en-IN")} sq ft combined</span>
            <button onClick={() => setSelectedIds([])} className="ml-auto text-primary hover:underline">Clear selection</button>
          </div>
        )}
        {!selectionIsCompatible && selectedPlots.length > 1 && <p className="mb-3 text-xs text-destructive">Selected plots must be in the same project and block before conversion.</p>}

        {viewMode === "map" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" /> Available</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-sky-500" /> Applied / held</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-500" /> Booked</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-500" /> Converted</span>
            </div>
            {isLoading ? <p className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">Loading plots...</p>
              : error ? <p className="rounded-lg border border-border p-8 text-center text-sm text-destructive">Could not load Plot Master.</p>
              : blockSections.length === 0 ? <p className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">No plots match these filters.</p>
              : blockSections.map(renderSection)}
          </div>
        )}

        {viewMode === "list" && (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th className="w-10 px-3 py-2 text-left"><input type="checkbox" checked={selectable.length > 0 && selectable.every((plot) => selectedIds.includes(plot.Id))} onChange={toggleAll} aria-label="Select available plots" /></th>
                <th className="px-3 py-2 text-left font-medium">Plot</th>
                <th className="px-3 py-2 text-left font-medium">Project / Block</th>
                <th className="px-3 py-2 text-left font-medium">Survey</th>
                <th className="px-3 py-2 text-right font-medium">Area</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-left font-medium">Attributes</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading plots...</td></tr>
                : error ? <tr><td colSpan={9} className="p-8 text-center text-destructive">Could not load Plot Master.</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No plots match these filters.</td></tr>
                : filtered.map((plot) => {
                  const status = plotStatus(plot);
                  const canSelect = status.kind === "available";
                  return (
                    <tr key={plot.Id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2"><input type="checkbox" disabled={!canConvert(plot)} checked={selectedIds.includes(plot.Id)} onChange={() => togglePlot(plot)} aria-label={`Select ${plot.PlotName}`} /></td>
                      <td className="px-3 py-2 font-medium">{plot.PlotName}<span className="block text-[0.6875rem] text-muted-foreground">{plot.PlotNo}</span></td>
                      <td className="px-3 py-2">{plot.ProjectName}<span className="block text-[0.6875rem] text-muted-foreground">{plot.BlockName}</span></td>
                      <td className="px-3 py-2 text-muted-foreground">{plot.SurveyNo || "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{plot.AreaSqFt ? `${Number(plot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{plot.RatePerSqFt ? `Rs. ${Number(plot.RatePerSqFt).toLocaleString("en-IN")}` : "-"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{[facingName(plot.Facing), plot.IsCornerPlot ? "Corner" : "", plot.RoadWidthFt ? `${plot.RoadWidthFt} ft road` : "", plot.PlannedVillaTypeName ? `Plans ${plot.PlannedVillaTypeName}` : ""].filter(Boolean).join(" · ") || "-"}</td>
                      <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${status.cls}`}>{status.label}</span></td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button data-row-view onClick={() => openView(plot)} className="p-1.5 rounded hover:bg-muted" title="View plot"><Eye size={15} /></button>
                          {rights.canEdit && <button onClick={() => openEdit(plot)} disabled={!canSelect} className="p-1.5 rounded hover:bg-muted disabled:opacity-35" title={canSelect ? "Edit plot" : "Only available plots can be edited"}><Pencil size={15} /></button>}
                          {rights.canDelete && <button onClick={() => deletePlot(plot)} disabled={!canSelect} className="p-1.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-35" title={canSelect ? "Delete plot" : "Only available plots can be deleted"}><Trash2 size={15} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        )}

        {/* Facing master, managed in place. Deliberately a dialog on this page
            rather than its own screen: a facing has no meaning outside plots, and
            a separate master page would be one more thing to find and permission
            for a list of eight rows. */}
        <Dialog open={facingsOpen} onOpenChange={(open) => { setFacingsOpen(open); if (!open) setFacingDraft({}); }}>
          <DialogContent accent="crm" className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Settings2 size={17} className="text-primary" /> Plot facings</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">The premium is added to a plot&apos;s rate, so what a direction is worth lives here rather than in pricing code.</p>
            </DialogHeader>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Code</th>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-right font-medium">Premium %</th>
                    <th className="px-3 py-2 text-right font-medium">Plots</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allFacings.map((facing) => (
                    <tr key={facing.Id} className={`border-t border-border ${facing.IsActive === false ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs">{facing.Code}</td>
                      <td className="px-3 py-2">{facing.Name}{facing.IsActive === false && <span className="ml-2 text-[0.6875rem] text-muted-foreground">Inactive</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(facing.PremiumPercent) || 0}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{facing.PlotCount ?? 0}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setFacingDraft(facing)} className="p-1.5 rounded hover:bg-muted" title="Edit"><Pencil size={14} /></button>
                          {/* Disabled with a reason rather than hidden, so it is
                              clear the facing is in use rather than unremovable. */}
                          <button onClick={() => removeFacing(facing)} disabled={(facing.PlotCount ?? 0) > 0 || facing.IsActive === false}
                            title={(facing.PlotCount ?? 0) > 0 ? `In use by ${facing.PlotCount} plot(s)` : facing.IsActive === false ? "Already inactive" : "Remove"}
                            className="p-1.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-35"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {allFacings.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No facings defined yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-4 items-end pt-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Code</label>
                <input value={facingDraft.Code || ""} maxLength={20}
                  disabled={facingDraft.Id != null && (facingDraft.PlotCount ?? 0) > 0}
                  title={facingDraft.Id != null && (facingDraft.PlotCount ?? 0) > 0 ? "The code is locked while plots use it; the name and premium can still change" : undefined}
                  onChange={(event) => setFacingDraft((draft) => ({ ...draft, Code: event.target.value.toUpperCase() }))}
                  placeholder="NE" className={`${fieldCls} font-mono disabled:opacity-60`} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Name</label>
                <input value={facingDraft.Name || ""} maxLength={50} onChange={(event) => setFacingDraft((draft) => ({ ...draft, Name: event.target.value }))} placeholder="North-East" className={fieldCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Premium %</label>
                <input type="number" step="0.001" value={facingDraft.PremiumPercent ?? ""} onChange={(event) => setFacingDraft((draft) => ({ ...draft, PremiumPercent: event.target.value as any }))} className={`${fieldCls} tabular-nums`} />
              </div>
              <button onClick={saveFacing} disabled={savingFacing} className="h-9 px-3 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
                {savingFacing ? "Saving..." : facingDraft.Id != null ? "Update" : "Add facing"}
              </button>
            </div>
            {facingDraft.Id != null && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={facingDraft.IsActive !== false} onChange={(event) => setFacingDraft((draft) => ({ ...draft, IsActive: event.target.checked }))} /> Active
                <span className="text-xs text-muted-foreground">(untick to hide it from the plot dropdown; blocked while plots use it)</span>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              {facingDraft.Id != null && <button onClick={() => setFacingDraft({})} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">New instead</button>}
              <button onClick={() => setFacingsOpen(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Close</button>
            </div>
          </DialogContent>
        </Dialog>
      </CrmShell>

      <PlotLayoutEditor
        open={layoutState != null}
        onOpenChange={(open) => { if (!open) setLayoutState(null); }}
        blockId={layoutState?.blockId ?? null}
        title={layoutBlockInfo ? `${layoutBlockInfo.ProjectName} / ${layoutBlockInfo.BlockName}` : ""}
        plots={layoutState ? plots.filter((plot) => plot.BlockId === layoutState.blockId) : []}
        initialMode={layoutState?.mode}
        initialFocusId={layoutState?.focusId}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["plot-master"] });
          queryClient.invalidateQueries({ queryKey: ["plot-layout"] });
        }}
      />

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent accent="crm" className="w-[96vw] max-w-5xl gap-0 overflow-hidden p-0">
          {(() => {
            const many = selectedPlots.length > 1;
            const typesById = new Map(conversionVillaTypes.map((t) => [t.Id, t]));
            const fallback = villaTypeId ? conversionVillaTypes.find((t) => String(t.Id) === villaTypeId) : undefined;
            const unplanned = selectedPlots.filter((plot) => plot.PlannedVillaTypeId == null);
            const rows = separate
              ? selectedPlots.map((plot) => {
                  const own = plot.PlannedVillaTypeId != null ? typesById.get(plot.PlannedVillaTypeId) : undefined;
                  const type = own ?? fallback;
                  const bua = type ? Number(type.BuiltUpAreaSqFt) : Number(builtUpArea) || null;
                  return { key: plot.Id, name: plot.PlotName, on: [plot.PlotName], type: type?.Code ?? null, planned: !!own, bua };
                })
              : [{ key: 0, name: unitName.trim() || "Unnamed villa", on: selectedPlots.map((plot) => plot.PlotName), type: fallback?.Code ?? null, planned: false, bua: Number(builtUpArea) || null }];
            const missing = rows.filter((row) => !row.bua).length;
            const label = "mb-1.5 block text-xs font-medium text-muted-foreground";
            const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
            const canSubmit = !converting && !!unitKind && (!many || conversionConfirmed) && missing === 0
              && (separate || (!!unitName.trim() && !!unitType && Number(builtUpArea) > 0));
            return (
              <>
                {/* Header: what is being converted */}
                <div className="border-b border-border px-6 pb-4 pt-5">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg"><Home size={19} className="text-emerald-600" /> Build villas on plots</DialogTitle>
                  </DialogHeader>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {selectedPlots.map((plot) => (
                      <span key={plot.Id} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        {plot.PlotName}{plot.PlannedVillaTypeCode && <span className="font-mono opacity-70">· {plot.PlannedVillaTypeCode}</span>}
                      </span>
                    ))}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {selectedPlots[0]?.ProjectName} · Block {selectedPlots[0]?.BlockName} · {totalArea > 0 ? `${totalArea.toLocaleString("en-IN")} sq ft land` : "land area pending"}
                    </span>
                  </div>
                </div>

                <div className="grid max-h-[70vh] overflow-y-auto md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                  {/* Left: choices */}
                  <div className="space-y-6 px-6 py-5">
                    {many && (
                      <section>
                        <p className={label}>How should they be built?</p>
                        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Conversion">
                          {([
                            ["each", Home, "One villa per plot", `${selectedPlots.length} villas, each on its own plot`, "Recommended"],
                            ["combine", Combine, "Combine into one villa", "One villa standing across all the plots", ""],
                          ] as const).map(([value, Icon, title, hint, badge]) => {
                            const active = conversionMode === value;
                            return (
                              <button key={value} type="button" role="radio" aria-checked={active}
                                onClick={() => { setConversionMode(value); setConversionConfirmed(false); }}
                                className={`group relative flex gap-3 rounded-xl border p-3.5 text-left transition ${active
                                  ? value === "combine" ? "border-amber-500 bg-sky-500/10 ring-2 ring-amber-500/30" : "border-primary bg-primary/5 ring-2 ring-primary/25"
                                  : "border-border hover:border-primary/40 hover:bg-muted/50"}`}>
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? (value === "combine" ? "bg-amber-500 text-white" : "bg-primary text-primary-foreground") : "bg-muted text-muted-foreground"}`}><Icon size={17} /></span>
                                <span className="min-w-0">
                                  <span className="flex items-center gap-2 text-sm font-semibold">{title}{badge && <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[0.625rem] font-medium text-emerald-700 dark:text-emerald-300">{badge}</span>}</span>
                                  <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    <section className="space-y-4">
                      <p className={label}>Villa specification</p>
                      {!separate && (
                        <div><label className={label}>Villa name</label><input autoFocus value={unitName} onChange={(event) => setUnitName(event.target.value)} className={input} /></div>
                      )}
                      <div>
                        <div className="flex items-center justify-between">
                          <label className={label}>{separate ? "Villa type for plots with none planned" : "Villa type"}</label>
                          {rights.canEdit && <button type="button" onClick={() => setVillaTypesOpen(true)} className="mb-1.5 text-xs font-medium text-primary hover:underline">Manage types</button>}
                        </div>
                        <select value={villaTypeId} onChange={(event) => { if (event.target.value) applyVillaType(event.target.value); else setVillaTypeId(""); }} className={input}
                          disabled={separate && unplanned.length === 0}>
                          <option value="">{separate && unplanned.length === 0 ? "Every plot has its own planned type" : "None - enter the areas by hand"}</option>
                          {conversionVillaTypes.map((t) => <option key={t.Id} value={t.Id}>{t.Code} · {t.Name} · {Number(t.BuiltUpAreaSqFt).toLocaleString("en-IN")} sq ft</option>)}
                        </select>
                        {separate && unplanned.length > 0 && <p className="mt-1.5 text-xs text-muted-foreground">No type planned on {unplanned.map((plot) => plot.PlotName).join(", ")}. Plots with a planned type use their own.</p>}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div><label className={label}>Unit type (room layout)</label>
                          <Select value={unitType || undefined} onValueChange={setUnitType}><SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Select a layout" /></SelectTrigger><SelectContent>{unitTypeOptionsForConversion.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
                        <div><label className={label}>Asset kind</label>
                          <Select value={unitKind || undefined} onValueChange={setUnitKind}><SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Select a kind" /></SelectTrigger><SelectContent>{constructedAssetKinds.map((kind) => <SelectItem key={kind.Id} value={kind.Code}>{kind.Name}</SelectItem>)}</SelectContent></Select></div>
                        <div className="sm:col-span-2"><label className={label}>Construction rate <span className="font-normal opacity-70">· Optional</span></label>
                          <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                            <input type="number" min="0" value={villaRate} onChange={(event) => setVillaRate(event.target.value)} placeholder="0" className={`${input} pl-7 pr-16 tabular-nums`} />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">per sq ft</span></div></div>
                        {[["Built-up area", builtUpArea, setBuiltUpArea, "Required"], ["Super built-up area", superBuiltUpArea, setSuperBuiltUpArea, "Optional"]].map(([text, value, set, hint]) => (
                          <div key={text as string}><label className={label}>{text as string} <span className="font-normal opacity-70">· {hint as string}</span></label>
                            <div className="relative">
                              <input type="number" min="0" value={value as string} onChange={(event) => (set as (v: string) => void)(event.target.value)}
                                disabled={separate && unplanned.length === 0} placeholder={separate && unplanned.length === 0 ? "From each plot's type" : "0"}
                                className={`${input} pr-14 tabular-nums disabled:opacity-60`} />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">sq ft</span></div></div>
                        ))}
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">Priced on construction only. A sold plot's owner has already paid for the land and buys the villa as a separate booking. If super built-up is given, it is the saleable area.</p>
                    </section>
                  </div>

                  {/* Right: result preview + confirmation */}
                  <aside className="flex flex-col gap-4 border-t border-border bg-muted/30 px-6 py-5 md:border-l md:border-t-0">
                    <div className="flex items-baseline justify-between">
                      <p className="text-sm font-semibold">{separate ? `${rows.length} villas will be created` : many ? `${selectedPlots.length} plots → 1 villa` : "1 villa will be created"}</p>
                      {missing > 0 && <span className="text-xs font-medium text-destructive">{missing} missing built-up area</span>}
                    </div>
                    {!separate && many && (
                      <div className="rounded-lg border border-amber-500/40 bg-sky-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                        Merging is permanent: these plots can never be sold or built on separately again. Use it only when one villa really stands across them.
                      </div>
                    )}
                    <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {rows.map((row) => (
                        <li key={row.key} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 shadow-sm">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><Home size={15} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{row.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">on {row.on.join(" + ")}</span>
                          </span>
                          <span className="text-right">
                            {row.type ? <span className="inline-block rounded-md bg-primary/10 px-1.5 py-px font-mono text-[0.6875rem] text-primary">{row.type}{row.planned ? "" : " *"}</span> : <span className="text-[0.6875rem] text-muted-foreground">No type</span>}
                            <span className={`block text-xs tabular-nums ${row.bua ? "text-foreground" : "font-medium text-destructive"}`}>{row.bua ? `${row.bua.toLocaleString("en-IN")} sq ft` : "Built-up missing"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {separate && rows.some((row) => row.type && !row.planned) && <p className="-mt-2 text-[0.6875rem] text-muted-foreground">* type chosen here, not planned on the plot</p>}
                    <p className="flex gap-1.5 text-xs text-muted-foreground"><Lock size={13} className="mt-px shrink-0" /> The plots stay in Plot Master as converted history and can no longer be booked or edited as plots.</p>
                    {many && (
                      <label className={`mt-auto flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs transition ${conversionConfirmed ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={conversionConfirmed} onChange={(event) => setConversionConfirmed(event.target.checked)} />
                        <span><span className="font-medium">{separate ? `Create ${rows.length} separate villas as listed.` : `Merge ${selectedPlots.length} plots into one villa.`}</span> I understand this cannot be undone.</span>
                      </label>
                    )}
                  </aside>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-border bg-background px-6 py-3.5">
                  <button onClick={() => setConvertOpen(false)} className="h-9 rounded-lg border border-border px-4 text-sm hover:bg-muted">Cancel</button>
                  <button onClick={convert} disabled={!canSubmit}
                    className={`h-9 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${!separate && many ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                    {converting ? "Converting..." : separate ? `Create ${selectedPlots.length} villas` : many ? `Merge ${selectedPlots.length} plots into 1 villa` : "Create villa"}
                  </button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <VillaTypesDialog
        open={villaTypesOpen} onOpenChange={setVillaTypesOpen}
        projects={Array.from(new Map(blockCatalog.map((block) => [block.ProjectId, { ProjectId: block.ProjectId, ProjectName: block.ProjectName }])).values())}
        initialProjectId={projectId !== ALL ? Number(projectId) : null}
        layoutTypes={layoutTypes}
        selectedPlotIds={selectedPlots.length > 0 && selectedPlots.every((plot) => plot.ProjectId === selectedPlots[0].ProjectId) ? selectedPlots.map((plot) => plot.Id) : []}
        selectedProjectId={selectedPlots[0]?.ProjectId ?? null}
        onPlotsChanged={() => queryClient.invalidateQueries({ queryKey: ["plot-master"] })}
      />
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent accent="crm" className="max-w-xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2">{detailPlot?.PlotName || "Plot details"}</DialogTitle></DialogHeader>
          {detailPlot && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-3">
                <div><p className="text-xs text-muted-foreground">Project / Block</p><p>{detailPlot.ProjectName} / {detailPlot.BlockName}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><p>{plotStatus(detailPlot).label}</p></div>
                <div><p className="text-xs text-muted-foreground">Plot number</p><p>{detailPlot.PlotNo}</p></div>
                <div><p className="text-xs text-muted-foreground">Survey number</p><p>{detailPlot.SurveyNo || "-"}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div><p className="text-xs text-muted-foreground">Area</p><p>{detailPlot.AreaSqFt ? `${Number(detailPlot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Rate</p><p>{detailPlot.RatePerSqFt ? `Rs. ${Number(detailPlot.RatePerSqFt).toLocaleString("en-IN")} / sq ft` : "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Dimensions</p><p>{detailPlot.PlotWidthFt || "-"} ft x {detailPlot.PlotDepthFt || "-"} ft</p></div>
                <div><p className="text-xs text-muted-foreground">Facing / road</p><p>{facingName(detailPlot.Facing) || "-"}{detailPlot.RoadWidthFt ? ` / ${detailPlot.RoadWidthFt} ft` : ""}</p></div>
                <div><p className="text-xs text-muted-foreground">Guideline rate</p><p>{detailPlot.GuidelineRatePerSqFt ? `Rs. ${Number(detailPlot.GuidelineRatePerSqFt).toLocaleString("en-IN")}` : "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Neighbours</p><p>{detailPlot.AdjacentPlotCount || 0}</p></div>
              </div>
              {detailPlot.ConvertedUnitId && (
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 flex items-center justify-between gap-3">
                  <div><p className="text-xs text-muted-foreground">Converted Unit Master record</p><p className="font-medium">{detailPlot.ConvertedUnitName || `Unit #${detailPlot.ConvertedUnitId}`}</p></div>
                  {rights.canDelete && (
                    <button onClick={() => undoConversion(detailPlot)} className="shrink-0 px-3 py-1.5 text-xs border border-destructive/40 text-destructive rounded-lg hover:bg-destructive/10"
                      title="Only while the villa is unsold and no DPR work has started">Undo conversion</button>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setDetailOpen(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Close</button>
                {rights.canEdit && !detailPlot.ConvertedUnitId && (
                  <button onClick={() => { setDetailOpen(false); openLayout(detailPlot.BlockId, "neighbours", detailPlot.Id); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted"><Network size={13} /> Neighbours</button>
                )}
                {rights.canEdit && plotStatus(detailPlot).kind === "available" && (
                  <button onClick={() => { setDetailOpen(false); openEdit(detailPlot); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90"><Pencil size={13} /> Edit</button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={closeEdit}>
        <DialogContent accent="crm" className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2">{creatingPlot ? <Plus size={17} className="text-primary" /> : <Pencil size={17} className="text-primary" />} {creatingPlot ? "Add plot" : "Edit plot"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {creatingPlot && (
              <>
                <div><label className="mb-1 block text-xs text-muted-foreground">Project</label>
                  <select value={plotDraft.ProjectId || ""} onChange={(event) => { const next = blockCatalog.find((block) => String(block.ProjectId) === event.target.value); setPlotDraft((draft) => ({ ...draft, ProjectId: event.target.value, BlockId: next ? String(next.BlockId) : "" })); }} className={fieldCls}>
                    <option value="" disabled>Select a project</option>
                    {projects.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
                  </select></div>
                <div><label className="mb-1 block text-xs text-muted-foreground">Block</label>
                  <select value={plotDraft.BlockId || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, BlockId: event.target.value }))} className={fieldCls}>
                    <option value="" disabled>Select a block</option>
                    {editBlocks.map((block) => <option key={block.BlockId} value={String(block.BlockId)}>{block.BlockName}</option>)}
                  </select></div>
              </>
            )}
            <div><label className="mb-1 block text-xs text-muted-foreground">Plot number</label><input value={plotDraft.PlotNo || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, PlotNo: event.target.value }))} className={fieldCls} /></div>
            <div><label className="mb-1 block text-xs text-muted-foreground">Plot name</label><input value={plotDraft.PlotName || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, PlotName: event.target.value }))} className={fieldCls} /></div>
            <div><label className="mb-1 block text-xs text-muted-foreground">Survey number</label><input value={plotDraft.SurveyNo || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, SurveyNo: event.target.value }))} className={fieldCls} /></div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs text-muted-foreground">Facing</label>
                {rights.canEdit && <button type="button" onClick={() => setFacingsOpen(true)} className="text-[0.6875rem] text-primary hover:underline">Manage</button>}
              </div>
              <select value={plotDraft.Facing || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, Facing: event.target.value }))} className={fieldCls}>
                <option value="">Not set</option>
                {facings.map((facing) => <option key={facing.Id} value={facing.Code}>{facing.Name}{Number(facing.PremiumPercent) ? ` (+${facing.PremiumPercent}%)` : ""}</option>)}
                {/* A plot saved before this became a master may hold a code no longer listed. Showing it
                    keeps the current value visible instead of silently resetting the field to "Not set". */}
                {plotDraft.Facing && !facings.some((facing) => facing.Code === plotDraft.Facing) && <option value={plotDraft.Facing}>{plotDraft.Facing} (not in master)</option>}
              </select>
              {facingsFailed && <p className="mt-1 text-[0.6875rem] text-destructive">Could not load the facing list - the options above may be incomplete.</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Planned villa type</label>
              <select value={plotDraft.PlannedVillaTypeId ?? ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, PlannedVillaTypeId: event.target.value || null }))} className={fieldCls}>
                <option value="">Not planned</option>
                {editVillaTypes.map((t) => <option key={t.Id} value={t.Id}>{t.Code} - {t.Name}</option>)}
                {plotDraft.PlannedVillaTypeId && !editVillaTypes.some((t) => String(t.Id) === String(plotDraft.PlannedVillaTypeId)) && <option value={plotDraft.PlannedVillaTypeId}>{plotDraft.PlannedVillaTypeName || "Current type"} (inactive)</option>}
              </select>
            </div>
            {[["AreaSqFt", "Area (sq ft)"], ["RatePerSqFt", "Rate per sq ft"], ["PlotWidthFt", "Width (ft)"], ["PlotDepthFt", "Depth (ft)"], ["RoadWidthFt", "Road width (ft)"], ["GuidelineRatePerSqFt", "Guideline rate / sq ft"]].map(([field, label]) => (
              <div key={field}><label className="mb-1 block text-xs text-muted-foreground">{label}</label><input type="number" min="0" step="0.01" value={plotDraft[field] ?? ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, [field]: event.target.value }))} className={fieldCls} /></div>
            ))}
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={plotDraft.IsCornerPlot === true} onChange={(event) => setPlotDraft((draft) => ({ ...draft, IsCornerPlot: event.target.checked }))} /> Corner plot</label>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button onClick={() => closeEdit(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Cancel</button>
            <button onClick={savePlot} disabled={savingPlot || !plotDraft.PlotNo?.trim() || !plotDraft.PlotName?.trim()} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">{savingPlot ? "Saving..." : creatingPlot ? "Create plot" : "Save changes"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmPlotMaster;
