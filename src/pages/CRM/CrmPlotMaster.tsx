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

const PLOT_API = "/api/plot-master";
const SETUP_API = "/api/crm/project-auto-setup";
const ALL = "__all__";

type Plot = {
  Id: number; ProjectId: number; ProjectName: string; BlockId: number; BlockName: string;
  PlotNo: string; PlotName: string; SurveyNo?: string | null; AreaSqFt?: number | null;
  RatePerSqFt?: number | null; Facing?: string | null; IsCornerPlot?: boolean;
  RoadWidthFt?: number | null; PlotWidthFt?: number | null; PlotDepthFt?: number | null; GuidelineRatePerSqFt?: number | null;
  ConvertedUnitId?: number | null; ConvertedAt?: string | null; ConvertedUnitName?: string | null;
  LockBookingNo?: string | null; LockApplicationNo?: string | null; LockHoldId?: number | null; AdjacentPlotCount?: number;
};
type ConstructedAssetKind = { Id: number; Code: string; Name: string; SortOrder?: number; IsActive?: boolean };

async function fetchPlots(): Promise<Plot[]> {
  const response = await fetchWithAuth(PLOT_API);
  if (!response.ok) throw new Error("Failed to load Plot Master");
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

function plotStatus(plot: Plot) {
  if (plot.ConvertedUnitId) return { label: "Converted", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300" };
  if (plot.LockBookingNo) return { label: `Booked: ${plot.LockBookingNo}`, cls: "bg-red-500/10 text-red-700 dark:text-red-300" };
  if (plot.LockApplicationNo) return { label: `Application: ${plot.LockApplicationNo}`, cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  if (plot.LockHoldId) return { label: "On hold", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  return { label: "Available", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
}

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
  const [converting, setConverting] = useState(false);
  const [adjacencyOpen, setAdjacencyOpen] = useState(false);
  const [adjacentIds, setAdjacentIds] = useState<number[]>([]);
  const [savingAdjacency, setSavingAdjacency] = useState(false);
  const [assetKindsOpen, setAssetKindsOpen] = useState(false);
  const [assetKindDraft, setAssetKindDraft] = useState({ Id: 0, Code: "", Name: "", SortOrder: "100", IsActive: true });
  const [savingAssetKind, setSavingAssetKind] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [detailPlot, setDetailPlot] = useState<Plot | null>(null);
  const [plotDraft, setPlotDraft] = useState<Record<string, any>>({});
  const [savingPlot, setSavingPlot] = useState(false);
  const [creatingPlot, setCreatingPlot] = useState(false);
  const { data: plots = [], isLoading, error, refetch, isFetching } = useQuery({ queryKey: ["plot-master"], queryFn: fetchPlots, staleTime: 30_000 });
  const { data: layoutTypes = [] } = useQuery<LayoutType[]>({ queryKey: LAYOUT_TYPES_QUERY_KEY, queryFn: getLayoutTypes, staleTime: 60_000 });
  const { data: constructedAssetKinds = [] } = useQuery<ConstructedAssetKind[]>({ queryKey: ["constructed-asset-kinds"], queryFn: fetchConstructedAssetKinds, staleTime: 60_000 });
  const { data: managedAssetKinds = [] } = useQuery<ConstructedAssetKind[]>({ queryKey: ["constructed-asset-kinds", "manage"], queryFn: fetchManagedConstructedAssetKinds, staleTime: 30_000 });
  const unitTypeOptionsForConversion = useMemo(() => unitTypeOptions(layoutTypes, unitType), [layoutTypes, unitType]);

  const projects = useMemo(() => Array.from(new Map(plots.map((plot) => [plot.ProjectId, plot.ProjectName])).entries()), [plots]);
  const blocks = useMemo(() => Array.from(new Map(plots.filter((plot) => projectId === ALL || String(plot.ProjectId) === projectId).map((plot) => [plot.BlockId, plot.BlockName])).entries()), [plots, projectId]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return plots.filter((plot) =>
      (projectId === ALL || String(plot.ProjectId) === projectId)
      && (blockId === ALL || String(plot.BlockId) === blockId)
      && (!term || [plot.PlotName, plot.PlotNo, plot.ProjectName, plot.BlockName, plot.SurveyNo].some((value) => String(value || "").toLowerCase().includes(term)))
    );
  }, [plots, projectId, blockId, search]);
  const selectable = useMemo(() => filtered.filter((plot) => !plot.ConvertedUnitId && !plot.LockBookingNo && !plot.LockApplicationNo && !plot.LockHoldId), [filtered]);
  const selectedPlots = useMemo(() => plots.filter((plot) => selectedIds.includes(plot.Id)), [plots, selectedIds]);
  const adjacencySource = selectedPlots.length === 1 ? selectedPlots[0] : null;
  const adjacencyCandidates = useMemo(() => adjacencySource ? plots.filter((plot) =>
    plot.Id !== adjacencySource.Id && plot.ProjectId === adjacencySource.ProjectId && plot.BlockId === adjacencySource.BlockId
    && !plot.ConvertedUnitId
  ) : [], [plots, adjacencySource]);
  const selectionIsCompatible = selectedPlots.length > 0 && selectedPlots.every((plot) => plot.ProjectId === selectedPlots[0].ProjectId && plot.BlockId === selectedPlots[0].BlockId);
  const totalArea = selectedPlots.reduce((total, plot) => total + Number(plot.AreaSqFt || 0), 0);
  const stats = useMemo(() => ({
    total: plots.length,
    available: plots.filter((plot) => plotStatus(plot).label === "Available").length,
    locked: plots.filter((plot) => plot.LockBookingNo || plot.LockApplicationNo || plot.LockHoldId).length,
    converted: plots.filter((plot) => plot.ConvertedUnitId).length,
  }), [plots]);

  const togglePlot = (plot: Plot) => setSelectedIds((current) => current.includes(plot.Id) ? current.filter((id) => id !== plot.Id) : [...current, plot.Id]);
  const toggleAll = () => setSelectedIds((current) => selectable.every((plot) => current.includes(plot.Id)) ? current.filter((id) => !selectable.some((plot) => plot.Id === id)) : Array.from(new Set([...current, ...selectable.map((plot) => plot.Id)])));
  const openConversion = () => {
    if (!selectionIsCompatible) { toast.error("Select plots from one project and block to create one constructed unit"); return; }
    setUnitName(selectedPlots.map((plot) => plot.PlotName).join(" + "));
    setConvertOpen(true);
  };
  const openAdjacency = async () => {
    if (!adjacencySource) return;
    try {
      const response = await fetchWithAuth(`${PLOT_API}/${adjacencySource.Id}/adjacent`);
      if (!response.ok) throw new Error("Could not load plot neighbours");
      const neighbours = await response.json();
      setAdjacentIds(neighbours.map((plot: Plot) => plot.Id));
      setAdjacencyOpen(true);
    } catch (error: any) { toast.error(error.message); }
  };
  const saveAdjacency = async () => {
    if (!adjacencySource) return;
    setSavingAdjacency(true);
    try {
      const response = await fetchWithAuth(`${PLOT_API}/${adjacencySource.Id}/adjacent`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AdjacentPlotIds: adjacentIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save plot neighbours");
      toast.success("Plot adjacency saved");
      setAdjacencyOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    } catch (error: any) { toast.error(error.message); } finally { setSavingAdjacency(false); }
  };
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
    } catch (error: any) { toast.error(error.message); } finally { setSavingAssetKind(false); }
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
    try { await loadPlotDetail(plot); } catch (error: any) { toast.error(error.message); }
  };
  const openEdit = async (plot: Plot) => {
    try {
      const fullPlot = await loadPlotDetail(plot);
      setPlotDraft({ ...fullPlot, IsCornerPlot: Boolean(fullPlot.IsCornerPlot) });
      setEditOpen(true);
    } catch (error: any) { toast.error(error.message); }
  };
  const openCreate = () => {
    const nextProjectId = projectId !== ALL ? projectId : projects[0] ? String(projects[0][0]) : "";
    const nextBlocks = plots.filter((plot) => String(plot.ProjectId) === nextProjectId);
    setDetailPlot(null);
    setPlotDraft({ ProjectId: nextProjectId, BlockId: nextBlocks[0] ? String(nextBlocks[0].BlockId) : "", PlotNo: "", PlotName: "", IsCornerPlot: false });
    setCreatingPlot(true); setEditOpen(true);
  };
  const savePlot = async () => {
    if (!detailPlot && !creatingPlot) return;
    setSavingPlot(true);
    try {
      const response = await fetchWithAuth(creatingPlot ? PLOT_API : `${PLOT_API}/${detailPlot!.Id}`, {
        method: creatingPlot ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plotDraft),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not update plot");
      toast.success(creatingPlot ? "Plot created" : "Plot updated"); setEditOpen(false); setCreatingPlot(false);
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    } catch (error: any) { toast.error(error.message); } finally { setSavingPlot(false); }
  };
  const deletePlot = async (plot: Plot) => {
    if (!window.confirm(`Delete ${plot.PlotName}? This cannot be undone.`)) return;
    try {
      const response = await fetchWithAuth(`${PLOT_API}/${plot.Id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not delete plot");
      toast.success("Plot deleted"); setSelectedIds((ids) => ids.filter((id) => id !== plot.Id));
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    } catch (error: any) { toast.error(error.message); }
  };
  const convert = async () => {
    if (!unitName.trim() || !unitType || !unitKind) { toast.error("Select the constructed unit name, type, and kind"); return; }
    setConverting(true);
    try {
      const response = await fetchWithAuth(`${SETUP_API}/plots/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PlotIds: selectedIds, UnitName: unitName.trim(), UnitType: unitType, UnitKind: unitKind }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not convert plots");
      toast.success(`${selectedPlots.length} plot${selectedPlots.length === 1 ? "" : "s"} converted to ${unitName.trim()} in Unit Master`);
      setSelectedIds([]); setConvertOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
      await queryClient.invalidateQueries({ queryKey: ["unit-master"] });
    } catch (error: any) { toast.error(error.message); } finally { setConverting(false); }
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "CRM", path: "/crm/dashboard" }, { label: "Setup", path: "/crm/setup/auto-project-setup" }, { label: "Plot Master", path: "/crm/setup/plot-master" }]} />
      <CrmShell title="Plot Master" icon={MapIcon} action={<div className="flex items-center gap-2"><button onClick={() => navigate("/crm/setup/auto-project-setup")} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted"><MapIcon size={14} /> Configure plots</button>{rights.canEdit && <button onClick={() => { editAssetKind(); setAssetKindsOpen(true); }} className="p-2 border border-border rounded-lg hover:bg-muted" title="Manage constructed asset kinds"><Settings2 size={14} /></button>}<button onClick={() => refetch()} className="p-2 border border-border rounded-lg hover:bg-muted" title="Refresh"><RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /></button></div>}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[["Total plots", stats.total, "text-foreground"], ["Available", stats.available, "text-emerald-600"], ["Locked", stats.locked, "text-amber-600"], ["Converted", stats.converted, "text-violet-600"]].map(([label, value, color]) => <div key={String(label)} className="border border-border rounded-lg px-3 py-2.5"><p className="text-[11px] text-muted-foreground">{label}</p><p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p></div>)}
        </div>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div className="w-full sm:w-56"><label className="text-xs text-muted-foreground block mb-1">Project</label><Select value={projectId} onValueChange={(value) => { setProjectId(value); setBlockId(ALL); setSelectedIds([]); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All projects</SelectItem>{projects.map(([id, name]) => <SelectItem key={id} value={String(id)}>{name}</SelectItem>)}</SelectContent></Select></div>
          <div className="w-full sm:w-48"><label className="text-xs text-muted-foreground block mb-1">Block</label><Select value={blockId} onValueChange={(value) => { setBlockId(value); setSelectedIds([]); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All blocks</SelectItem>{blocks.map(([id, name]) => <SelectItem key={id} value={String(id)}>{name}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex-1 min-w-52"><label className="text-xs text-muted-foreground block mb-1">Search</label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Plot, survey, project..." className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm" /></div>
          <div className="flex h-9 overflow-hidden rounded-lg border border-border" role="group" aria-label="Plot view"><button onClick={() => setViewMode("map")} className={`px-2 ${viewMode === "map" ? "bg-muted text-foreground" : "text-muted-foreground"}`} title="Site grid view"><MapIcon size={15} /></button><button onClick={() => setViewMode("list")} className={`border-l border-border px-2 ${viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground"}`} title="Table view"><List size={15} /></button></div>
          {rights.canCreate && <button onClick={openCreate} className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium border border-border rounded-lg hover:bg-muted"><Plus size={14} /> Add plot</button>}
          {rights.canEdit && <button onClick={openAdjacency} disabled={!adjacencySource} className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium border border-border rounded-lg hover:bg-muted disabled:opacity-40"><Network size={14} /> Neighbours</button>}
          {rights.canCreate && <button onClick={openConversion} disabled={!selectedIds.length} className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"><ArrowRight size={14} /> Convert to Unit</button>}
        </div>
        {!selectionIsCompatible && selectedIds.length > 1 && <p className="mb-3 text-xs text-destructive">Selected plots must be in the same project and block before conversion.</p>}
        {viewMode === "map" && <div className="rounded-lg border border-border p-3"><div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" /> Available</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" /> Applied / held</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-500" /> Booked</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-500" /> Converted</span></div>{isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">Loading plots...</p> : filtered.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No plots match these filters.</p> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">{filtered.map((plot) => { const status = plotStatus(plot); const tone = plot.ConvertedUnitId ? "border-violet-500/40 bg-violet-500/5" : plot.LockBookingNo ? "border-red-500/40 bg-red-500/5" : plot.LockApplicationNo || plot.LockHoldId ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/35 bg-emerald-500/5"; return <button key={plot.Id} onClick={() => openView(plot)} className={`min-h-24 rounded-lg border p-2 text-left hover:brightness-95 ${tone}`}><span className="block truncate font-medium">{plot.PlotName}</span><span className="mt-1 block text-xs text-muted-foreground">{plot.AreaSqFt ? `${Number(plot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "Area pending"}</span><span className="mt-2 block truncate text-[11px]">{status.label}</span></button>; })}</div>}</div>}
        <div className={`${viewMode === "map" ? "hidden " : ""}border border-border rounded-lg overflow-x-auto`}>
          <table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/50 text-muted-foreground text-xs"><tr><th className="w-10 px-3 py-2 text-left"><input type="checkbox" checked={selectable.length > 0 && selectable.every((plot) => selectedIds.includes(plot.Id))} onChange={toggleAll} aria-label="Select available plots" /></th><th className="px-3 py-2 text-left font-medium">Plot</th><th className="px-3 py-2 text-left font-medium">Project / Block</th><th className="px-3 py-2 text-left font-medium">Survey</th><th className="px-3 py-2 text-right font-medium">Area</th><th className="px-3 py-2 text-right font-medium">Rate</th><th className="px-3 py-2 text-left font-medium">Attributes</th><th className="px-3 py-2 text-left font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Actions</th></tr></thead><tbody>{isLoading ? <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading plots...</td></tr> : error ? <tr><td colSpan={9} className="p-8 text-center text-destructive">Could not load Plot Master.</td></tr> : filtered.length === 0 ? <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No plots match these filters.</td></tr> : filtered.map((plot) => { const status = plotStatus(plot); const canSelect = status.label === "Available"; return <tr key={plot.Id} className="border-t border-border hover:bg-muted/30"><td className="px-3 py-2"><input type="checkbox" disabled={!canSelect} checked={selectedIds.includes(plot.Id)} onChange={() => togglePlot(plot)} aria-label={`Select ${plot.PlotName}`} /></td><td className="px-3 py-2 font-medium">{plot.PlotName}<span className="block text-[11px] text-muted-foreground">{plot.PlotNo}</span></td><td className="px-3 py-2">{plot.ProjectName}<span className="block text-[11px] text-muted-foreground">{plot.BlockName}</span></td><td className="px-3 py-2 text-muted-foreground">{plot.SurveyNo || "-"}</td><td className="px-3 py-2 text-right tabular-nums">{plot.AreaSqFt ? `${Number(plot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "-"}</td><td className="px-3 py-2 text-right tabular-nums">{plot.RatePerSqFt ? `Rs. ${Number(plot.RatePerSqFt).toLocaleString("en-IN")}` : "-"}</td><td className="px-3 py-2 text-xs text-muted-foreground">{[plot.Facing, plot.IsCornerPlot ? "Corner" : "", plot.RoadWidthFt ? `${plot.RoadWidthFt} ft road` : ""].filter(Boolean).join(" · ") || "-"}</td><td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${status.cls}`}>{status.label}</span></td><td className="px-3 py-2"><div className="flex justify-end gap-1"><button onClick={() => openView(plot)} className="p-1.5 rounded hover:bg-muted" title="View plot"><Eye size={15} /></button>{rights.canEdit && <button onClick={() => openEdit(plot)} disabled={!canSelect} className="p-1.5 rounded hover:bg-muted disabled:opacity-35" title={canSelect ? "Edit plot" : "Only available plots can be edited"}><Pencil size={15} /></button>}{rights.canDelete && <button onClick={() => deletePlot(plot)} disabled={!canSelect} className="p-1.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-35" title={canSelect ? "Delete plot" : "Only available plots can be deleted"}><Trash2 size={15} /></button>}</div></td></tr>; })}</tbody></table>
        </div>
      </CrmShell>
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}><DialogContent accent="crm" className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 size={17} className="text-emerald-600" /> Convert plots to Unit Master</DialogTitle></DialogHeader><div className="space-y-3"><div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"><p className="font-medium">{selectedPlots.map((plot) => plot.PlotName).join(", ")}</p><p className="mt-1 text-xs text-muted-foreground">{selectedPlots[0]?.ProjectName} · {selectedPlots[0]?.BlockName} · {totalArea.toLocaleString("en-IN")} sq ft combined area</p></div><div><label className="text-xs text-muted-foreground block mb-1">Constructed unit name</label><input autoFocus value={unitName} onChange={(event) => setUnitName(event.target.value)} className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm" /></div><div><label className="text-xs text-muted-foreground block mb-1">Unit type</label><Select value={unitType || undefined} onValueChange={setUnitType}><SelectTrigger><SelectValue placeholder="Select a configured unit type" /></SelectTrigger><SelectContent>{unitTypeOptionsForConversion.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div><label className="text-xs text-muted-foreground block mb-1">Constructed asset kind</label><Select value={unitKind || undefined} onValueChange={setUnitKind}><SelectTrigger><SelectValue placeholder="Select a configured asset kind" /></SelectTrigger><SelectContent>{constructedAssetKinds.map((kind) => <SelectItem key={kind.Id} value={kind.Code}>{kind.Name}</SelectItem>)}</SelectContent></Select></div><p className="text-xs text-muted-foreground flex gap-1.5"><Lock size={13} className="shrink-0" /> The source plots remain in Plot Master as converted history and can no longer be booked or edited as plots.</p><div className="flex justify-end gap-2 pt-1"><button onClick={() => setConvertOpen(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Cancel</button><button onClick={convert} disabled={converting || !unitName.trim() || !unitType || !unitKind} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40">{converting ? "Converting..." : "Create Unit Master record"}</button></div></div></DialogContent></Dialog>
      <Dialog open={adjacencyOpen} onOpenChange={setAdjacencyOpen}><DialogContent accent="crm" className="max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><Network size={17} className="text-primary" /> Plot neighbours</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm"><span className="font-medium">{adjacencySource?.PlotName}</span><span className="text-muted-foreground"> can be combined only with the selected neighbouring plots.</span></p><div className="max-h-72 overflow-y-auto divide-y divide-border rounded-lg border border-border">{adjacencyCandidates.length ? adjacencyCandidates.map((plot) => <label key={plot.Id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40"><input type="checkbox" checked={adjacentIds.includes(plot.Id)} onChange={() => setAdjacentIds((ids) => ids.includes(plot.Id) ? ids.filter((id) => id !== plot.Id) : [...ids, plot.Id])} /><span className="font-medium">{plot.PlotName}</span><span className="ml-auto text-xs text-muted-foreground">{plot.AreaSqFt ? `${Number(plot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "Area not set"}</span></label>) : <p className="p-4 text-sm text-muted-foreground">No eligible plots in this block.</p>}</div><div className="flex justify-end gap-2"><button onClick={() => setAdjacencyOpen(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Cancel</button><button onClick={saveAdjacency} disabled={savingAdjacency} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">{savingAdjacency ? "Saving..." : "Save neighbours"}</button></div></div></DialogContent></Dialog>
      <Dialog open={assetKindsOpen} onOpenChange={setAssetKindsOpen}><DialogContent accent="crm" className="max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 size={17} className="text-primary" /> Constructed asset kinds</DialogTitle></DialogHeader><div className="grid gap-4 md:grid-cols-[1fr_280px]"><div className="max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border">{managedAssetKinds.map((kind) => <button key={kind.Id} onClick={() => editAssetKind(kind)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"><span className="font-medium">{kind.Name}</span><span className="text-xs text-muted-foreground">{kind.Code}</span><span className="ml-auto text-xs text-muted-foreground">{kind.IsActive === false ? "Inactive" : "Active"}</span></button>)}</div><div className="space-y-3"><div><label className="mb-1 block text-xs text-muted-foreground">Name</label><input value={assetKindDraft.Name} onChange={(event) => setAssetKindDraft((draft) => ({ ...draft, Name: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div><div><label className="mb-1 block text-xs text-muted-foreground">Code</label><input value={assetKindDraft.Code} onChange={(event) => setAssetKindDraft((draft) => ({ ...draft, Code: event.target.value.toUpperCase() }))} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div><div><label className="mb-1 block text-xs text-muted-foreground">Sort order</label><input type="number" min="0" max="9999" value={assetKindDraft.SortOrder} onChange={(event) => setAssetKindDraft((draft) => ({ ...draft, SortOrder: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div>{assetKindDraft.Id > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={assetKindDraft.IsActive} onChange={(event) => setAssetKindDraft((draft) => ({ ...draft, IsActive: event.target.checked }))} /> Active</label>}<div className="flex justify-end gap-2"><button onClick={() => editAssetKind()} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">New</button><button onClick={saveAssetKind} disabled={savingAssetKind || !assetKindDraft.Name.trim() || !assetKindDraft.Code.trim()} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">{savingAssetKind ? "Saving..." : "Save"}</button></div></div></div></DialogContent></Dialog>
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}><DialogContent accent="crm" className="max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Eye size={17} className="text-primary" /> {detailPlot?.PlotName || "Plot details"}</DialogTitle></DialogHeader>{detailPlot && <div className="space-y-4 text-sm"><div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-3"><div><p className="text-xs text-muted-foreground">Project / Block</p><p>{detailPlot.ProjectName} / {detailPlot.BlockName}</p></div><div><p className="text-xs text-muted-foreground">Status</p><p>{plotStatus(detailPlot).label}</p></div><div><p className="text-xs text-muted-foreground">Plot number</p><p>{detailPlot.PlotNo}</p></div><div><p className="text-xs text-muted-foreground">Survey number</p><p>{detailPlot.SurveyNo || "-"}</p></div></div><div className="grid grid-cols-2 gap-x-6 gap-y-3"><div><p className="text-xs text-muted-foreground">Area</p><p>{detailPlot.AreaSqFt ? `${Number(detailPlot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "-"}</p></div><div><p className="text-xs text-muted-foreground">Rate</p><p>{detailPlot.RatePerSqFt ? `Rs. ${Number(detailPlot.RatePerSqFt).toLocaleString("en-IN")} / sq ft` : "-"}</p></div><div><p className="text-xs text-muted-foreground">Dimensions</p><p>{detailPlot.PlotWidthFt || "-"} ft x {detailPlot.PlotDepthFt || "-"} ft</p></div><div><p className="text-xs text-muted-foreground">Facing / road</p><p>{detailPlot.Facing || "-"}{detailPlot.RoadWidthFt ? ` / ${detailPlot.RoadWidthFt} ft` : ""}</p></div><div><p className="text-xs text-muted-foreground">Guideline rate</p><p>{detailPlot.GuidelineRatePerSqFt ? `Rs. ${Number(detailPlot.GuidelineRatePerSqFt).toLocaleString("en-IN")}` : "-"}</p></div><div><p className="text-xs text-muted-foreground">Neighbours</p><p>{detailPlot.AdjacentPlotCount || 0}</p></div></div>{detailPlot.ConvertedUnitId && <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3"><p className="text-xs text-muted-foreground">Converted Unit Master record</p><p className="font-medium">{detailPlot.ConvertedUnitName || `Unit #${detailPlot.ConvertedUnitId}`}</p></div>}<div className="flex justify-end gap-2"><button onClick={() => setDetailOpen(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Close</button>{rights.canEdit && plotStatus(detailPlot).label === "Available" && <button onClick={() => { setDetailOpen(false); openEdit(detailPlot); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90"><Pencil size={13} /> Edit</button>}</div></div>}</DialogContent></Dialog>
      <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent accent="crm" className="max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil size={17} className="text-primary" /> Edit plot</DialogTitle></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-xs text-muted-foreground">Plot number</label><input value={plotDraft.PlotNo || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, PlotNo: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div><div><label className="mb-1 block text-xs text-muted-foreground">Plot name</label><input value={plotDraft.PlotName || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, PlotName: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div><div><label className="mb-1 block text-xs text-muted-foreground">Survey number</label><input value={plotDraft.SurveyNo || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, SurveyNo: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div><div><label className="mb-1 block text-xs text-muted-foreground">Facing</label><input value={plotDraft.Facing || ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, Facing: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div>{[["AreaSqFt", "Area (sq ft)"], ["RatePerSqFt", "Rate per sq ft"], ["PlotWidthFt", "Width (ft)"], ["PlotDepthFt", "Depth (ft)"], ["RoadWidthFt", "Road width (ft)"], ["GuidelineRatePerSqFt", "Guideline rate / sq ft"]].map(([field, label]) => <div key={field}><label className="mb-1 block text-xs text-muted-foreground">{label}</label><input type="number" min="0" step="0.01" value={plotDraft[field] ?? ""} onChange={(event) => setPlotDraft((draft) => ({ ...draft, [field]: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div>)}<label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={plotDraft.IsCornerPlot === true} onChange={(event) => setPlotDraft((draft) => ({ ...draft, IsCornerPlot: event.target.checked }))} /> Corner plot</label></div><div className="flex justify-end gap-2 pt-4"><button onClick={() => setEditOpen(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Cancel</button><button onClick={savePlot} disabled={savingPlot || !plotDraft.PlotNo?.trim() || !plotDraft.PlotName?.trim()} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">{savingPlot ? "Saving..." : "Save changes"}</button></div></DialogContent></Dialog>
    </>
  );
};

export default CrmPlotMaster;
