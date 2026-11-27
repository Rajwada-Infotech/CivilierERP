// CRM Unit Matrix: enterprise inventory matrix & stacking grid for units, villas, and plots by block & floor.
// Supports interactive Matrix stacking view (Compact/Detailed, collapsible blocks, floor order toggle) alongside
// a sortable/paginated Table view (CrmGrid) for huge inventories, CSV export, live Socket updates, and Hold/Booking modals.
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowDownUp, Building2, ChevronDown, ChevronRight, Download, ExternalLink,
  Grid3X3, Layers, Lock, RefreshCw, Table2,
} from "lucide-react";
import { getSocket } from "@/lib/socket";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { useAuth } from "@/contexts/AuthContext";
import { useRememberedProject } from "@/hooks/useRememberedProject";
import { useUrlParam } from "@/hooks/useUrlParam";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { type CrmSort } from "@/hooks/useCrmListState";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CrmGrid, GRID_BTN, GRID_CARD, GRID_KEY, GridColumnChooser, GridGuidance, GridHighlights,
  GridSearch, GridStatusPill, GridTabs, GridToneMark, exportGrid, useGridPrefs,
  type GridCol,
} from "@/components/crm/CrmDataTable";
import { cn, naturalCompare } from "@/lib/utils";
import { asName } from "./payments/parts";
import {
  HOLDS_API, MATRIX_BTN, MATRIX_BTN_BRAND, MATRIX_BTN_DANGER, ModernPlaceHoldDialog,
  fetchOptions, fmtMoney, holdCall, type Option, type TileStatus,
} from "./matrix/shared";

const API = "/api/unit-matrix";

type StatusTab = "all" | TileStatus;
type KindFilter = "all" | "unit" | "villa" | "plot" | "commercial";

const TONE_EMERALD_TEXT = "text-emerald-400 [[data-theme]_&]:text-emerald-700";
const TONE_AMBER_TEXT = "text-amber-300 [[data-theme]_&]:text-amber-700";
const TONE_EMERALD_PILL = "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 [[data-theme]_&]:bg-emerald-500/10 [[data-theme]_&]:border-emerald-500/25 [[data-theme]_&]:text-emerald-700";
const TONE_AMBER_PILL = "bg-amber-500/15 border-amber-500/30 text-amber-300 [[data-theme]_&]:bg-amber-500/10 [[data-theme]_&]:border-amber-500/30 [[data-theme]_&]:text-amber-700";

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
  IsPlot?: boolean;
  IsVilla?: boolean;
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

const kindOf = (u: MatrixUnit) => (u.IsPlot ? "Plot" : u.IsVilla ? "Villa" : u.IsCommercial ? (u.KindName || "Commercial") : "Unit");

function fmtHoldRemaining(holdUntil: string | null): string | null {
  if (!holdUntil) return null;
  const diffMs = new Date(holdUntil).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs <= 0) return "Expired";
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 24) return `${Math.ceil(hours / 24)}d left`;
  return `${Math.max(1, hours)}h left`;
}

// ─── Held / Booked Tile Inspection Modal ─────────────────────────────────────
function TileInfoDialog({ unit, onClose }: { unit: MatrixUnit; onClose: () => void }) {
  const rights = usePageRights("crm-unit-matrix");
  const { canDoAction } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
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
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async () => {
    setBusy(true);
    try {
      const res = await fetchWithAuth(`/api/crm/bookings/${unit.BookingId}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Remarks: "Cancelled from Unit Matrix: booking amount was never paid" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not cancel the booking.");
      toast.success(`Booking cancelled; ${unit.UnitName} is free again`);
      ["unit-matrix", "crm-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBusy(false);
    }
  };

  const pick = <T,>(hold: T, own: T) => (isHold && hold) || own;
  const applicant = pick(unit.HoldApplicantName, unit.ApplicantName);
  const mobile = pick(unit.HoldMobile, unit.Mobile);
  const appId = pick(unit.HoldApplicationId, unit.ApplicationId);
  const appNo = pick(unit.HoldApplicationNo, unit.ApplicationNo);
  const salesperson = pick(unit.HoldAssignedToName, unit.AssignedToName);
  const salesEmail = pick(unit.HoldAssignedToEmail, unit.AssignedToEmail);
  const holdLeft = isHold ? fmtHoldRemaining(unit.HoldUntil) : null;

  const where = [
    unit.BlockName,
    unit.IsVilla ? "Villa" : unit.IsPlot ? "Plot" : unit.FloorNo != null ? `Floor ${unit.FloorNo}` : null,
    unit.AreaSqFt ? `${Number(unit.AreaSqFt).toLocaleString("en-IN")} sq ft` : null,
    unit.Facing || null,
  ].filter(Boolean).join(" · ");

  const state = isHold ? (hasUnpaidBooking ? "Booked · Payment Pending" : "On Hold") : "Booked";
  const openBooking = () =>
    navigate(unit.BookingId != null ? `/crm/bookings?view=${unit.BookingId}` : `/crm/bookings?applicationId=${appId}`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto thin-scroll rounded-xl p-5 gap-4">
        <DialogHeader className="sr-only">
          <DialogTitle>{kindOf(unit)} {unit.UnitName}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <GridHighlights
            icon={Building2}
            object={`${kindOf(unit)} · ${unit.BlockName || "Unit Matrix"}`}
            title={<span className="tabular-nums">{unit.UnitName}</span>}
            status={<GridToneMark tone={isHold ? "waiting" : "done"} text={state} />}
            sub={where || undefined}
            actions={
              <div className="pr-8 flex items-center gap-2">
                {appId != null && (
                  <Link to={`/crm/applications?view=${appId}`} className={`${MATRIX_BTN} text-foreground`}>
                    <ExternalLink size={12} /> Application
                  </Link>
                )}
              </div>
            }
            fields={[
              { label: "Customer", value: applicant ? <span className="capitalize">{asName(applicant)}</span> : "—" },
              { label: "Mobile", value: mobile || "—" },
              { label: "Application", value: appNo || "—" },
              { label: "Booking", value: unit.BookingNo || "—" },
              { label: "Grand total", value: unit.BookingId != null || !isHold ? fmtMoney(unit.GrandTotal ?? unit.TotalValue) : "—" },
              { label: isHold ? "Hold window" : "Booked on", value: isHold ? (holdLeft || "Open hold") : (unit.BookingDate ? String(unit.BookingDate).slice(0, 10) : "—") },
            ]}
          />

          {isHold && (
            <GridGuidance
              tone="waiting"
              title={hasUnpaidBooking ? "Booking created — awaiting booking amount" : "Active pre-booking inventory hold"}
              text={
                hasUnpaidBooking
                  ? `Booking amount (${fmtMoney(unit.BookingAmount)}) has not cleared Milestone 1 yet.${unit.HoldUntil ? ` Confirmation deadline: ${new Date(unit.HoldUntil).toLocaleString("en-IN")}.` : ""}`
                  : `Held at application stage before a booking is created.${unit.HoldUntil ? ` Hold expires ${new Date(unit.HoldUntil).toLocaleString("en-IN")}.` : ""}`
              }
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <section className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-semibold text-foreground">
                Customer &amp; Owner
              </div>
              <dl className="p-4 space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Applicant</dt>
                  <dd className="font-medium text-foreground capitalize text-right">{applicant ? asName(applicant) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Mobile</dt>
                  <dd className="font-medium tabular-nums">{mobile || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Application No.</dt>
                  <dd className="font-mono font-medium">{appNo || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Salesperson</dt>
                  <dd className="font-medium text-right">
                    <div>{salesperson || "—"}</div>
                    {salesEmail && <div className="text-[0.6875rem] text-muted-foreground font-normal">{salesEmail}</div>}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-semibold text-foreground flex items-center justify-between gap-2">
                <span>Booking Summary</span>
                {unit.BookingStatus && <GridStatusPill status={unit.BookingStatus} />}
              </div>
              <dl className="p-4 space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Booking No.</dt>
                  <dd className="font-mono font-medium">{unit.BookingNo || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Booked on</dt>
                  <dd className="tabular-nums font-medium">{unit.BookingDate ? String(unit.BookingDate).slice(0, 10) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Booking amount</dt>
                  <dd className="tabular-nums font-medium">{fmtMoney(unit.BookingAmount)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Unit value</dt>
                  <dd className="tabular-nums font-medium">{fmtMoney(unit.TotalValue)}</dd>
                </div>
                <div className="flex justify-between gap-2 pt-2 border-t border-border/70">
                  <dt className="font-semibold text-foreground">Grand total</dt>
                  <dd className="tabular-nums font-bold text-foreground">{fmtMoney(unit.GrandTotal ?? unit.TotalValue)}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
            <div className="flex flex-wrap items-center gap-2">
              {hasUnpaidBooking && canDoAction("crm-bookings", "edit") && unit.BookingStatus === CrmStatus.PENDING && (
                confirmCancel ? (
                  <>
                    <button type="button" onClick={cancelBooking} disabled={busy} className={MATRIX_BTN_DANGER}>
                      {busy ? "Cancelling…" : `Confirm cancel ${unit.BookingNo}`}
                    </button>
                    <button type="button" onClick={() => setConfirmCancel(false)} className={`${MATRIX_BTN} text-foreground`}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className={`${MATRIX_BTN} !text-destructive !border-destructive/40`}
                  >
                    Cancel booking
                  </button>
                )
              )}
              {isHold && !hasUnpaidBooking && rights.canEdit && unit.HoldId != null && (
                <button type="button" onClick={release} disabled={busy} className={MATRIX_BTN_DANGER}>
                  {busy ? "Releasing…" : "Release hold"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={onClose} className={`${MATRIX_BTN} text-foreground`}>Close</button>
              {(unit.BookingId != null || (!isHold && appId != null)) && (
                <button type="button" onClick={openBooking} className={MATRIX_BTN_BRAND}>
                  Open booking
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Unit Matrix Page ───────────────────────────────────────────────────
export function UnitMatrixPage() {
  const navigate = useNavigate();
  const rights = usePageRights("crm-unit-matrix");
  const qc = useQueryClient();

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["unit-matrix-projects"],
    queryFn: () => fetchOptions<Option>(`${API}/projects`),
  });
  const [projectId, setProjectId] = useRememberedProject("unit-matrix", projects);
  const [blockId, setBlockId] = useUrlParam("block");

  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"matrix" | "table">("matrix");
  const [compactTiles, setCompactTiles] = useState(false);
  const [topDownFloors, setTopDownFloors] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({});

  // Table pagination & sorting (for high-scale Table view)
  const [sort, setSort] = useState<CrmSort>({ key: "UnitName", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [holdTarget, setHoldTarget] = useState<MatrixUnit | null>(null);
  const [infoTarget, setInfoTarget] = useState<MatrixUnit | null>(null);

  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });

  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const onUpdate = (payload: any) => {
      if (!payload?.projectId || payload.projectId === Number(projectId)) qc.invalidateQueries({ queryKey: ["unit-matrix"] });
    };
    sock.on("matrix:update", onUpdate);
    return () => { sock.off("matrix:update", onUpdate); };
  }, [projectId, qc]);

  const { data: blocks = [] } = useQuery({
    queryKey: ["unit-matrix-blocks", projectId],
    queryFn: () => fetchOptions<Option>(`${API}/blocks?projectId=${projectId}`),
    enabled: !!projectId,
  });

  const { data: unitRows = [], isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["unit-matrix", projectId, blockId],
    queryFn: () => fetchMatrix(projectId, blockId),
    enabled: !!projectId,
  });

  const { data: plotRows = [] } = useQuery({
    queryKey: ["unit-matrix", "plots", projectId, blockId],
    queryFn: () => fetchPlotMatrix(projectId, blockId),
    enabled: !!projectId,
  });

  const units = useMemo(() => [...unitRows, ...plotRows], [unitRows, plotRows]);

  // Inventory status counters computed under selected project + block + search + kind (except status tab itself)
  const counts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const c = { all: 0, Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
    for (const u of units) {
      if (kindFilter === "plot" && !u.IsPlot) continue;
      if (kindFilter === "villa" && !u.IsVilla) continue;
      if (kindFilter === "commercial" && !u.IsCommercial) continue;
      if (kindFilter === "unit" && (u.IsPlot || u.IsVilla || u.IsCommercial)) continue;
      if (q) {
        const hay = [
          u.UnitName, u.PlotNo, u.BlockName, u.ApplicantName, u.HoldApplicantName,
          u.BookingNo, u.ApplicationNo, u.HoldApplicationNo, u.Mobile, u.HoldMobile,
          u.AssignedToName, u.HoldAssignedToName, u.VillaTypeCode, u.KindName, u.Facing,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) continue;
      }
      c.all += 1;
      c[u.Status] = (c[u.Status] || 0) + 1;
    }
    return c;
  }, [units, search, kindFilter]);

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units.filter((u) => {
      if (statusTab !== "all" && u.Status !== statusTab) return false;
      if (kindFilter === "plot" && !u.IsPlot) return false;
      if (kindFilter === "villa" && !u.IsVilla) return false;
      if (kindFilter === "commercial" && !u.IsCommercial) return false;
      if (kindFilter === "unit" && (u.IsPlot || u.IsVilla || u.IsCommercial)) return false;
      if (q) {
        const hay = [
          u.UnitName, u.PlotNo, u.BlockName, u.ApplicantName, u.HoldApplicantName,
          u.BookingNo, u.ApplicationNo, u.HoldApplicationNo, u.Mobile, u.HoldMobile,
          u.AssignedToName, u.HoldAssignedToName, u.VillaTypeCode, u.KindName, u.Facing,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [units, statusTab, kindFilter, search]);

  const hasKinds = useMemo(() => ({
    hasPlots: units.some((u) => u.IsPlot),
    hasVillas: units.some((u) => u.IsVilla),
    hasCommercial: units.some((u) => !!u.IsCommercial),
  }), [units]);

  // Block + Floor grouping for interactive matrix view
  const grouped = useMemo(() => {
    const byBlock = new Map<string, Map<string, MatrixUnit[]>>();
    for (const u of filteredUnits) {
      const blockKey = u.BlockName || "No block";
      const floorKey = u.IsPlot ? "Plots" : u.IsVilla ? "Villas" : u.FloorNo != null ? `Floor ${u.FloorNo}` : "Unassigned Floor";
      if (!byBlock.has(blockKey)) byBlock.set(blockKey, new Map());
      const floors = byBlock.get(blockKey)!;
      if (!floors.has(floorKey)) floors.set(floorKey, []);
      floors.get(floorKey)!.push(u);
    }
    return Array.from(byBlock.entries())
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([blockName, floorMap]) => {
        const allInBlock = Array.from(floorMap.values()).flat();
        const blockCounts = { Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
        allInBlock.forEach((x) => { blockCounts[x.Status] += 1; });
        const sortedFloors = Array.from(floorMap.entries())
          .sort(([a], [b]) => (topDownFloors ? naturalCompare(b, a) : naturalCompare(a, b)))
          .map(([f, list]) => [f, [...list].sort((x, y) => naturalCompare(x.UnitName, y.UnitName))] as const);
        return {
          blockName,
          total: allInBlock.length,
          blockCounts,
          floors: sortedFloors,
        };
      });
  }, [filteredUnits, topDownFloors]);

  const forSaleCount = Math.max(0, counts.all - counts.Blocked);
  const soldPct = forSaleCount > 0 ? Math.round((counts.Booked / forSaleCount) * 100) : 0;

  const onTile = (u: MatrixUnit) => {
    if (u.Status === "OnHold" || u.Status === "Booked") return setInfoTarget(u);
    if (u.Status === "Available" && !u.IsPlot && rights.canCreate) setHoldTarget(u);
  };

  const tileTitle = (u: MatrixUnit) =>
    u.IsPlot && u.Status === "Available" ? "Plots are reserved through an application, not placed on hold here."
      : u.Status === "Available" && !rights.canCreate ? "You don't have permission to place holds."
      : u.Status === "Available" ? "Click to place hold for a customer"
      : u.Status === "Blocked" ? (u.ConvertedUnitName ? `Converted to ${u.ConvertedUnitName}` : "Blocked — not for sale")
      : "Click to view booking / hold details";

  // ── Table View Setup (CrmGrid for massive inventory browsing & export) ──────
  const tableCols: GridCol<MatrixUnit>[] = useMemo(() => [
    {
      id: "unit",
      label: "Unit / Plot",
      sortKey: "UnitName",
      locked: true,
      csv: (u) => u.UnitName,
      cell: (u) => (
        <div className="min-w-0 leading-tight">
          <div className="text-[0.8125rem] font-semibold text-foreground tabular-nums">{u.UnitName}</div>
          <div className="text-[0.6875rem] text-muted-foreground">
            {kindOf(u)}{u.VillaTypeCode ? ` · ${u.VillaTypeCode}` : ""}{u.IsCornerPlot ? " · Corner" : ""}
          </div>
        </div>
      ),
    },
    {
      id: "block",
      label: "Block",
      sortKey: "BlockName",
      csv: (u) => u.BlockName || "—",
      cell: (u) => <span className="text-xs text-foreground">{u.BlockName || "—"}</span>,
    },
    {
      id: "floor",
      label: "Floor / Group",
      sortKey: "FloorNo",
      csv: (u) => u.IsPlot ? "Plot" : u.IsVilla ? "Villa" : u.FloorNo != null ? `Floor ${u.FloorNo}` : "—",
      cell: (u) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {u.IsPlot ? "Plot" : u.IsVilla ? "Villa" : u.FloorNo != null ? `Floor ${u.FloorNo}` : "—"}
        </span>
      ),
    },
    {
      id: "area",
      label: "Area (sq ft)",
      sortKey: "AreaSqFt",
      align: "right",
      csv: (u) => u.AreaSqFt ?? "",
      cell: (u) => <span className="text-xs tabular-nums">{u.AreaSqFt ? Number(u.AreaSqFt).toLocaleString("en-IN") : "—"}</span>,
    },
    {
      id: "status",
      label: "Availability",
      sortKey: "Status",
      csv: (u) => u.Status === "OnHold" && u.BookingId != null ? "Payment Pending" : u.Status,
      cell: (u) => u.Status === "Booked" ? (
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Booked
        </span>
      ) : u.Status === "OnHold" ? (
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_AMBER_PILL)}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {u.BookingId != null ? "Payment Pending" : "On Hold"}
        </span>
      ) : u.Status === "Blocked" ? (
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
          Blocked
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[0.6875rem] font-medium text-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Free
        </span>
      ),
    },
    {
      id: "customer",
      label: "Customer / Holder",
      sortKey: "Customer",
      csv: (u) => (u.Status === "OnHold" ? u.HoldApplicantName || u.ApplicantName : u.ApplicantName) || "",
      cell: (u) => {
        const name = u.Status === "OnHold" ? u.HoldApplicantName || u.ApplicantName : u.ApplicantName;
        const mob = u.Status === "OnHold" ? u.HoldMobile || u.Mobile : u.Mobile;
        if (!name) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="min-w-0 leading-tight max-w-[200px]">
            <div className="text-xs font-medium text-foreground truncate capitalize">{asName(name)}</div>
            {mob && <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{mob}</div>}
          </div>
        );
      },
    },
    {
      id: "ref",
      label: "Booking / Application",
      sortKey: "BookingNo",
      csv: (u) => u.BookingNo || u.HoldApplicationNo || u.ApplicationNo || "",
      cell: (u) => {
        const bNo = u.BookingNo;
        const aNo = u.HoldApplicationNo || u.ApplicationNo;
        if (!bNo && !aNo) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="min-w-0 leading-tight font-mono text-xs">
            {bNo && <div className="font-medium text-foreground">{bNo}</div>}
            {aNo && <div className="text-[0.6875rem] text-muted-foreground">{aNo}</div>}
          </div>
        );
      },
    },
    {
      id: "value",
      label: "Grand Total",
      sortKey: "GrandTotal",
      align: "right",
      csv: (u) => u.GrandTotal ?? u.TotalValue ?? "",
      cell: (u) => <span className="text-xs font-medium tabular-nums">{fmtMoney(u.GrandTotal ?? u.TotalValue)}</span>,
    },
  ], []);

  const [tablePrefs, setTablePrefs] = useGridPrefs("crm-unit-matrix-grid-v1", tableCols);

  const sortedTableRows = useMemo(() => {
    const dir = sort.dir === "desc" ? -1 : 1;
    const list = [...filteredUnits];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "BlockName": cmp = naturalCompare(a.BlockName || "", b.BlockName || ""); break;
        case "FloorNo": cmp = (a.FloorNo ?? -1) - (b.FloorNo ?? -1); break;
        case "AreaSqFt": cmp = (Number(a.AreaSqFt) || 0) - (Number(b.AreaSqFt) || 0); break;
        case "Status": cmp = naturalCompare(a.Status, b.Status); break;
        case "Customer": cmp = naturalCompare((a.HoldApplicantName || a.ApplicantName || ""), (b.HoldApplicantName || b.ApplicantName || "")); break;
        case "BookingNo": cmp = naturalCompare(a.BookingNo || a.HoldApplicationNo || "", b.BookingNo || b.HoldApplicationNo || ""); break;
        case "GrandTotal": cmp = (Number(a.GrandTotal ?? a.TotalValue) || 0) - (Number(b.GrandTotal ?? b.TotalValue) || 0); break;
        default: cmp = naturalCompare(a.UnitName, b.UnitName);
      }
      return cmp * dir;
    });
    return list;
  }, [filteredUnits, sort]);

  const pagedTableRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedTableRows.slice(start, start + pageSize);
  }, [sortedTableRows, page, pageSize]);

  const tabs = useMemo(() => [
    { key: "all" as StatusTab, label: "All Inventory", count: counts.all },
    { key: "Available" as StatusTab, label: "Free", count: counts.Available },
    { key: "OnHold" as StatusTab, label: "On Hold", count: counts.OnHold },
    { key: "Booked" as StatusTab, label: "Booked", count: counts.Booked },
    { key: "Blocked" as StatusTab, label: "Blocked", count: counts.Blocked },
  ], [counts]);

  const hasFilters = !!(search || kindFilter !== "all" || statusTab !== "all");
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setKindFilter("all");
    setStatusTab("all");
    setPage(1);
  };

  return (
    <>
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "CRM", path: "/crm/dashboard" }, { label: "Unit Matrix", path: "/crm/unit-matrix" }]} />

        {/* Enterprise Header Card */}
        <section className="rounded-xl border border-border bg-card px-5 py-4 shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Building2 size={13} className="text-primary" />
                <span>CRM · Live Inventory</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[0.6875rem]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live sync
                </span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground mt-0.5">Unit Matrix</h1>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-[82ch]">
                Floor-by-floor availability across units, villas and plots. Click a free unit to place a hold, or inspect held/booked records.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {projectId && (
                <button
                  type="button"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className={cn(GRID_KEY, "h-9 w-9 !px-0")}
                  title="Refresh inventory"
                  aria-label="Refresh unit matrix"
                >
                  <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
                </button>
              )}
              {projectId && filteredUnits.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    exportGrid(sortedTableRows, tableCols, `unit-matrix-project-${projectId}.csv`);
                    toast.success(`Exported ${sortedTableRows.length} inventory items`);
                  }}
                  className={GRID_BTN}
                >
                  <Download size={13} />
                  <span>Export CSV</span>
                </button>
              )}
              <button type="button" onClick={() => navigate("/crm/setup/unit-master")} className={GRID_BTN}>
                <Layers size={13} />
                <span className="hidden sm:inline">Unit Master</span>
              </button>
              <button type="button" onClick={() => navigate("/crm/setup/block-master")} className={GRID_BTN}>
                <Layers size={13} />
                <span className="hidden sm:inline">Block Master</span>
              </button>
            </div>
          </div>
        </section>

        {/* Main Workspace Card */}
        <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
          {projectId && (
            <GridTabs
              tabs={tabs}
              active={statusTab}
              onChange={(k) => { setStatusTab(k); setPage(1); }}
              label="Inventory availability"
              end={counts.all > 0 ? (
                <div className="hidden md:flex items-center gap-2.5 pr-1 text-xs">
                  <span className="text-muted-foreground tabular-nums">
                    <span className={cn("font-semibold", TONE_EMERALD_TEXT)}>{soldPct}% sold</span>
                    {" · "}
                    {counts.Booked} / {forSaleCount} sellable
                  </span>
                  <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden flex">
                    <span className="h-full bg-emerald-500" style={{ width: `${forSaleCount ? Math.round((counts.Booked / forSaleCount) * 100) : 0}%` }} />
                    <span className="h-full bg-amber-400" style={{ width: `${forSaleCount ? Math.round((counts.OnHold / forSaleCount) * 100) : 0}%` }} />
                  </div>
                </div>
              ) : undefined}
            />
          )}

          {/* Filter & Controls Toolbar */}
          <div className="px-4 py-3 border-b border-border bg-card flex flex-wrap items-center gap-2.5">
            <div className="w-full sm:w-64">
              <SearchableSelect
                value={projectId}
                onChange={(v) => { setProjectId(v); setBlockId(""); setPage(1); }}
                placeholder={loadingProjects ? "Loading projects…" : projects.length ? "Select project…" : "No project accessible"}
                searchPlaceholder="Search projects…"
                options={projects.map((p) => ({ value: String(p.Id), label: p.Name }))}
              />
            </div>

            <div className="w-full sm:w-48">
              <SearchableSelect
                value={blockId}
                onChange={(v) => { setBlockId(v); setPage(1); }}
                disabled={!projectId}
                placeholder="All blocks"
                searchPlaceholder="Search blocks…"
                options={[{ value: "", label: "All blocks" }, ...blocks.map((b) => ({ value: String(b.Id), label: b.Name }))]}
              />
            </div>

            {projectId && (
              <>
                <GridSearch
                  value={searchInput}
                  onChange={setSearchInput}
                  placeholder="Search unit, plot, buyer, app, salesperson…"
                />

                {(hasKinds.hasPlots || hasKinds.hasVillas || hasKinds.hasCommercial) && (
                  <Select value={kindFilter} onValueChange={(v) => { setKindFilter(v as KindFilter); setPage(1); }}>
                    <SelectTrigger className="h-9 w-[140px] text-xs bg-card border-border rounded-md">
                      <SelectValue placeholder="All kinds" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All kinds</SelectItem>
                      <SelectItem value="unit">Flats / Units</SelectItem>
                      {hasKinds.hasVillas && <SelectItem value="villa">Villas</SelectItem>}
                      {hasKinds.hasPlots && <SelectItem value="plot">Plots</SelectItem>}
                      {hasKinds.hasCommercial && <SelectItem value="commercial">Commercial</SelectItem>}
                    </SelectContent>
                  </Select>
                )}

                {hasFilters && (
                  <button type="button" onClick={clearFilters} className={GRID_BTN}>
                    Clear
                  </button>
                )}

                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  {viewMode === "matrix" && (
                    <>
                      <button
                        type="button"
                        onClick={() => setTopDownFloors((v) => !v)}
                        className={GRID_BTN}
                        title="Toggle floor stacking order"
                      >
                        <ArrowDownUp size={13} />
                        <span className="hidden sm:inline">{topDownFloors ? "Top → Ground" : "Ground → Top"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompactTiles((v) => !v)}
                        className={GRID_BTN}
                        title="Toggle compact or detailed unit tiles"
                      >
                        <span>{compactTiles ? "Detailed tiles" : "Compact tiles"}</span>
                      </button>
                    </>
                  )}
                  {viewMode === "table" && (
                    <GridColumnChooser cols={tableCols} prefs={tablePrefs} onChange={setTablePrefs} />
                  )}

                  {/* Matrix / Table View Switcher */}
                  <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("matrix")}
                      className={cn(
                        "inline-flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium transition-colors",
                        viewMode === "matrix" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Grid3X3 size={12} /> Matrix
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("table")}
                      className={cn(
                        "inline-flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium transition-colors",
                        viewMode === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Table2 size={12} /> Table
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Content Area */}
          {!projectId ? (
            <div className="py-16 px-4 text-center space-y-1.5">
              <Building2 size={28} className="mx-auto text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">Select a project</p>
              <p className="text-xs text-muted-foreground">Choose a project above to load its live unit, villa and plot inventory.</p>
            </div>
          ) : isError ? (
            <div role="alert" className="py-14 px-4 text-center space-y-2">
              <p className="text-sm text-destructive">{translateError((error as Error)?.message || "Could not load unit matrix.")}</p>
              <button type="button" onClick={() => refetch()} className={GRID_BTN}>Try again</button>
            </div>
          ) : viewMode === "table" ? (
            <CrmGrid
              cols={tableCols}
              prefs={tablePrefs}
              onPrefs={setTablePrefs}
              rows={pagedTableRows}
              rowKey={(u) => `${u.IsPlot ? "p" : "u"}-${u.Id}`}
              loading={isLoading}
              fetching={isFetching}
              sort={sort}
              onSort={(k) => {
                setSort((prev) => (prev.key === k ? { key: k, dir: prev.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));
                setPage(1);
              }}
              page={page}
              pageSize={pageSize}
              total={sortedTableRows.length}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
              onRowClick={onTile}
              empty={hasFilters ? "No units match these filters." : "No units in this selection."}
              mobileCardRenderer={(u) => (
                <div
                  onClick={() => onTile(u)}
                  className="rounded-lg border border-border bg-card p-3.5 space-y-2 cursor-pointer hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground tabular-nums">{u.UnitName}</div>
                      <div className="text-xs text-muted-foreground">
                        {[u.BlockName, u.IsVilla ? "Villa" : u.IsPlot ? "Plot" : u.FloorNo != null ? `Floor ${u.FloorNo}` : null, u.AreaSqFt ? `${u.AreaSqFt} sq ft` : null].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span className={cn(
                      "rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium shrink-0",
                      u.Status === "Booked" ? TONE_EMERALD_PILL : u.Status === "OnHold" ? TONE_AMBER_PILL : "border-border bg-card text-foreground",
                    )}>
                      {u.Status === "OnHold" && u.BookingId != null ? "Payment Pending" : u.Status === "Available" ? "Free" : u.Status}
                    </span>
                  </div>
                  {(u.HoldApplicantName || u.ApplicantName) && (
                    <div className="text-xs text-foreground capitalize">
                      Buyer: {asName(u.HoldApplicantName || u.ApplicantName)} {u.BookingNo ? `(${u.BookingNo})` : ""}
                    </div>
                  )}
                </div>
              )}
            />
          ) : (
            <div className="p-4 space-y-4">
              {/* Compact Legend inside Matrix view */}
              {units.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm border border-border bg-card inline-block" />
                      Free <strong className="text-foreground tabular-nums">{counts.Available}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/35 border border-amber-500/60 inline-block" />
                      On Hold / Pending <strong className="text-foreground tabular-nums">{counts.OnHold}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/35 border border-emerald-500/60 inline-block" />
                      Booked <strong className="text-foreground tabular-nums">{counts.Booked}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-border bg-muted/60 inline-block" />
                      Blocked <strong className="text-foreground tabular-nums">{counts.Blocked}</strong>
                    </span>
                  </div>
                  <span className="text-[0.6875rem] tabular-nums">
                    Showing {filteredUnits.length.toLocaleString("en-IN")} of {units.length.toLocaleString("en-IN")} units across {grouped.length} block{grouped.length === 1 ? "" : "s"}
                  </span>
                </div>
              )}

              {isLoading ? (
                <div className="py-16 text-center text-sm text-muted-foreground">Loading matrix inventory…</div>
              ) : filteredUnits.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {hasFilters ? "No units match the current filter criteria." : "No units found in this project. Add inventory in Unit Master."}
                  </p>
                  {hasFilters && (
                    <button type="button" onClick={clearFilters} className={GRID_BTN}>Reset filters</button>
                  )}
                </div>
              ) : (
                grouped.map(({ blockName, total: bTotal, blockCounts, floors }) => {
                  const collapsed = !!collapsedBlocks[blockName];
                  const bSellable = Math.max(0, bTotal - blockCounts.Blocked);
                  const bookedPct = bSellable ? Math.round((blockCounts.Booked / bSellable) * 100) : 0;
                  const holdPct = bSellable ? Math.round((blockCounts.OnHold / bSellable) * 100) : 0;

                  return (
                    <section key={blockName} className="rounded-xl border border-border bg-card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setCollapsedBlocks((prev) => ({ ...prev, [blockName]: !prev[blockName] }))}
                        className="w-full px-4 py-3 border-b border-border bg-muted/25 hover:bg-muted/40 transition-colors flex flex-wrap items-center justify-between gap-3 text-left"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {collapsed ? <ChevronRight size={15} className="text-muted-foreground shrink-0" /> : <ChevronDown size={15} className="text-muted-foreground shrink-0" />}
                          <span className="text-sm font-semibold text-foreground">{blockName}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground tabular-nums">
                            {bTotal} {bTotal === 1 ? "unit" : "units"}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                          <span className={TONE_EMERALD_TEXT}>{blockCounts.Booked} booked</span>
                          {blockCounts.OnHold > 0 && <span className={TONE_AMBER_TEXT}>{blockCounts.OnHold} hold</span>}
                          <span className="text-foreground font-medium">{blockCounts.Available} free</span>
                          <span className="hidden sm:flex w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                            <span className="h-full bg-emerald-500" style={{ width: `${bookedPct}%` }} />
                            <span className="h-full bg-amber-400" style={{ width: `${holdPct}%` }} />
                          </span>
                        </div>
                      </button>

                      {!collapsed && (
                        <div className="divide-y divide-border/70">
                          {floors.map(([floor, list]) => {
                            const floorFree = list.filter((u) => u.Status === "Available").length;
                            return (
                              <div key={floor} className="px-4 py-3.5 flex flex-col md:flex-row md:items-start gap-3">
                                <div className="md:w-32 shrink-0 flex md:flex-col items-center md:items-start justify-between gap-1 pt-0.5">
                                  <span className="text-xs font-semibold text-foreground">{floor}</span>
                                  <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                                    {floorFree} / {list.length} free
                                  </span>
                                </div>

                                <div className={cn(
                                  "flex-1 grid gap-2",
                                  compactTiles
                                    ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10"
                                    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7",
                                )}>
                                  {list.map((u) => {
                                    const clickable = u.Status === "OnHold" || u.Status === "Booked" || (u.Status === "Available" && !u.IsPlot && rights.canCreate);
                                    const holdBadge = u.Status === "OnHold" ? fmtHoldRemaining(u.HoldUntil) : null;
                                    const tag = u.IsVilla
                                      ? u.VillaTypeCode
                                      : u.IsCommercial
                                        ? u.KindName
                                        : u.IsPlot && u.IsCornerPlot
                                          ? "Corner"
                                          : null;
                                    const buyer = u.Status === "Booked"
                                      ? (u.ApplicantName || u.BookingNo || "Booked")
                                      : u.Status === "OnHold"
                                        ? (u.HoldApplicantName || u.ApplicantName || (u.BookingId != null ? "Payment pending" : "On hold"))
                                        : u.Status === "Blocked"
                                          ? (u.ConvertedUnitName ? `→ ${u.ConvertedUnitName}` : "Not for sale")
                                          : u.IsVilla
                                            ? (u.VillaLandSold ? `Plot owner: ${u.VillaLandOwner || "—"}` : "Whole villa")
                                            : [u.AreaSqFt ? `${Number(u.AreaSqFt).toLocaleString("en-IN")} sf` : null, u.IsPlot && u.Facing].filter(Boolean).join(" · ") || "Free";

                                    return (
                                      <button
                                        key={`${u.IsPlot ? "p" : "u"}-${u.Id}`}
                                        type="button"
                                        onClick={() => clickable && onTile(u)}
                                        disabled={!clickable}
                                        title={tileTitle(u)}
                                        className={cn(
                                          "group text-left rounded-lg border transition-all min-w-0",
                                          compactTiles ? "px-2.5 py-2" : "px-3 py-2.5",
                                          u.Status === "Available" && "border-border bg-card hover:border-emerald-500/60 hover:bg-emerald-500/[0.06]",
                                          u.Status === "OnHold" && "border-amber-500/45 bg-amber-500/[0.09] hover:border-amber-500/75",
                                          u.Status === "Booked" && "border-emerald-500/40 bg-emerald-500/[0.09] hover:border-emerald-500/70",
                                          u.Status === "Blocked" && "border-dashed border-border bg-muted/40 opacity-60",
                                          clickable ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" : "cursor-default",
                                        )}
                                      >
                                        <div className="flex items-center justify-between gap-1.5">
                                          <span className="inline-flex items-center gap-1.5 min-w-0">
                                            <span className={cn(
                                              "w-1.5 h-1.5 rounded-full shrink-0",
                                              u.Status === "Booked" ? "bg-emerald-500"
                                                : u.Status === "OnHold" ? "bg-amber-500"
                                                  : u.Status === "Blocked" ? "bg-muted-foreground/50"
                                                    : "bg-emerald-500/60 group-hover:bg-emerald-500",
                                            )} />
                                            <span className="text-xs sm:text-[0.8125rem] font-bold text-foreground truncate tabular-nums">
                                              {u.UnitName}
                                            </span>
                                          </span>
                                          {!compactTiles && (
                                            u.Status === "OnHold" && u.BookingId != null ? (
                                              <span className={cn("shrink-0 text-[0.5625rem] font-semibold uppercase tracking-wide", TONE_AMBER_TEXT)}>
                                                Pending
                                              </span>
                                            ) : holdBadge ? (
                                              <span className="shrink-0 text-[0.5625rem] text-muted-foreground tabular-nums">
                                                {holdBadge}
                                              </span>
                                            ) : tag ? (
                                              <span className="shrink-0 text-[0.5625rem] font-medium text-muted-foreground uppercase truncate max-w-[4rem]">
                                                {tag}
                                              </span>
                                            ) : u.Status === "Blocked" ? (
                                              <Lock size={10} className="text-muted-foreground shrink-0" />
                                            ) : null
                                          )}
                                        </div>

                                        {!compactTiles && (
                                          <div className={cn(
                                            "mt-1 text-[0.6875rem] truncate",
                                            u.Status === "Booked" || u.Status === "OnHold"
                                              ? "text-foreground/90 font-medium capitalize"
                                              : "text-muted-foreground",
                                          )}>
                                            {u.Status === "Booked" || u.Status === "OnHold" ? asName(buyer) : buyer}
                                          </div>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {holdTarget && (
        <ModernPlaceHoldDialog
          entityType="Unit"
          entityId={holdTarget.Id}
          label={`${kindOf(holdTarget).toLowerCase()} ${holdTarget.UnitName}`}
          subtitle={[holdTarget.BlockName, holdTarget.IsVilla ? "Villa" : holdTarget.FloorNo != null ? `Floor ${holdTarget.FloorNo}` : null, holdTarget.AreaSqFt ? `${holdTarget.AreaSqFt} sq ft` : null].filter(Boolean).join(" · ")}
          projectId={projectId}
          canPlace={rights.canCreate}
          onDone={() => qc.invalidateQueries({ queryKey: ["unit-matrix"] })}
          onClose={() => setHoldTarget(null)}
        />
      )}
      {infoTarget && <TileInfoDialog unit={infoTarget} onClose={() => setInfoTarget(null)} />}
    </>
  );
}

export default UnitMatrixPage;
