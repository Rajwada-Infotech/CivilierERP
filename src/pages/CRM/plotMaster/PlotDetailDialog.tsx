// One plot: its facts, and — once a villa is built on it — the villa: rename it, set or change its villa type (rooms
// re-cut from the type's floor plan), add rooms its plan has and it lacks, or undo the conversion.
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Network, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SheetMark } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fetchVillaTypes, villaTypesKey } from "../VillaTypesDialog";
import {
  DIALOG, DIALOG_STYLE, DialogHead, Fact, HEAD, INP, KEY_INK, KEY_LINE, LBL, NUM, RULE, RULE_SOFT, SETUP_API, TEXT_LINK,
  plotStatus, rupees, sqft, type Plot,
} from "./config";

type Confirm = (message: string, opts?: { okLabel?: string; danger?: boolean }) => Promise<boolean>;

export const PlotDetailDialog: React.FC<{
  plot: Plot | null; open: boolean; onOpenChange: (open: boolean) => void;
  canEdit: boolean; canDelete: boolean; confirm: Confirm;
  facingName: (code?: string | null) => string;
  onPlotChange: (patch: Partial<Plot>) => void;
  onEdit: (plot: Plot) => void; onNeighbours: (plot: Plot) => void;
}> = ({ plot, open, onOpenChange, canEdit, canDelete, confirm, facingName, onPlotChange, onEdit, onNeighbours }) => {
  const queryClient = useQueryClient();
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [builtVillaType, setBuiltVillaType] = useState("");
  const [settingVillaType, setSettingVillaType] = useState(false);
  const [changingType, setChangingType] = useState(false);
  // Take the chosen type's areas too (unsold villas only — checked on the server).
  const [takeAreas, setTakeAreas] = useState(true);
  const [addingRooms, setAddingRooms] = useState(false);
  useEffect(() => { setRenameTo(null); setBuiltVillaType(""); setChangingType(false); }, [plot?.Id]);

  const { data: villaTypes = [] } = useQuery({
    queryKey: [...villaTypesKey(plot?.ProjectId), "active"],
    queryFn: () => fetchVillaTypes(plot!.ProjectId),
    enabled: open && !!plot?.ConvertedUnitId && plot?.ProjectId != null,
  });
  const refresh = async (units = false) => {
    await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
    if (units) await queryClient.invalidateQueries({ queryKey: ["unit-master"] });
  };

  // Rename a built villa (its DPR chains and live sales follow the new name).
  const renameVilla = async (p: Plot) => {
    if (!p.ConvertedUnitId || !renameTo?.trim()) return;
    setRenaming(true);
    try {
      const response = await fetchWithAuth(`${SETUP_API}/villas/${p.ConvertedUnitId}/rename`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ UnitName: renameTo.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not rename the villa");
      const extra = [body.chainsRenamed ? `${body.chainsRenamed} DPR chain(s)` : "", body.bookingsUpdated ? `${body.bookingsUpdated} booking(s)` : "", body.applicationsUpdated ? `${body.applicationsUpdated} application(s)` : ""].filter(Boolean).join(", ");
      toast.success(`Renamed to ${body.UnitName}${extra ? ` — ${extra} updated` : ""}`);
      setRenameTo(null);
      onPlotChange({ ConvertedUnitName: body.UnitName });
      await refresh(true);
    } catch (e: any) { toast.error(e.message); } finally { setRenaming(false); }
  };

  const setVillaTypeOnBuilt = async (p: Plot) => {
    if (!p.ConvertedUnitId || !builtVillaType) return;
    const type = villaTypes.find((t) => String(t.Id) === builtVillaType);
    if (!(await confirm(`Set ${p.ConvertedUnitName || "this villa"} to ${type?.Code} — ${type?.Name}? Its rooms are rebuilt floor by floor from the type's plan.`, { okLabel: "Go ahead" }))) return;
    setSettingVillaType(true);
    try {
      const response = await fetchWithAuth(`${SETUP_API}/villas/${p.ConvertedUnitId}/villa-type`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ VillaTypeId: Number(builtVillaType), TakeAreas: takeAreas }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not set the villa type");
      const missing = body.roomsWithoutSteps?.length ? ` · ${body.roomsWithoutSteps.length} room(s) have no DPR steps yet — set those room types in Dependency Master` : "";
      toast.success(`${type?.Code} applied: ${body.rooms} rooms${body.areasTaken ? ", areas updated" : ""}${missing}`);
      setBuiltVillaType(""); setChangingType(false);
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["villa-types"] });
    } catch (e: any) { toast.error(e.message); } finally { setSettingVillaType(false); }
  };

  // Adds the rooms its type's floor plan has and this villa lacks. Existing rooms and their DPR work are never
  // touched; the server refuses if any would change.
  const addMissingRooms = async (p: Plot) => {
    if (!p.ConvertedUnitId) return;
    setAddingRooms(true);
    try {
      const url = `${SETUP_API}/villas/${p.ConvertedUnitId}/add-missing-rooms`;
      const preview = await fetchWithAuth(`${url}?dryRun=1`, { method: "POST" });
      const pb = await preview.json().catch(() => ({}));
      if (!preview.ok) throw new Error(pb.error || "Could not check the plan");
      if (!pb.added) { toast.info(pb.message); return; }
      const steps = pb.withoutSteps?.length ? `\n\n${pb.withoutSteps.length} of them have no DPR step list yet (${pb.withoutSteps.slice(0, 6).join(", ")}${pb.withoutSteps.length > 6 ? "…" : ""}) — they get steps once their room type has one.` : "";
      if (!(await confirm(`Add ${pb.added} room(s) from the ${p.ConvertedVillaTypeCode} floor plan to ${p.ConvertedUnitName}?\nExisting rooms and their DPR work stay exactly as they are.${steps}`, { okLabel: "Go ahead" }))) return;
      const response = await fetchWithAuth(url, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not add the rooms");
      toast.success(body.message);
      await refresh();
    } catch (e: any) { toast.error(e.message); } finally { setAddingRooms(false); }
  };

  // Reverses a conversion made by mistake. The server refuses once the villa is booked or held, or any DPR work has
  // started; nothing is deleted.
  const undoConversion = async (p: Plot) => {
    if (!p.ConvertedUnitId) return;
    if (!(await confirm(`Undo the conversion of ${p.PlotName}? The villa ${p.ConvertedUnitName || ""} and its untouched DPR steps are retired and the plot can be converted again.`, { okLabel: "Undo conversion", danger: true }))) return;
    try {
      const response = await fetchWithAuth(`${SETUP_API}/plots/unconvert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ UnitId: p.ConvertedUnitId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.message || "Could not undo the conversion");
      toast.success(body.message || "Conversion undone");
      onOpenChange(false);
      await refresh(true);
    } catch (e: any) { toast.error(e.message); }
  };

  const status = plot ? plotStatus(plot) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-xl ${DIALOG}`} style={DIALOG_STYLE}>
        <DialogHead Title={DialogTitle} eyebrow={plot ? `${plot.ProjectName} · Block ${plot.BlockName}` : "Plot Master"}
          title={<span className="flex flex-wrap items-center gap-3">{plot?.PlotName || "Plot details"}{status && <SheetMark text={status.label} tone={status.tone} />}</span>} />
        {plot && (
          <div className="space-y-4 text-sm max-h-[65vh] overflow-y-auto thin-scroll -mr-2 pr-2">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Fact label="Plot number" num>{plot.PlotNo}</Fact>
              <Fact label="Survey number">{plot.SurveyNo || "—"}</Fact>
              <Fact label="Area" num>{sqft(plot.AreaSqFt)}</Fact>
              <Fact label="Rate" num>{plot.RatePerSqFt ? `${rupees(plot.RatePerSqFt)} / sq ft` : "—"}</Fact>
              <Fact label="Dimensions" num>{plot.PlotWidthFt || "—"} ft × {plot.PlotDepthFt || "—"} ft</Fact>
              <Fact label="Facing · road">{facingName(plot.Facing) || "—"}{plot.RoadWidthFt ? <> · <span className={NUM}>{plot.RoadWidthFt}</span> ft</> : ""}</Fact>
              <Fact label="Guideline rate" num>{rupees(plot.GuidelineRatePerSqFt)}</Fact>
              <Fact label="Neighbours" num>{plot.AdjacentPlotCount || 0}</Fact>
              {plot.IsCornerPlot && <Fact label="Corner">Yes</Fact>}
              {!plot.ConvertedUnitId && <Fact label="Planned villa type">{plot.PlannedVillaTypeName ? `${plot.PlannedVillaTypeCode} — ${plot.PlannedVillaTypeName}` : "—"}</Fact>}
            </div>

            {plot.ConvertedUnitId && (
              <section className="bg-card" style={{ border: RULE }}>
                <div className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2" style={{ borderBottom: RULE_SOFT }}>
                  <span className={HEAD}>Villa built on this plot</span>
                  {canDelete && (
                    <button onClick={() => undoConversion(plot)} className={`${KEY_LINE} h-7 px-2.5 !text-destructive !border-destructive`}
                      title="Only while the villa is unsold and no DPR work has started">Undo conversion</button>
                  )}
                </div>
                <div className="px-3 py-3 space-y-3">
                  {renameTo === null ? (
                    <p className="flex flex-wrap items-center gap-3">
                      <span className={`text-sm font-semibold ${NUM}`}>{plot.ConvertedUnitName || `Unit #${plot.ConvertedUnitId}`}</span>
                      {canEdit && <button type="button" onClick={() => setRenameTo((plot.ConvertedUnitName || "").split("/").pop() || "")} className={TEXT_LINK}>Rename</button>}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <input autoFocus value={renameTo} onChange={(e) => setRenameTo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renameVilla(plot); if (e.key === "Escape") setRenameTo(null); }}
                          maxLength={80} placeholder="e.g. V-100 or Rose Villa" className={`${INP} !h-8 min-w-[12rem] flex-1 !w-auto`} />
                        <button type="button" onClick={() => renameVilla(plot)} disabled={renaming || !renameTo.trim()} className={`${KEY_INK} h-8 px-3`}>{renaming ? "Saving…" : "Save"}</button>
                        <button type="button" onClick={() => setRenameTo(null)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                      </div>
                      <p className="text-xs text-muted-foreground">The project and block prefix is kept. DPR chains and live bookings take the new name.</p>
                    </div>
                  )}

                  <div className="pt-3 space-y-2" style={{ borderTop: RULE_SOFT }}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={LBL}>Villa type</p>
                        {plot.ConvertedVillaTypeId ? (
                          <p className="mt-1 text-sm">
                            <span className="font-semibold">{plot.ConvertedVillaTypeCode} — {plot.ConvertedVillaTypeName}</span>
                            <span className="text-muted-foreground">
                              {" · "}<span className={NUM}>{plot.ConvertedRoomCount ?? 0}</span> rooms
                              {plot.ConvertedFloorCount ? <> on <span className={NUM}>{plot.ConvertedFloorCount}</span> floor{plot.ConvertedFloorCount === 1 ? "" : "s"}</> : ""}
                              {plot.ConvertedBuiltUpAreaSqFt ? <> · <span className={NUM}>{Number(plot.ConvertedBuiltUpAreaSqFt).toLocaleString("en-IN")}</span> sq ft built-up</> : ""}
                            </span>
                          </p>
                        ) : (
                          <p className="mt-1 text-sm">Not set — <span className={NUM}>{plot.ConvertedRoomCount ?? 0}</span> rooms from a generic layout, no floors. Set its type so its rooms follow the type&apos;s floor plan.</p>
                        )}
                      </div>
                      {canEdit && !changingType && (
                        <button type="button" onClick={() => { setChangingType(true); setBuiltVillaType(plot.ConvertedVillaTypeId ? String(plot.ConvertedVillaTypeId) : ""); }} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
                          {plot.ConvertedVillaTypeId ? "Change type" : "Set type"}
                        </button>
                      )}
                    </div>
                    {plot.ConvertedVillaTypeId && Number(plot.ConvertedMissingRooms || 0) > 0 && (
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-card" style={{ border: RULE, boxShadow: "inset 3px 0 0 hsl(var(--foreground))" }}>
                        <span className="text-xs flex-1 min-w-[12rem]"><span className={NUM}>{plot.ConvertedMissingRooms}</span> room(s) of the <span className={NUM}>{plot.ConvertedPlanRoomCount}</span>-room floor plan are not built into this villa yet</span>
                        {canEdit && (
                          <button type="button" onClick={() => addMissingRooms(plot)} disabled={addingRooms} className={`${KEY_INK} h-7 px-2.5`}>
                            {addingRooms ? "Checking…" : `Add ${plot.ConvertedMissingRooms} missing room(s)`}
                          </button>
                        )}
                      </div>
                    )}
                    {Number(plot.ConvertedRoomsWithoutSteps || 0) > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <span className={NUM}>{plot.ConvertedRoomsWithoutSteps}</span> room{Number(plot.ConvertedRoomsWithoutSteps) === 1 ? "" : "s"} have no DPR steps yet
                        {plot.ConvertedTypesWithoutSteps ? ` (${plot.ConvertedTypesWithoutSteps})` : ""} — they get steps automatically once their room type has a step list in{" "}
                        <Link to="/civilworkdpr/dependency" className={TEXT_LINK}>Dependency</Link>. They are not counted as pending or done work until then.
                      </p>
                    )}
                    {canEdit && changingType && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <select value={builtVillaType} onChange={(e) => setBuiltVillaType(e.target.value)} className={`${INP} flex-1 !w-auto min-w-[12rem]`}>
                            <option value="">Choose a villa type</option>
                            {villaTypes.map((t) => <option key={t.Id} value={t.Id} disabled={!t.LayoutLabel}>{t.Code} — {t.Name}{t.LayoutLabel ? "" : " (no rooms yet)"}</option>)}
                          </select>
                          <button onClick={() => setVillaTypeOnBuilt(plot)} disabled={!builtVillaType || settingVillaType || builtVillaType === String(plot.ConvertedVillaTypeId ?? "")} className={`${KEY_INK} h-9 px-3`}>
                            {settingVillaType ? "Applying…" : "Apply"}
                          </button>
                          <button type="button" onClick={() => { setChangingType(false); setBuiltVillaType(""); }} className={`${KEY_LINE} h-9 px-3`}>Cancel</button>
                        </div>
                        {(() => {
                          const pick = villaTypes.find((t) => String(t.Id) === builtVillaType);
                          const differs = !!pick && Number(pick.BuiltUpAreaSqFt) !== Number(plot.ConvertedBuiltUpAreaSqFt || 0);
                          return pick && differs ? (
                            <label className="flex items-start gap-2 text-sm">
                              <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-foreground" checked={takeAreas} onChange={(e) => setTakeAreas(e.target.checked)} />
                              <span>Also take {pick.Code}&apos;s areas — built-up <span className={NUM}>{Number(pick.BuiltUpAreaSqFt).toLocaleString("en-IN")}</span> sq ft{pick.SuperBuiltUpAreaSqFt ? <>, super built-up <span className={NUM}>{Number(pick.SuperBuiltUpAreaSqFt).toLocaleString("en-IN")}</span></> : ""} (now <span className={NUM}>{Number(plot.ConvertedBuiltUpAreaSqFt || 0).toLocaleString("en-IN")}</span>). Not allowed once the villa is booked.</span>
                            </label>
                          ) : null;
                        })()}
                        <p className="text-xs text-muted-foreground">Its rooms are rebuilt floor by floor from the type&apos;s plan, with their DPR steps. Only while no DPR work has started.</p>
                        {villaTypes.length === 0 && <p className="text-xs text-muted-foreground">No active villa types in this project — add or restore them in Villa types.</p>}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
        {plot && (
          <div className="flex flex-wrap justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button onClick={() => onOpenChange(false)} className={`${KEY_LINE} h-9 px-4`}>Close</button>
            {canEdit && !plot.ConvertedUnitId && (
              <button onClick={() => onNeighbours(plot)} className={`${KEY_LINE} h-9 px-4`}><Network size={13} /> Neighbours</button>
            )}
            {canEdit && plotStatus(plot).kind === "available" && (
              <button onClick={() => onEdit(plot)} className={`${KEY_INK} h-9 px-4`}><Pencil size={13} /> Edit</button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
