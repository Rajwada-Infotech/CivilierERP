import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Map as MapIcon, ArrowRight, CheckCircle2, Lock, RefreshCw, Network, Settings2, Eye, Pencil, Plus, Trash2, List } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CrmShell } from "@/components/crm/CrmShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { getLayoutTypes, unitTypeOptions, LAYOUT_TYPES_QUERY_KEY, type LayoutType } from "@/api/unitBhkConfigApi";
import { PlotLayoutEditor, naturalCompare, plotOrder } from "./PlotLayoutEditor";

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
  ConvertedUnitId?: number | null; ConvertedAt?: string | null; ConvertedUnitName?: string | null;
  LockBookingNo?: string | null; LockApplicationNo?: string | null; LockHoldId?: number | null; AdjacentPlotCount?: number;
};
type PlotBlock = { BlockId: number; BlockName: string; ProjectId: number; ProjectName: string };
type ConstructedAssetKind = { Id: number; Code: string; Name: string; SortOrder?: number; IsActive?: boolean };
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
async function fetchConstructedAssetKinds(): Promise<ConstructedAssetKind[]> {
  const response = await fetchWithAuth(`${PLOT_API}/constructed-kinds`);
  if (!response.ok) throw new Error("Failed to load constructed asset kinds");
  return response.json();
}
async function fetchManagedConstructedAssetKinds(): Promise<ConstructedAssetKind[]> {
  const response = await fetchWithAuth(`${PLOT_API}/constructed-kinds/manage`);
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
  const [converting, setConverting] = useState(false);
  const [layoutState, setLayoutState] = useState<{ blockId: number; mode: "arrange" | "neighbours"; focusId: number | null } | null>(null);
  const [assetKindsOpen, setAssetKindsOpen] = useState(false);
  const [assetKindDraft, setAssetKindDraft] = useState({ Id: 0, Code: "", Name: "", SortOrder: "100", IsActive: true });
  const [savingAssetKind, setSavingAssetKind] = useState(false);
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
  const { data: constructedAssetKinds = [] } = useQuery<ConstructedAssetKind[]>({ queryKey: ["constructed-asset-kinds"], queryFn: fetchConstructedAssetKinds, staleTime: 60_000 });
  const { data: managedAssetKinds = [] } = useQuery<ConstructedAssetKind[]>({ queryKey: ["constructed-asset-kinds", "manage"], queryFn: fetchManagedConstructedAssetKinds, staleTime: 30_000 });
  const unitTypeOptionsForConversion = useMemo(() => unitTypeOptions(layoutTypes, unitType), [layoutTypes, unitType]);

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
    setConvertOpen(true);
  };

  // Layout editor target: the block being viewed, or the block of the selected plots.
  const toolbarLayoutBlock = blockId !== ALL ? Number(blockId) : selectedPlots.length > 0 && selectedPlots.every((plot) => plot.BlockId === selectedPlots[0].BlockId) ? selectedPlots[0].BlockId : null;
  const openLayout = (targetBlockId: number, mode: "arrange" | "neighbours" = "arrange", focusId: number | null = null) => setLayoutState({ blockId: targetBlockId, mode, focusId });
  const layoutBlockInfo = layoutState ? blockCatalog.find((block) => block.BlockId === layoutState.blockId) : undefined;

  const editAssetKind = (kind?: ConstructedAssetKind) => setAssetKindDraft(kind
    ? { Id: kind.Id, Code: kind.Code, Name: kind.Name, SortOrder: String(kind.SortOrder ?? 100), IsActive: kind.IsActive !== false }
    : { Id: 0, Code: "", Name: "", SortOrder: "100", IsActive: true });
  const saveAssetKind = async () => {
    setSavingAssetKind(true);
    try {
      const payload = { Code: assetKindDraft.Code, Name: assetKindDraft.Name, SortOrder: Number(assetKindDraft.SortOrder), IsActive: assetKindDraft.IsActive };
      const response = await fetchWithAuth(assetKindDraft.Id ? `${PLOT_API}/constructed-kinds/${assetKindDraft.Id}` : `${PLOT_API}/constructed-kinds`, {
        method: assetKindDraft.Id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save constructed asset kind");
      toast.success("Constructed asset kind saved");
      editAssetKind();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["constructed-asset-kinds"] }),
        queryClient.invalidateQueries({ queryKey: ["constructed-asset-kinds", "manage"] }),
      ]);
    } catch (e: any) { toast.error(e.message); } finally { setSavingAssetKind(false); }
  };

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
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    } catch (e: any) { toast.error(e.message); } finally { setSavingPlot(false); }
  };
  const deletePlot = async (plot: Plot) => {
    if (!window.confirm(`Delete ${plot.PlotName}? This cannot be undone.`)) return;
    try {
      const response = await fetchWithAuth(`${PLOT_API}/${plot.Id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not delete plot");
      toast.success("Plot deleted"); setSelectedIds((ids) => ids.filter((id) => id !== plot.Id));
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    } catch (e: any) { toast.error(e.message); }
  };
  const convert = async () => {
    if (!unitName.trim() || !unitType || !unitKind) { toast.error("Select the constructed unit name, type, and kind"); return; }
    if (!(Number(villaRate) > 0)) { toast.error("Enter the villa's construction rate per sq ft"); return; }
    setConverting(true);
    try {
      const response = await fetchWithAuth(`${SETUP_API}/plots/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          PlotIds: selectedPlots.map((plot) => plot.Id), UnitName: unitName.trim(), UnitType: unitType, UnitKind: unitKind,
          RatePerSqFt: Number(villaRate), AreaSqFt: builtUpArea ? Number(builtUpArea) : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not convert plots");
      toast.success(`${selectedPlots.length} plot${selectedPlots.length === 1 ? "" : "s"} converted to ${unitName.trim()} in Unit Master`);
      setSelectedIds([]); setConvertOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
      await queryClient.invalidateQueries({ queryKey: ["unit-master"] });
    } catch (e: any) { toast.error(e.message); } finally { setConverting(false); }
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
            {plot.AreaSqFt ? `${Number(plot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "Area pending"}{plot.IsCornerPlot ? " · Corner" : ""}{plot.Facing ? ` · ${plot.Facing}` : ""}
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
          {rights.canEdit && <button onClick={() => { editAssetKind(); setAssetKindsOpen(true); }} className="p-2 border border-border rounded-lg hover:bg-muted" title="Manage constructed asset kinds"><Settings2 size={14} /></button>}
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
                      <td className="px-3 py-2 text-xs text-muted-foreground">{[facingName(plot.Facing), plot.IsCornerPlot ? "Corner" : "", plot.RoadWidthFt ? `${plot.RoadWidthFt} ft road` : ""].filter(Boolean).join(" · ") || "-"}</td>
                      <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${status.cls}`}>{status.label}</span></td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openView(plot)} className="p-1.5 rounded hover:bg-muted" title="View plot"><Eye size={15} /></button>
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
        <DialogContent accent="crm" className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 size={17} className="text-emerald-600" /> Convert plots to Unit Master</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              <p className="font-medium">{selectedPlots.map((plot) => plot.PlotName).join(", ")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{selectedPlots[0]?.ProjectName} · {selectedPlots[0]?.BlockName} · {totalArea.toLocaleString("en-IN")} sq ft combined area</p>
            </div>
            <div><label className="text-xs text-muted-foreground block mb-1">Constructed unit name</label><input autoFocus value={unitName} onChange={(event) => setUnitName(event.target.value)} className={fieldCls} /></div>
            <div><label className="text-xs text-muted-foreground block mb-1">Unit type</label>
              <Select value={unitType || undefined} onValueChange={setUnitType}><SelectTrigger className="h-9"><SelectValue placeholder="Select a configured unit type" /></SelectTrigger><SelectContent>{unitTypeOptionsForConversion.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-xs text-muted-foreground block mb-1">Constructed asset kind</label>
              <Select value={unitKind || undefined} onValueChange={setUnitKind}><SelectTrigger className="h-9"><SelectValue placeholder="Select a configured asset kind" /></SelectTrigger><SelectContent>{constructedAssetKinds.map((kind) => <SelectItem key={kind.Id} value={kind.Code}>{kind.Name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground block mb-1">Construction rate (₹/sq ft)</label><input type="number" min="0" value={villaRate} onChange={(event) => setVillaRate(event.target.value)} className={fieldCls} /></div>
              <div><label className="text-xs text-muted-foreground block mb-1">Built-up area (sq ft)</label><input type="number" min="0" value={builtUpArea} onChange={(event) => setBuiltUpArea(event.target.value)} placeholder={`${totalArea.toLocaleString("en-IN")} (plot area)`} className={fieldCls} /></div>
            </div>
            <p className="text-xs text-muted-foreground">The villa is priced on its construction rate only. A sold plot's owner has already paid for the land; they buy the villa as a separate booking.</p>
            <p className="text-xs text-muted-foreground flex gap-1.5"><Lock size={13} className="shrink-0" /> The source plots remain in Plot Master as converted history and can no longer be booked or edited as plots.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setConvertOpen(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Cancel</button>
              <button onClick={convert} disabled={converting || !unitName.trim() || !unitType || !unitKind || !(Number(villaRate) > 0)} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40">{converting ? "Converting..." : "Create Unit Master record"}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={assetKindsOpen} onOpenChange={setAssetKindsOpen}>
        <DialogContent accent="crm" className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 size={17} className="text-primary" /> Constructed asset kinds</DialogTitle></DialogHeader>
          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <div className="max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {managedAssetKinds.map((kind) => (
                <button key={kind.Id} onClick={() => editAssetKind(kind)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40">
                  <span className="font-medium">{kind.Name}</span><span className="text-xs text-muted-foreground">{kind.Code}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{kind.IsActive === false ? "Inactive" : "Active"}</span>
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs text-muted-foreground">Name</label><input value={assetKindDraft.Name} onChange={(event) => setAssetKindDraft((draft) => ({ ...draft, Name: event.target.value }))} className={fieldCls} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">Code</label><input value={assetKindDraft.Code} onChange={(event) => setAssetKindDraft((draft) => ({ ...draft, Code: event.target.value.toUpperCase() }))} className={fieldCls} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">Sort order</label><input type="number" min="0" max="9999" value={assetKindDraft.SortOrder} onChange={(event) => setAssetKindDraft((draft) => ({ ...draft, SortOrder: event.target.value }))} className={fieldCls} /></div>
              {assetKindDraft.Id > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={assetKindDraft.IsActive} onChange={(event) => setAssetKindDraft((draft) => ({ ...draft, IsActive: event.target.checked }))} /> Active</label>}
              <div className="flex justify-end gap-2">
                <button onClick={() => editAssetKind()} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">New</button>
                <button onClick={saveAssetKind} disabled={savingAssetKind || !assetKindDraft.Name.trim() || !assetKindDraft.Code.trim()} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">{savingAssetKind ? "Saving..." : "Save"}</button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent accent="crm" className="max-w-xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye size={17} className="text-primary" /> {detailPlot?.PlotName || "Plot details"}</DialogTitle></DialogHeader>
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
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3"><p className="text-xs text-muted-foreground">Converted Unit Master record</p><p className="font-medium">{detailPlot.ConvertedUnitName || `Unit #${detailPlot.ConvertedUnitId}`}</p></div>
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
