import { useSheetAsk } from "@/components/sheet/SheetAsk";
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, List, Map as MapIcon, Network, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { getLayoutTypes, LAYOUT_TYPES_QUERY_KEY, type LayoutType } from "@/api/unitBhkConfigApi";
import { PlotLayoutEditor, naturalCompare, plotOrder } from "./PlotLayoutEditor";
import { VillaTypesDialog } from "./VillaTypesDialog";
import { FacingsDialog } from "./plotMaster/FacingsDialog";
import { ConvertDialog } from "./plotMaster/ConvertDialog";
import { PlotDetailDialog } from "./plotMaster/PlotDetailDialog";
import { PlotEditDialog } from "./plotMaster/PlotEditDialog";
import {
  ALL, INP, KEY_INK, KEY_LINE, LBL, NUM, PLOT_API, RULE, RULE_SOFT, TEXT_LINK,
  canConvert, fetchFacings, fetchPlotBlocks, fetchPlots, plotStatus, rupees, type Plot, type PlotBlock,
} from "./plotMaster/config";

const CrmPlotMaster: React.FC = () => {
  const ask = useSheetAsk();
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
  const [villaTypesOpen, setVillaTypesOpen] = useState(false);
  const [layoutState, setLayoutState] = useState<{ blockId: number; mode: "arrange" | "neighbours"; focusId: number | null } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [facingsOpen, setFacingsOpen] = useState(false);
  const [detailPlot, setDetailPlot] = useState<Plot | null>(null);
  const [plotDraft, setPlotDraft] = useState<Record<string, any>>({});
  const [savingPlot, setSavingPlot] = useState(false);
  const [creatingPlot, setCreatingPlot] = useState(false);

  const { data: plots = [], isLoading, error, refetch, isFetching } = useQuery({ queryKey: ["plot-master"], queryFn: fetchPlots, staleTime: 30_000 });
  const { data: planBlocks = [] } = useQuery<PlotBlock[]>({ queryKey: ["plot-blocks"], queryFn: fetchPlotBlocks, staleTime: 60_000 });
  // Active facings feed the edit dropdown; the manage dialog asks for all.
  const { data: facings = [], isError: facingsFailed } = useQuery({ queryKey: ["plot-facings"], queryFn: () => fetchFacings(false), staleTime: 5 * 60_000 });
  const { data: layoutTypes = [] } = useQuery<LayoutType[]>({ queryKey: LAYOUT_TYPES_QUERY_KEY, queryFn: getLayoutTypes, staleTime: 60_000 });
  const facingName = (code?: string | null) => (code ? facings.find((f) => f.Code === code)?.Name ?? code : "");

  // Blocks come from the server (so a block with no plots yet can still be picked) and are topped up from the plots
  // themselves in case that call fails.
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
  // Only plots still visible count as selected: a plot ticked and then filtered out used to be converted unseen.
  const selectedPlots = useMemo(() => filtered.filter((plot) => selectedIds.includes(plot.Id) && canConvert(plot)), [filtered, selectedIds]);
  const selectionIsCompatible = selectedPlots.length > 0 && selectedPlots.every((plot) => plot.ProjectId === selectedPlots[0].ProjectId && plot.BlockId === selectedPlots[0].BlockId);
  const totalArea = selectedPlots.reduce((total, plot) => total + Number(plot.AreaSqFt || 0), 0);
  // Counts follow the project/block filter and always add up: a converted plot with an old booking used to be counted
  // as both locked and converted.
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
    setConvertOpen(true);
  };

  // Layout editor target: the block being viewed, or the block of the selected plots.
  const toolbarLayoutBlock = blockId !== ALL ? Number(blockId) : selectedPlots.length > 0 && selectedPlots.every((plot) => plot.BlockId === selectedPlots[0].BlockId) ? selectedPlots[0].BlockId : null;
  const openLayout = (targetBlockId: number, mode: "arrange" | "neighbours" = "arrange", focusId: number | null = null) => setLayoutState({ blockId: targetBlockId, mode, focusId });
  const layoutBlockInfo = layoutState ? blockCatalog.find((block) => block.BlockId === layoutState.blockId) : undefined;

  // The open plot follows the list when it refreshes.
  React.useEffect(() => {
    if (!detailPlot) return;
    const fresh = (plots as Plot[]).find((p) => p.Id === detailPlot.Id);
    if (fresh && fresh !== detailPlot) setDetailPlot((d) => (d ? { ...d, ...fresh } : fresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plots]);

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
      toast.success(creatingPlot ? "Plot created — place it on the layout" : "Plot updated");
      setEditOpen(false); setCreatingPlot(false);
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] }); await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
    } catch (e: any) { toast.error(e.message); } finally { setSavingPlot(false); }
  };
  const deletePlot = async (plot: Plot) => {
    if (!(await ask.confirm(`Delete ${plot.PlotName}? This cannot be undone.`, { okLabel: "Delete", danger: true }))) return;
    try {
      const response = await fetchWithAuth(`${PLOT_API}/${plot.Id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not delete plot");
      toast.success("Plot deleted"); setSelectedIds((ids) => ids.filter((id) => id !== plot.Id));
      await queryClient.invalidateQueries({ queryKey: ["plot-master"] }); await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
    } catch (e: any) { toast.error(e.message); }
  };

  const renderCard = (plot: Plot, style?: React.CSSProperties) => {
    const status = plotStatus(plot);
    const checked = selectedIds.includes(plot.Id);
    const dimmed = searching && !matchIds.has(plot.Id);
    return (
      <div
        key={plot.Id} role="button" tabIndex={0}
        style={{ ...style, boxShadow: checked ? "inset 0 0 0 2px hsl(var(--foreground))" : status.kind === "booked" ? "inset 3px 0 0 hsl(var(--destructive))" : undefined }}
        onClick={() => openView(plot)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openView(plot); } }}
        className={`relative flex h-[92px] min-w-0 cursor-pointer flex-col justify-between border p-2 text-left outline-none transition-colors focus-visible:border-foreground ${checked ? "border-foreground bg-primary/10" : status.kind === "converted" ? "border-foreground/30 bg-primary/5 hover:border-foreground" : "border-foreground/30 bg-card hover:border-foreground"} ${dimmed ? "opacity-30" : ""}`}
      >
        <div className="flex items-start justify-between gap-1">
          <span className={`truncate text-sm font-semibold ${NUM}`}>{plot.PlotName}</span>
          {rights.canCreate && canConvert(plot) && (
            <input type="checkbox" checked={checked} onClick={(event) => event.stopPropagation()} onChange={() => togglePlot(plot)} aria-label={`Select ${plot.PlotName}`} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-foreground" />
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <span className="block truncate text-xs text-muted-foreground">
            {plot.AreaSqFt ? <><span className={NUM}>{Number(plot.AreaSqFt).toLocaleString("en-IN")}</span> sq ft</> : "Area pending"}{plot.IsCornerPlot ? " · Corner" : ""}{plot.Facing ? ` · ${plot.Facing}` : ""}
            {/* Built: the villa's own type. Not yet built: the type planned on it. */}
            {plot.ConvertedUnitId
              ? (plot.ConvertedVillaTypeCode ? ` · ${plot.ConvertedVillaTypeCode}` : " · type not set")
              : plot.PlannedVillaTypeCode ? ` · plans ${plot.PlannedVillaTypeCode}` : ""}
          </span>
          <span className="block truncate" title={plot.ConvertedUnitName || status.label}>
            <SheetMark text={plot.ConvertedUnitId ? `${status.label} · ${(plot.ConvertedUnitName || "").split("/").pop()}` : status.label} tone={status.tone} />
          </span>
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
      <section key={block.BlockId} className="bg-card" style={{ border: RULE }}>
        <header className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" style={{ borderBottom: RULE }}>
          <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{block.ProjectName} · Block {block.BlockName}</h3>
          <span className="text-xs text-muted-foreground"><span className={NUM}>{blockPlots.length}</span> plot{blockPlots.length === 1 ? "" : "s"}{placed.length ? "" : " · no layout yet, shown in order"}</span>
          {rights.canEdit && (
            <button onClick={() => openLayout(block.BlockId)} className={`${KEY_LINE} h-8 px-3 ml-auto`}><Network size={12} /> Layout &amp; neighbours</button>
          )}
        </header>
        <div className="p-3">
          {blockPlots.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No plots in this block yet.</p>
          ) : placed.length > 0 ? (
            <div className="overflow-x-auto thin-scroll">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(128px, 1fr))`, gridTemplateRows: `repeat(${gridRows}, 92px)` }}>
                {placed.map((plot) => renderCard(plot, { gridRow: (plot.GridRow as number) + 1, gridColumn: (plot.GridCol as number) + 1 }))}
              </div>
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(144px, 1fr))" }}>{blockPlots.map((plot) => renderCard(plot))}</div>
          )}
          {placed.length > 0 && unplaced.length > 0 && (
            <div className="mt-3 pt-3 border-t border-dashed border-foreground/30">
              <p className={`mb-2 ${LBL}`}>Not placed on the layout yet · <span className={NUM}>{unplaced.length}</span></p>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(144px, 1fr))" }}>{unplaced.map((plot) => renderCard(plot))}</div>
            </div>
          )}
        </div>
      </section>
    );
  };

  const figures = [
    { label: "Plots", value: stats.total, note: "in these projects / blocks" },
    { label: "Available", value: stats.available, note: "free to sell or build on" },
    { label: "Locked", value: stats.locked, note: "booked, applied for or on hold" },
    { label: "Converted", value: stats.converted, note: "villas built on them" },
  ];
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3";
  const loadError = error ? <p className="p-6 text-center text-sm text-destructive">{(error as Error)?.message || "Could not load Plot Master."}</p> : null;

  return (
    <>
      {ask.node}
      <Breadcrumbs items={[{ label: "CRM", path: "/crm/dashboard" }, { label: "Setup", path: "/crm/setup/auto-project-setup" }, { label: "Plot Master", path: "/crm/setup/plot-master" }]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Plot Master"
        subtitle="The land inventory: every plot on its block's site layout, where it stands, and the villas built on plots."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            <button onClick={() => navigate("/crm/setup/auto-project-setup")} className={`${KEY_LINE} h-9 px-3`}>Configure plots</button>
            {(rights.canCreate || rights.canEdit || rights.canDelete) && <button onClick={() => setFacingsOpen(true)} className={`${KEY_LINE} h-9 px-3`}>Facings</button>}
            <button onClick={() => setVillaTypesOpen(true)} className={`${KEY_LINE} h-9 px-3`}>Villa types</button>
            {rights.canCreate && <button onClick={openCreate} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Add plot</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card px-4 py-3.5 space-y-3" style={{ border: RULE }}>
            <div className="flex flex-wrap gap-2.5 items-end">
              <label className="block space-y-1 w-full sm:w-56">
                <span className={`block ${LBL}`}>Project</span>
                <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setBlockId(ALL); setSelectedIds([]); }} className={INP}>
                  <option value={ALL}>All projects</option>
                  {projects.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
                </select>
              </label>
              <label className="block space-y-1 w-full sm:w-44">
                <span className={`block ${LBL}`}>Block</span>
                <select value={blockId} onChange={(e) => { setBlockId(e.target.value); setSelectedIds([]); }} className={INP}>
                  <option value={ALL}>All blocks</option>
                  {blocks.map((block) => <option key={block.BlockId} value={String(block.BlockId)}>{block.BlockName}</option>)}
                </select>
              </label>
              <label className="block space-y-1 flex-1 min-w-52">
                <span className={`block ${LBL}`}>Search</span>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Plot, survey, project…" className={INP} />
              </label>
              <div className="seg" role="group" aria-label="Plot view">
                <button className={viewMode === "map" ? "on" : ""} onClick={() => setViewMode("map")} title="Site layout view"><span className="inline-flex items-center gap-1.5"><MapIcon size={12} /> Layout</span></button>
                <button className={viewMode === "list" ? "on" : ""} onClick={() => setViewMode("list")} title="Table view"><span className="inline-flex items-center gap-1.5"><List size={12} /> Table</span></button>
              </div>
              {rights.canEdit && (
                <button onClick={() => toolbarLayoutBlock != null && openLayout(toolbarLayoutBlock)} disabled={toolbarLayoutBlock == null}
                  title={toolbarLayoutBlock == null ? "Pick a block (or select plots from one block) to edit its layout" : "Arrange plots and set neighbours"}
                  className={`${KEY_LINE} h-9 px-3`}><Network size={13} /> Layout &amp; neighbours</button>
              )}
              {rights.canCreate && (
                <button onClick={openConversion} disabled={!selectedPlots.length} title={selectedPlots.length ? "Convert the selected plots" : "Tick one or more available plots first"}
                  className={`${KEY_INK} h-9 px-4`}><ArrowRight size={13} /> Build villas</button>
              )}
            </div>
            {selectedPlots.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs bg-primary/5" style={{ border: RULE, boxShadow: "inset 3px 0 0 hsl(var(--foreground))" }}>
                <span className="font-semibold"><span className={NUM}>{selectedPlots.length}</span> plot{selectedPlots.length === 1 ? "" : "s"} selected</span>
                <span className="text-muted-foreground"><span className={NUM}>{totalArea.toLocaleString("en-IN")}</span> sq ft combined</span>
                {!selectionIsCompatible && selectedPlots.length > 1 && <span className="text-destructive">Plots must be in the same project and block to convert.</span>}
                <button onClick={() => setSelectedIds([])} className={`${TEXT_LINK} ml-auto inline-flex items-center gap-1`}><X size={11} /> Clear selection</button>
              </div>
            )}
          </div>

          {viewMode === "map" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <SheetMark text="Available" tone="done" />
                <SheetMark text="Applied / held" tone="waiting" />
                <SheetMark text="Booked" tone="stopped" />
                <SheetMark text="Converted" tone="moving" />
              </div>
              {isLoading ? <p className="bg-card p-8 text-center text-sm text-muted-foreground" style={{ border: RULE_SOFT }}>Loading plots…</p>
                : error ? <div className="bg-card" style={{ border: RULE }}>{loadError}</div>
                : blockSections.length === 0 ? <p className="bg-card p-8 text-center text-sm text-muted-foreground" style={{ border: RULE_SOFT }}>No plots match these filters.</p>
                : blockSections.map(renderSection)}
            </div>
          )}

          {viewMode === "list" && (
            <div className="bg-card overflow-x-auto thin-scroll" style={{ border: RULE }}>
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={`${th} w-10`}>
                      {rights.canCreate && <input type="checkbox" className="h-3.5 w-3.5 accent-foreground" checked={selectable.length > 0 && selectable.every((plot) => selectedIds.includes(plot.Id))} onChange={toggleAll} aria-label="Select available plots" />}
                    </th>
                    <th className={th}>Plot</th><th className={th}>Project · block</th><th className={th}>Survey</th>
                    <th className={`${th} !text-right`}>Area</th><th className={`${th} !text-right`}>Rate</th>
                    <th className={th}>Attributes</th><th className={th}>State</th><th className={`${th} !text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? <tr><td colSpan={9} className={`${td} text-center text-muted-foreground`}>Loading plots…</td></tr>
                    : error ? <tr><td colSpan={9}>{loadError}</td></tr>
                    : filtered.length === 0 ? <tr><td colSpan={9} className={`${td} text-center text-muted-foreground`}>No plots match these filters.</td></tr>
                    : filtered.map((plot) => {
                      const status = plotStatus(plot);
                      const available = status.kind === "available";
                      return (
                        <tr key={plot.Id} className="align-top hover:bg-primary/5 transition-colors" style={{ borderBottom: RULE_SOFT }}>
                          <td className={td}>
                            {rights.canCreate && <input type="checkbox" className="h-3.5 w-3.5 accent-foreground" disabled={!canConvert(plot)} checked={selectedIds.includes(plot.Id)} onChange={() => togglePlot(plot)} aria-label={`Select ${plot.PlotName}`} />}
                          </td>
                          <td className={td}><div className={`text-xs font-semibold ${NUM}`}>{plot.PlotName}</div><div className="mt-1 text-[0.6875rem] text-muted-foreground">{plot.PlotNo}</div></td>
                          <td className={td}><div className="text-xs">{plot.ProjectName}</div><div className="mt-1 text-[0.6875rem] text-muted-foreground">Block {plot.BlockName}</div></td>
                          <td className={`${td} text-xs text-muted-foreground`}>{plot.SurveyNo || "—"}</td>
                          <td className={`${td} text-right ${NUM}`}>{plot.AreaSqFt ? `${Number(plot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "—"}</td>
                          <td className={`${td} text-right ${NUM}`}>{rupees(plot.RatePerSqFt)}</td>
                          <td className={`${td} text-xs text-muted-foreground`}>{[facingName(plot.Facing), plot.IsCornerPlot ? "Corner" : "", plot.RoadWidthFt ? `${plot.RoadWidthFt} ft road` : "", plot.PlannedVillaTypeName ? `Plans ${plot.PlannedVillaTypeName}` : ""].filter(Boolean).join(" · ") || "—"}</td>
                          <td className={td}><SheetMark text={status.label} tone={status.tone} /></td>
                          <td className={td}>
                            <div className="flex justify-end gap-1">
                              <button onClick={() => openView(plot)} className="w-7 h-7 inline-flex items-center justify-center border border-transparent hover:border-foreground" title="View plot"><Eye size={14} /></button>
                              {rights.canEdit && <button onClick={() => openEdit(plot)} disabled={!available} className="w-7 h-7 inline-flex items-center justify-center border border-transparent hover:border-foreground disabled:opacity-35" title={available ? "Edit plot" : "Only available plots can be edited"}><Pencil size={14} /></button>}
                              {rights.canDelete && <button onClick={() => deletePlot(plot)} disabled={!available} className="w-7 h-7 inline-flex items-center justify-center border border-transparent text-destructive hover:border-destructive disabled:opacity-35" title={available ? "Delete plot" : "Only available plots can be deleted"}><Trash2 size={14} /></button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SheetShell>

      <FacingsDialog open={facingsOpen} onOpenChange={setFacingsOpen} canCreate={rights.canCreate} canEdit={rights.canEdit} canDelete={rights.canDelete} />

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

      <ConvertDialog open={convertOpen} onOpenChange={setConvertOpen} plots={selectedPlots} layoutTypes={layoutTypes}
        canManageTypes={rights.canEdit} onManageTypes={() => setVillaTypesOpen(true)} onDone={(keepIds) => setSelectedIds(keepIds)} />

      <VillaTypesDialog
        open={villaTypesOpen} onOpenChange={setVillaTypesOpen}
        projects={Array.from(new Map(blockCatalog.map((block) => [block.ProjectId, { ProjectId: block.ProjectId, ProjectName: block.ProjectName }])).values())}
        initialProjectId={projectId !== ALL ? Number(projectId) : null}
        layoutTypes={layoutTypes}
        selectedPlotIds={selectedPlots.length > 0 && selectedPlots.every((plot) => plot.ProjectId === selectedPlots[0].ProjectId) ? selectedPlots.map((plot) => plot.Id) : []}
        selectedProjectId={selectedPlots[0]?.ProjectId ?? null}
        onPlotsChanged={() => queryClient.invalidateQueries({ queryKey: ["plot-master"] })}
        canCreate={rights.canCreate} canEdit={rights.canEdit} canDelete={rights.canDelete}
      />

      <PlotDetailDialog plot={detailPlot} open={detailOpen} onOpenChange={setDetailOpen}
        canEdit={rights.canEdit} canDelete={rights.canDelete} confirm={ask.confirm} facingName={facingName}
        onPlotChange={(patch) => setDetailPlot((p) => (p ? { ...p, ...patch } : p))}
        onEdit={(plot) => { setDetailOpen(false); openEdit(plot); }}
        onNeighbours={(plot) => { setDetailOpen(false); openLayout(plot.BlockId, "neighbours", plot.Id); }} />

      <PlotEditDialog open={editOpen} onOpenChange={closeEdit} creating={creatingPlot} draft={plotDraft} setDraft={setPlotDraft}
        projects={projects} blockCatalog={blockCatalog} facings={facings} facingsFailed={facingsFailed}
        canManageFacings={rights.canCreate || rights.canEdit} onManageFacings={() => setFacingsOpen(true)}
        saving={savingPlot} onSave={savePlot} />
    </>
  );
};

export default CrmPlotMaster;
