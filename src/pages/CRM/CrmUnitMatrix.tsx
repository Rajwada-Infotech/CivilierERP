// CRM Unit Matrix: every unit, villa and plot of a project by block and floor, with who holds or has booked it. A free
// unit can be held for a customer; a held or booked one opens to show the record behind it.
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Layers } from "lucide-react";
import { getSocket } from "@/lib/socket";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ExtendRow, Facts, HOLDS_API, KEY_INK, KEY_LINE, KEY_RED, LBL, Legend, PlaceHoldDialog, RULE, RULE_SOFT, Section, TILE_GRID, Tile,
  fetchOptions, fmtMoney, holdCall, holdLeft, type Option, type TileStatus,
} from "./matrix/shared";

const API = "/api/unit-matrix";

interface MatrixUnit {
  KindName?: string | null;
  IsCommercial?: boolean | number;
  Id: number;
  UnitName: string;
  FloorNo: number | null;
  BlockId: number | null;
  BlockName: string | null;
  Status: TileStatus;
  AreaSqFt: number | null;
  BookingId: number | null;
  BookingNo: string | null;
  BookingStatus: string | null;
  BookingDate: string | null;
  TotalValue: number | null;
  GrandTotal: number | null;
  BookingAmount: number | null;
  ApplicationId: number | null;
  ApplicationNo: string | null;
  ApplicantName: string | null;
  Mobile: string | null;
  AssignedToName: string | null;
  AssignedToEmail: string | null;
  HoldId: number | null;
  HoldUntil: string | null;
  HoldApplicationId: number | null;
  HoldApplicationNo: string | null;
  HoldApplicantName: string | null;
  HoldMobile: string | null;
  HoldAssignedToName: string | null;
  HoldAssignedToEmail: string | null;
  // Plot rows (dbo.PlotMaster) carry IsPlot; plots have no floor.
  IsPlot?: boolean;
  IsVilla?: boolean;
  // A villa can only be booked by whoever owns all the plots it stands on.
  VillaLandSold?: boolean | null;
  VillaLandOwner?: string | null;
  VillaTypeCode?: string | null;
  BuiltUpAreaSqFt?: number | null;
  PlotNo?: string | null;
  Facing?: string | null;
  IsCornerPlot?: boolean | null;
  SurveyNo?: string | null;
  ConvertedUnitName?: string | null;
}

async function fetchMatrix(projectId: string, blockId: string): Promise<MatrixUnit[]> {
  const params = new URLSearchParams({ projectId });
  if (blockId) params.set("blockId", blockId);
  return fetchOptions<MatrixUnit>(`${API}?${params}`);
}
// Plots live in their own table (held through CrmBookingPlot). A tower-only project has none, so a failure here
// leaves the units standing rather than failing the whole matrix.
async function fetchPlotMatrix(projectId: string, blockId: string): Promise<MatrixUnit[]> {
  const params = new URLSearchParams({ projectId });
  if (blockId) params.set("blockId", blockId);
  try {
    const rows = await fetchOptions<any>(`${API}/plots?${params}`);
    return rows.map((r: any) => ({ ...r, IsPlot: true, FloorNo: null }));
  } catch {
    return [];
  }
}

const kindOf = (u: MatrixUnit) => (u.IsPlot ? "Plot" : u.IsVilla ? "Villa" : "Unit");

// A held or booked tile, opened: who, through which record, and what can be done from here. A hold with a booking
// behind it (booking amount not yet paid) offers Extend and, while the booking is still Pending, Cancel booking;
// a pure application-stage hold offers Release.
function TileInfoDialog({ unit, onClose }: { unit: MatrixUnit; onClose: () => void }) {
  const rights = usePageRights("crm-unit-matrix");
  const { canDoAction } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const isHold = unit.Status === "OnHold";
  const hasUnpaidBooking = isHold && unit.BookingId != null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["unit-matrix"] });

  const release = async () => {
    setBusy(true);
    try {
      await holdCall(`${HOLDS_API}/${unit.HoldId}/release`, "PUT");
      toast.success(`Hold released; ${unit.UnitName} is free again`);
      refresh();
      onClose();
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setBusy(false); }
  };

  // Only while the booking is still Pending (PUT /:id/reject's own rule) and under the Bookings edit right, which that
  // route checks. An approved-but-unpaid booking goes through the full cancellation on Bookings.
  const cancelBooking = async () => {
    setBusy(true);
    try {
      const res = await fetchWithAuth(`/api/crm/bookings/${unit.BookingId}/reject`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Remarks: "Cancelled from Unit Matrix: booking amount was never paid" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not cancel the booking.");
      toast.success(`Booking cancelled; ${unit.UnitName} is free again`);
      ["unit-matrix", "crm-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setBusy(false); }
  };

  const pick = <T,>(hold: T, own: T) => (isHold && hold) || own;
  const left = isHold ? holdLeft(unit.HoldUntil) : null;
  const where = [unit.BlockName, unit.IsVilla ? "Villa" : unit.FloorNo != null ? `Floor ${unit.FloorNo}` : null, unit.AreaSqFt ? `${unit.AreaSqFt} sq ft` : null].filter(Boolean).join(" · ");
  const state = isHold ? (hasUnpaidBooking ? "Booked, payment pending" : "On hold") : "Booked";
  const openBooking = () => navigate(unit.BookingId != null ? `/crm/bookings?view=${unit.BookingId}` : `/crm/bookings?applicationId=${unit.ApplicationId}`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="min-w-0">
            <span className={`block ${LBL}`}>{kindOf(unit)}</span>
            <span className="font-heading text-lg font-bold flex flex-wrap items-center gap-2">
              <Building2 size={16} /> <span className="tabular-nums">{unit.UnitName}</span>
              <SheetMark text={state} tone={isHold ? "waiting" : "done"} />
            </span>
            {where && <span className="block text-xs text-muted-foreground font-normal mt-0.5">{where}</span>}
          </DialogTitle>
        </DialogHeader>

        <Facts title="Customer" rows={[
          ["Application", pick(unit.HoldApplicationNo, unit.ApplicationNo)],
          ["Applicant", pick(unit.HoldApplicantName, unit.ApplicantName)],
          ["Mobile", pick(unit.HoldMobile, unit.Mobile)],
          ["Salesperson", <>{pick(unit.HoldAssignedToName, unit.AssignedToName) || "—"}{pick(unit.HoldAssignedToEmail, unit.AssignedToEmail) && <span className="block text-[0.6875rem] text-muted-foreground">{pick(unit.HoldAssignedToEmail, unit.AssignedToEmail)}</span>}</>],
        ]} />

        {(unit.BookingId != null || !isHold) && (
          <Facts title="Booking" rows={[
            ["Booking", unit.BookingNo],
            ["Status", unit.BookingStatus ? <SheetMark text={unit.BookingStatus} tone={statusTone(unit.BookingStatus)} /> : "—"],
            ["Booked on", unit.BookingDate ? String(unit.BookingDate).slice(0, 10) : "—"],
            ["Booking amount", fmtMoney(unit.BookingAmount)],
            ["Unit value", fmtMoney(unit.TotalValue)],
            ["Grand total", fmtMoney(unit.GrandTotal ?? unit.TotalValue)],
          ]} />
        )}

        {isHold && (
          <p className="text-xs px-3 py-2" style={{ border: RULE_SOFT }}>
            {hasUnpaidBooking ? "The booking amount isn't paid yet; the tile turns Booked once it is." : "Held through the application, before any booking."}
            {left && <span className="font-semibold"> Hold: {left}.</span>}
          </p>
        )}

        {showExtend && unit.HoldId != null && <ExtendRow holdId={unit.HoldId} onDone={() => { refresh(); onClose(); }} />}

        <div className="flex flex-wrap justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Close</button>
          {hasUnpaidBooking && canDoAction("crm-bookings", "edit") && unit.BookingStatus === CrmStatus.PENDING && (
            confirmCancel ? (
              <button onClick={cancelBooking} disabled={busy} className={`${KEY_RED} h-9 px-4`}>{busy ? "Cancelling…" : `Cancel ${unit.BookingNo}?`}</button>
            ) : (
              <button onClick={() => setConfirmCancel(true)} className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}>Cancel booking</button>
            )
          )}
          {isHold && rights.canEdit && unit.HoldId != null && hasUnpaidBooking && (
            <button onClick={() => setShowExtend((s) => !s)} className={`${KEY_LINE} h-9 px-3`}>Extend hold</button>
          )}
          {isHold && !hasUnpaidBooking ? (
            rights.canEdit && unit.HoldId != null && (
              <button onClick={release} disabled={busy} className={`${KEY_RED} h-9 px-4`}>{busy ? "Releasing…" : "Release hold"}</button>
            )
          ) : (
            <button onClick={openBooking} className={`${KEY_INK} h-9 px-4`}>Open booking</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UnitMatrixPage() {
  const navigate = useNavigate();
  const rights = usePageRights("crm-unit-matrix");
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [holdTarget, setHoldTarget] = useState<MatrixUnit | null>(null);
  const [infoTarget, setInfoTarget] = useState<MatrixUnit | null>(null);

  // Live updates: any booking, hold or release on this project refreshes the matrix. It used to refresh units only,
  // leaving plots stale.
  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const onUpdate = (payload: any) => {
      if (!payload?.projectId || payload.projectId === Number(projectId)) qc.invalidateQueries({ queryKey: ["unit-matrix"] });
    };
    sock.on("matrix:update", onUpdate);
    return () => { sock.off("matrix:update", onUpdate); };
  }, [projectId, qc]);
  // Re-render every minute so the hold countdowns tick.
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  const { data: projects = [], isLoading: loadingProjects } = useQuery({ queryKey: ["unit-matrix-projects"], queryFn: () => fetchOptions<Option>(`${API}/projects`) });
  // One project only: open it straight away.
  useEffect(() => { if (!projectId && projects.length === 1) setProjectId(String(projects[0].Id)); }, [projects, projectId]);
  const { data: blocks = [] } = useQuery({
    queryKey: ["unit-matrix-blocks", projectId],
    queryFn: () => fetchOptions<Option>(`${API}/blocks?projectId=${projectId}`),
    enabled: !!projectId,
  });
  const { data: unitRows = [], isLoading, isError, error } = useQuery({
    queryKey: ["unit-matrix", projectId, blockId],
    queryFn: () => fetchMatrix(projectId, blockId),
    enabled: !!projectId,
  });
  // Same "unit-matrix" prefix, so every refresh covers plots too.
  const { data: plotRows = [] } = useQuery({
    queryKey: ["unit-matrix", "plots", projectId, blockId],
    queryFn: () => fetchPlotMatrix(projectId, blockId),
    enabled: !!projectId,
  });
  const units = useMemo(() => [...unitRows, ...plotRows], [unitRows, plotRows]);

  // Block first, then floor within each block, like the buildings themselves.
  const grouped = useMemo(() => {
    const byBlock = new Map<string, Map<string, MatrixUnit[]>>();
    for (const u of units) {
      const blockKey = u.BlockName || "No block";
      const floorKey = u.IsPlot ? "Plots" : u.IsVilla ? "Villas" : u.FloorNo != null ? `Floor ${u.FloorNo}` : "No floor";
      if (!byBlock.has(blockKey)) byBlock.set(blockKey, new Map());
      const floors = byBlock.get(blockKey)!;
      if (!floors.has(floorKey)) floors.set(floorKey, []);
      floors.get(floorKey)!.push(u);
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    return Array.from(byBlock.entries()).sort(([a], [b]) => cmp(a, b)).map(([blockName, floorMap]) => ({
      blockName,
      count: Array.from(floorMap.values()).reduce((n, l) => n + l.length, 0),
      free: Array.from(floorMap.values()).reduce((n, l) => n + l.filter((u) => u.Status === "Available").length, 0),
      floors: Array.from(floorMap.entries()).sort(([a], [b]) => cmp(a, b)).map(([f, list]) => [f, [...list].sort((x, y) => cmp(x.UnitName, y.UnitName))] as const),
    }));
  }, [units]);

  const counts = useMemo(() => {
    const c: Record<TileStatus, number> = { Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
    units.forEach((u) => { c[u.Status] = (c[u.Status] || 0) + 1; });
    return c;
  }, [units]);
  const sold = units.length - counts.Blocked > 0 ? Math.round((counts.Booked / (units.length - counts.Blocked)) * 100) : 0;
  const expiringSoon = units.filter((u) => u.Status === "OnHold" && u.HoldUntil && new Date(u.HoldUntil).getTime() - Date.now() < 86_400_000).length;

  const onTile = (u: MatrixUnit) => {
    if (u.Status === "OnHold" || u.Status === "Booked") return setInfoTarget(u);
    if (u.Status === "Available" && !u.IsPlot && rights.canCreate) setHoldTarget(u);
  };
  const tileLine = (u: MatrixUnit) =>
    u.Status === "Booked" ? (u.ApplicantName || u.BookingNo || "—")
      : u.Status === "OnHold" ? (u.HoldApplicantName || u.ApplicantName || "—")
      : u.Status === "Blocked" ? "Not for sale"
      : u.IsVilla ? (u.VillaLandSold ? `Plot owner only: ${u.VillaLandOwner || "—"}` : "Sold as a whole villa")
      : [u.AreaSqFt ? `${Number(u.AreaSqFt).toLocaleString("en-IN")} sq ft` : null, u.IsPlot && u.Facing].filter(Boolean).join(" · ") || "Free";
  const tileTitle = (u: MatrixUnit) =>
    u.IsPlot && u.Status === "Available" ? "A plot is reserved through its application, not held here."
      : u.Status === "Available" && !rights.canCreate ? "You don't have the right to place holds."
      : u.Status === "Available" ? "Hold for a customer" : undefined;

  return (
    <>
      <Breadcrumbs items={[{ label: "CRM", path: "/crm/dashboard" }, { label: "Unit Matrix", path: "/crm/unit-matrix" }]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Unit Matrix"
        subtitle="Every unit, villa and plot of a project, by block and floor. Hold a free unit for a customer; open a held or booked one to see who and through which record."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => navigate("/crm/setup/unit-master")} className={`${KEY_LINE} h-9 px-3`}><Layers size={13} /> Unit Master</button>
            <button onClick={() => navigate("/crm/setup/block-master")} className={`${KEY_LINE} h-9 px-3`}><Layers size={13} /> Block Master</button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card px-5 py-4 flex flex-wrap items-end gap-3" style={{ border: RULE }}>
            <label className="block space-y-1 w-full sm:w-72">
              <span className={`block ${LBL}`}>Project</span>
              <SearchableSelect value={projectId} onChange={(v) => { setProjectId(v); setBlockId(""); }}
                placeholder={loadingProjects ? "Loading…" : projects.length ? "Select project" : "No project you can see"}
                searchPlaceholder="Search projects…" options={projects.map((p) => ({ value: String(p.Id), label: p.Name }))} />
            </label>
            <label className="block space-y-1 w-full sm:w-56">
              <span className={`block ${LBL}`}>Block</span>
              <SearchableSelect value={blockId} onChange={setBlockId} disabled={!projectId} placeholder="All blocks"
                searchPlaceholder="Search blocks…" options={[{ value: "", label: "All blocks" }, ...blocks.map((b) => ({ value: String(b.Id), label: b.Name }))]} />
            </label>
            {projectId && units.length > 0 && <div className="sm:ml-auto"><Legend counts={counts} /></div>}
          </div>

          {!projectId ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Select a project to see its matrix.</p>
          ) : isError ? (
            <p className="py-16 text-center text-sm text-destructive">{(error as Error)?.message}</p>
          ) : (
            <>
              <div className="bg-card" style={{ border: RULE }}>
                <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                  {[
                    { label: "Free", value: counts.Available, note: `of ${units.length} in this view` },
                    { label: "On hold", value: counts.OnHold, note: expiringSoon ? `${expiringSoon} end within a day` : "None ending within a day" },
                    { label: "Booked", value: counts.Booked, note: `${sold}% of what is for sale` },
                    { label: "Blocked", value: counts.Blocked, note: "Not for sale" },
                  ].map((x) => (
                    <div key={x.label}>
                      <p className="label">{x.label}</p>
                      <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                      <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {isLoading ? (
                <p className="py-16 text-center text-sm text-muted-foreground">Loading the matrix…</p>
              ) : units.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No units in this selection. Add them in Unit Master.</p>
              ) : (
                grouped.map(({ blockName, count, free, floors }) => (
                  <Section key={blockName} title={blockName} note={`${count} · ${free} free`}>
                    {floors.map(([floor, list]) => (
                      <div key={floor}>
                        <p className={`mb-2 ${LBL}`}>{floor}</p>
                        <div className={TILE_GRID}>
                          {list.map((u) => (
                            <Tile key={`${u.IsPlot ? "p" : "u"}${u.Id}`} name={u.UnitName} status={u.Status}
                              tag={u.IsVilla ? u.VillaTypeCode : u.IsCommercial ? u.KindName : u.IsPlot && u.IsCornerPlot ? "Corner" : null}
                              line={tileLine(u)} holdUntil={u.HoldUntil} title={tileTitle(u)}
                              disabled={u.Status === "Blocked" || (u.Status === "Available" && (u.IsPlot || !rights.canCreate))}
                              onClick={() => onTile(u)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </Section>
                ))
              )}
            </>
          )}
        </div>
      </SheetShell>

      {holdTarget && (
        <PlaceHoldDialog entityType="Unit" entityId={holdTarget.Id} label={`${kindOf(holdTarget).toLowerCase()} ${holdTarget.UnitName}`} projectId={projectId}
          canPlace={rights.canCreate} onDone={() => qc.invalidateQueries({ queryKey: ["unit-matrix"] })} onClose={() => setHoldTarget(null)} />
      )}
      {infoTarget && <TileInfoDialog unit={infoTarget} onClose={() => setInfoTarget(null)} />}
    </>
  );
}

export default UnitMatrixPage;
