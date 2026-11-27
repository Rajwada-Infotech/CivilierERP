// CRM Parking Matrix: real-time parking inventory by Block and Parking Type (Open, Covered, Stack, Basement).
// High-density stall grid (Compact/Standard) and sortable/paginated Table view (CrmGrid) for huge inventories,
// with click-to-sell standalone, click-to-hold, occupied slot inspection, CSV export, and live socket updates.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Car, ChevronDown, ChevronRight, Clock, Download, ExternalLink, Grid3X3,
  Layers, Lock, RefreshCw, Shield, Sun, Table2, Wallet, Warehouse,
} from "lucide-react";
import { getSocket } from "@/lib/socket";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { useRememberedProject } from "@/hooks/useRememberedProject";
import { useUrlParam } from "@/hooks/useUrlParam";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { type CrmSort } from "@/hooks/useCrmListState";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CrmGrid, GRID_BTN, GRID_CARD, GRID_KEY, GridColumnChooser, GridGuidance, GridHighlights,
  GridSearch, GridStatusPill, GridTabs, GridToneMark, exportGrid, useGridPrefs,
  type GridCol,
} from "@/components/crm/CrmDataTable";
import { cn, naturalCompare } from "@/lib/utils";
import { asName } from "./payments/parts";
import {
  HOLDS_API, MATRIX_BTN, MATRIX_BTN_BRAND, MATRIX_BTN_DANGER, MATRIX_INP, MATRIX_TEXTAREA,
  ModernPlaceHoldDialog, customerOptions, fetchOptions, fmtHoldRemaining, fmtMoney, holdCall,
  useMatrixCustomers, type Option, type TileStatus,
} from "./matrix/shared";

const API = "/api/parking-matrix";
const RATE_API = "/api/parking-master/rate";

type StatusTab = "all" | TileStatus;

const TONE_EMERALD_TEXT = "text-emerald-400 [[data-theme]_&]:text-emerald-700";
const TONE_AMBER_TEXT = "text-amber-300 [[data-theme]_&]:text-amber-700";
const TONE_EMERALD_PILL = "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 [[data-theme]_&]:bg-emerald-500/10 [[data-theme]_&]:border-emerald-500/25 [[data-theme]_&]:text-emerald-700";
const TONE_AMBER_PILL = "bg-amber-500/15 border-amber-500/30 text-amber-300 [[data-theme]_&]:bg-amber-500/10 [[data-theme]_&]:border-amber-500/30 [[data-theme]_&]:text-amber-700";
const TONE_PRIMARY_PILL = "bg-primary/15 border-primary/30 text-primary [[data-theme]_&]:bg-primary/10 [[data-theme]_&]:border-primary/25";

interface MatrixSlot {
  Id: number;
  SlotNo: string;
  ParkingType: string;
  BlockId: number | null;
  BlockName: string | null;
  Status: TileStatus;
  AllotmentId: number | null;
  BookingId: number | null;
  BookingNo: string | null;
  BookingStatus?: string | null;
  AllotmentDate: string | null;
  TotalAmount: number | null;
  AllotmentPaymentStatus: string | null;
  Quantity: number | null;
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
}

interface ParkingRate {
  Id: number;
  Charge: number;
  GstRate: number;
  ParkingType: string;
  BlockId: number | null;
}

async function fetchMatrix(projectId: string, blockId: string): Promise<MatrixSlot[]> {
  const params = new URLSearchParams({ projectId });
  if (blockId) params.set("blockId", blockId);
  return fetchOptions<MatrixSlot>(`${API}?${params}`);
}

const slotAllocationMode = (s: MatrixSlot): "Unit-linked" | "Standalone" | "Hold" | "—" => {
  if (s.BookingId != null) return "Unit-linked";
  if (s.AllotmentId != null) return "Standalone";
  if (s.Status === "OnHold" && s.HoldId != null) return "Hold";
  return "—";
};

const slotPrimaryState = (s: MatrixSlot): string => {
  if (s.Status === "Booked") return "Sold";
  if (s.Status === "Blocked") return "Blocked";
  if (s.Status === "OnHold") {
    if (s.BookingId != null) return "Booking Pending";
    if (s.AllotmentId != null) return "Payment Pending";
    return "On Hold";
  }
  return "Free";
};

function ParkingTypeIcon({ type, size = 13, className }: { type: string; size?: number; className?: string }) {
  const t = (type || "").toLowerCase();
  if (t.includes("cover")) return <Shield size={size} className={className} />;
  if (t.includes("open")) return <Sun size={size} className={className} />;
  if (t.includes("stack")) return <Layers size={size} className={className} />;
  if (t.includes("base")) return <Warehouse size={size} className={className} />;
  return <Car size={size} className={className} />;
}

const errMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

// ─── Free Slot Action Chooser (Sell Now or Place Hold) ───────────────────────
function SlotActionDialog({
  slot, onSell, onHold, onClose,
}: {
  slot: MatrixSlot; onSell: () => void; onHold: () => void; onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-xl p-5 gap-4">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ParkingTypeIcon type={slot.ParkingType} size={13} className="text-primary" />
            <span>{slot.ParkingType || "Parking"} · {slot.BlockName || "Project-wide"}</span>
          </div>
          <DialogTitle className="text-lg font-bold flex items-center gap-2 tabular-nums">
            <span>Slot {slot.SlotNo}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
              Free
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={onSell}
            className="w-full text-left rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/[0.05] px-4 py-3 transition-colors flex items-start gap-3 cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
              <Wallet size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Sell slot now</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Allot this slot directly to a customer as a standalone parking sale.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={onHold}
            className="w-full text-left rounded-xl border border-border bg-card hover:border-amber-500/50 hover:bg-amber-500/[0.05] px-4 py-3 transition-colors flex items-start gap-3 cursor-pointer"
          >
            <div className={cn("w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5", TONE_AMBER_TEXT)}>
              <Clock size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Place hold</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Reserve this slot for an applicant while they confirm.
              </p>
            </div>
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-border">
          <button type="button" onClick={onClose} className={`${MATRIX_BTN} text-foreground`}>Cancel</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Standalone Direct Sale Dialog ───────────────────────────────────────────
function SellDialog({ slot, projectId, onClose }: { slot: MatrixSlot; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [applicationId, setApplicationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [rateOverride, setRateOverride] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: customers = [], isLoading } = useMatrixCustomers(projectId);
  const { data: rate, isLoading: loadingRate } = useQuery<ParkingRate | null>({
    queryKey: ["parking-rate", projectId, slot.BlockId, slot.ParkingType],
    queryFn: async () => {
      const params = new URLSearchParams({ projectId, parkingType: slot.ParkingType });
      if (slot.BlockId) params.set("blockId", String(slot.BlockId));
      const r = await fetchWithAuth(`${RATE_API}?${params}`);
      return r.ok ? r.json() : null;
    },
  });

  const qtyNum = Math.max(1, parseInt(quantity, 10) || 1);
  const overrideNum = rateOverride.trim() !== "" ? Number(rateOverride) : null;
  const effectiveUnitCharge = overrideNum != null && Number.isFinite(overrideNum) && overrideNum > 0
    ? overrideNum
    : rate?.Charge ?? null;
  const gstRate = Number(rate?.GstRate ?? 0);
  const baseTotal = effectiveUnitCharge != null ? effectiveUnitCharge * qtyNum : null;
  const gstAmount = baseTotal != null ? Math.round((baseTotal * gstRate) * 100) / 10000 : null;
  const estTotal = baseTotal != null && gstAmount != null ? Math.round((baseTotal + gstAmount) * 100) / 100 : null;

  const sell = async () => {
    if (!applicationId) return void toast.error("Select a customer.");
    if (!rate?.Id) return void toast.error(`No ${slot.ParkingType} parking rate is set for this project or block.`);
    if (rateOverride.trim() !== "" && (!Number.isFinite(Number(rateOverride)) || Number(rateOverride) <= 0)) {
      return void toast.error("Rate override must be a positive amount.");
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ApplicationId: parseInt(applicationId, 10),
        ParkingMasterId: rate.Id,
        ParkingSlotId: slot.Id,
        Quantity: qtyNum,
        Notes: notes.trim() || null,
        Immediate: true,
      };
      if (rateOverride.trim() !== "") payload.RateOverride = Number(rateOverride);

      const res = await fetchWithAuth("/api/crm/parking/standalone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not sell the slot.");
      toast.success(`Slot ${slot.SlotNo} sold for ${fmtMoney(data.TotalAmount)}`);
      ["parking-matrix", "crm-parking-all", "crm-parking-available"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onClose();
    } catch (e: unknown) {
      toast.error(translateError(errMessage(e, "Could not sell the slot.")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto thin-scroll rounded-xl p-5 gap-4">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ParkingTypeIcon type={slot.ParkingType} size={13} className="text-primary" />
            <span>Standalone Parking Sale</span>
          </div>
          <DialogTitle className="text-lg font-bold flex flex-wrap items-center gap-2 tabular-nums">
            <span>Sell slot {slot.SlotNo}</span>
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              {slot.ParkingType}
            </span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {slot.BlockName || "Project-wide"} · Allots a standalone parking record billed separately from any unit booking.
          </p>
        </DialogHeader>

        <div className="rounded-xl border border-border bg-muted/25 p-3.5 space-y-2">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Base rate</div>
              <div className="font-semibold text-foreground tabular-nums mt-0.5">
                {loadingRate ? "Loading…" : rate ? fmtMoney(rate.Charge) : <span className="text-destructive">Not configured</span>}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">GST</div>
              <div className="font-semibold text-foreground tabular-nums mt-0.5">
                {loadingRate ? "…" : rate ? `${gstRate}%` : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-muted-foreground">Total</div>
              <div className="font-bold text-foreground tabular-nums mt-0.5">
                {estTotal != null ? fmtMoney(estTotal) : "—"}
              </div>
            </div>
          </div>

          {!loadingRate && !rate && (
            <div className="pt-2 border-t border-border/70 flex items-center justify-between gap-2 text-xs">
              <span className="text-destructive">No active rate configured for {slot.ParkingType} in this selection.</span>
              <Link to="/crm/setup/parking-master" className="font-medium text-primary hover:underline shrink-0">
                Set rate →
              </Link>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground block">
              Customer / Live Application <span className="text-destructive">*</span>
            </span>
            <SearchableSelect
              value={applicationId}
              onChange={setApplicationId}
              placeholder={isLoading ? "Loading customers…" : customers.length ? "Select customer…" : "No live customer in this project"}
              searchPlaceholder="Search name, mobile, application or booking…"
              options={customerOptions(customers)}
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground block">Quantity</span>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={MATRIX_INP}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground block">Rate override (optional)</span>
              <input
                type="number"
                min={1}
                step="0.01"
                value={rateOverride}
                onChange={(e) => setRateOverride(e.target.value)}
                placeholder={rate?.Charge != null ? String(rate.Charge) : "Master rate"}
                className={MATRIX_INP}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground block">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional remarks…"
              className={MATRIX_TEXTAREA}
            />
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-border">
          <button type="button" onClick={onClose} className={`${MATRIX_BTN} text-foreground`}>Cancel</button>
          <button
            type="button"
            onClick={sell}
            disabled={saving || loadingRate || !rate}
            className={MATRIX_BTN_BRAND}
          >
            {saving ? "Selling…" : estTotal != null ? `Sell slot · ${fmtMoney(estTotal)}` : "Sell slot"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Held / Payment Pending / Sold Inspection Modal ──────────────────────────
function TileInfoDialog({ slot, onClose }: { slot: MatrixSlot; onClose: () => void }) {
  const rights = usePageRights("crm-parking-matrix");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const isHold = slot.Status === "OnHold";
  const hasBooking = slot.BookingId != null;
  const hasAllotment = slot.AllotmentId != null;
  const isPendingAllotment = isHold && hasAllotment;
  const refresh = () => ["parking-matrix", "crm-parking-all", "crm-parking-available"].forEach((k) =>
    qc.invalidateQueries({ queryKey: [k] }),
  );

  const release = async () => {
    setBusy(true);
    try {
      await holdCall(`${HOLDS_API}/${slot.HoldId}/release`, "PUT");
      toast.success(`Hold released; slot ${slot.SlotNo} is free again`);
      refresh();
      onClose();
    } catch (e: unknown) {
      toast.error(translateError(errMessage(e, "Could not release the hold.")));
    } finally {
      setBusy(false);
    }
  };

  const pickStr = (hold: string | null | undefined, own: string | null | undefined) => (isHold && hold ? hold : own) || null;
  const pickId = (hold: number | null | undefined, own: number | null | undefined) =>
    isHold && hold != null ? hold : own != null ? own : null;

  const applicant = pickStr(slot.HoldApplicantName, slot.ApplicantName);
  const mobile = pickStr(slot.HoldMobile, slot.Mobile);
  const appId = pickId(slot.HoldApplicationId, slot.ApplicationId);
  const appNo = pickStr(slot.HoldApplicationNo, slot.ApplicationNo);
  const salesperson = pickStr(slot.HoldAssignedToName, slot.AssignedToName);
  const salesEmail = pickStr(slot.HoldAssignedToEmail, slot.AssignedToEmail);
  const holdLeft = isHold ? fmtHoldRemaining(slot.HoldUntil) : null;

  const subMeta = [
    slot.BlockName || "Project-wide",
    slot.Quantity && slot.Quantity > 1 ? `Qty ${slot.Quantity}` : null,
    slotAllocationMode(slot) !== "—" ? slotAllocationMode(slot) : null,
  ].filter(Boolean).join(" · ");

  const stateLabel = slotPrimaryState(slot);

  const openPrimaryRecord = () => {
    if (hasBooking) navigate(`/crm/bookings?view=${slot.BookingId}`);
    else if (hasAllotment) navigate(`/crm/parking-booking?allotmentId=${slot.AllotmentId}`);
    else if (appId != null) navigate(`/crm/applications?id=${appId}`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto thin-scroll rounded-xl p-5 gap-4">
        <DialogHeader className="sr-only">
          <DialogTitle>Parking slot {slot.SlotNo}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <GridHighlights
            icon={Car}
            object={`${slot.ParkingType || "Parking"} · ${slot.BlockName || "Parking Matrix"}`}
            title={<span className="tabular-nums">Slot {slot.SlotNo}</span>}
            status={<GridToneMark tone={isHold ? "waiting" : "done"} text={stateLabel} />}
            sub={subMeta || undefined}
            actions={
              <div className="pr-8 flex items-center gap-2">
                {appId != null && (
                  <Link to={`/crm/applications?id=${appId}`} className={`${MATRIX_BTN} text-foreground`}>
                    <ExternalLink size={12} /> Application
                  </Link>
                )}
              </div>
            }
            fields={[
              { label: "Customer", value: applicant ? <span className="capitalize">{asName(applicant)}</span> : "—" },
              { label: "Mobile", value: mobile || "—" },
              { label: "Application", value: appNo || "—" },
              { label: "Allocation", value: hasBooking ? (slot.BookingNo || "Booking") : hasAllotment ? "Standalone sale" : "Pre-sale hold" },
              { label: "Charge", value: hasAllotment || !isHold ? fmtMoney(slot.TotalAmount) : "—" },
              {
                label: isHold ? (hasBooking ? "Confirm deadline" : hasAllotment ? "Payment status" : "Hold window") : "Allotted on",
                value: isHold
                  ? hasAllotment && !hasBooking
                    ? (slot.AllotmentPaymentStatus || "Pending")
                    : (holdLeft || "Open hold")
                  : (slot.AllotmentDate ? String(slot.AllotmentDate).slice(0, 10) : "—"),
              },
            ]}
          />

          {isHold && (
            <GridGuidance
              tone="waiting"
              title={
                hasBooking
                  ? "Unit-linked booking — awaiting Milestone 1 confirmation"
                  : isPendingAllotment
                    ? "Standalone parking sale — payment pending"
                    : "Active temporary parking hold"
              }
              text={
                hasBooking
                  ? `Allotted under booking ${slot.BookingNo || "—"}. The slot turns Sold once Milestone 1 clears.${slot.HoldUntil ? ` Confirmation deadline: ${new Date(slot.HoldUntil).toLocaleString("en-IN")}.` : ""}`
                  : isPendingAllotment
                    ? "The standalone allotment is created, but payment hasn't been recorded yet. Record receipt in Parking Booking to mark this slot Sold."
                    : `Held for this customer before an allotment or booking is finalised.${slot.HoldUntil ? ` Hold expires ${new Date(slot.HoldUntil).toLocaleString("en-IN")}.` : ""}`
              }
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <section className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-semibold text-foreground">
                Customer &amp; Salesperson
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
                <span>Allotment Summary</span>
                {slot.AllotmentPaymentStatus ? (
                  <GridStatusPill status={slot.AllotmentPaymentStatus} />
                ) : slot.BookingStatus ? (
                  <GridStatusPill status={slot.BookingStatus} />
                ) : null}
              </div>
              <dl className="p-4 space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Parking type</dt>
                  <dd className="font-medium text-foreground">{slot.ParkingType || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Sale mode</dt>
                  <dd className="font-medium text-foreground">
                    {hasBooking ? `Unit booking (${slot.BookingNo})` : hasAllotment ? "Standalone parking sale" : "Pre-sale hold"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Allotted on</dt>
                  <dd className="tabular-nums font-medium">{slot.AllotmentDate ? String(slot.AllotmentDate).slice(0, 10) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Quantity</dt>
                  <dd className="tabular-nums font-medium">{slot.Quantity ?? (hasAllotment ? 1 : "—")}</dd>
                </div>
                <div className="flex justify-between gap-2 pt-2 border-t border-border/70">
                  <dt className="font-semibold text-foreground">Total charge</dt>
                  <dd className="tabular-nums font-bold text-foreground">{hasAllotment ? fmtMoney(slot.TotalAmount) : "—"}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
            <div className="flex flex-wrap items-center gap-2">
              {isHold && !isPendingAllotment && !hasBooking && rights.canEdit && slot.HoldId != null && (
                <button type="button" onClick={release} disabled={busy} className={MATRIX_BTN_DANGER}>
                  {busy ? "Releasing…" : "Release hold"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={onClose} className={`${MATRIX_BTN} text-foreground`}>Close</button>
              {(hasBooking || hasAllotment || appId != null) && (
                <button type="button" onClick={openPrimaryRecord} className={MATRIX_BTN_BRAND}>
                  {hasBooking ? "Open booking" : hasAllotment ? "Open parking booking" : "Open application"}
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Parking Matrix Page ────────────────────────────────────────────────
export function ParkingMatrixPage() {
  const navigate = useNavigate();
  const rights = usePageRights("crm-parking-matrix");
  const qc = useQueryClient();

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["parking-matrix-projects"],
    queryFn: () => fetchOptions<Option>(`${API}/projects`),
  });
  const [projectId, setProjectId] = useRememberedProject("parking-matrix", projects);
  const [blockId, setBlockId] = useUrlParam("block");

  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"matrix" | "table">("matrix");
  const [compactSlots, setCompactSlots] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({});

  const [sort, setSort] = useState<CrmSort>({ key: "SlotNo", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [choiceSlot, setChoiceSlot] = useState<MatrixSlot | null>(null);
  const [sellSlot, setSellSlot] = useState<MatrixSlot | null>(null);
  const [holdSlot, setHoldSlot] = useState<MatrixSlot | null>(null);
  const [infoSlot, setInfoSlot] = useState<MatrixSlot | null>(null);

  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });

  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const onUpdate = (payload: { projectId?: number } | null | undefined) => {
      if (!payload?.projectId || payload.projectId === Number(projectId)) {
        qc.invalidateQueries({ queryKey: ["parking-matrix"] });
      }
    };
    sock.on("matrix:update", onUpdate);
    return () => { sock.off("matrix:update", onUpdate); };
  }, [projectId, qc]);

  const { data: blocks = [] } = useQuery({
    queryKey: ["parking-matrix-blocks", projectId],
    queryFn: () => fetchOptions<Option>(`${API}/blocks?projectId=${projectId}`),
    enabled: !!projectId,
  });

  const { data: slots = [], isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["parking-matrix", projectId, blockId],
    queryFn: () => fetchMatrix(projectId, blockId),
    enabled: !!projectId,
  });

  const matchesSearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (s: MatrixSlot) => {
      if (!q) return true;
      const hay = [
        s.SlotNo, s.ParkingType, s.BlockName, s.ApplicantName, s.HoldApplicantName,
        s.BookingNo, s.ApplicationNo, s.HoldApplicationNo, s.Mobile, s.HoldMobile,
        s.AssignedToName, s.HoldAssignedToName,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    };
  }, [search]);

  // Parking types derived cleanly from project slots for quick type-pill filtering
  const parkingTypes = useMemo(() => {
    const map = new Map<string, { type: string; total: number; free: number }>();
    for (const s of slots) {
      if (!matchesSearch(s)) continue;
      if (statusTab !== "all" && s.Status !== statusTab) continue;
      const t = s.ParkingType || "Parking";
      if (!map.has(t)) map.set(t, { type: t, total: 0, free: 0 });
      const row = map.get(t)!;
      row.total += 1;
      if (s.Status === "Available") row.free += 1;
    }
    return Array.from(map.values()).sort((a, b) => naturalCompare(a.type, b.type));
  }, [slots, matchesSearch, statusTab]);

  const counts = useMemo(() => {
    const c = { all: 0, Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
    for (const s of slots) {
      if (typeFilter !== "all" && s.ParkingType !== typeFilter) continue;
      if (!matchesSearch(s)) continue;
      c.all += 1;
      c[s.Status] = (c[s.Status] || 0) + 1;
    }
    return c;
  }, [slots, typeFilter, matchesSearch]);

  const filteredSlots = useMemo(
    () => slots.filter((s) =>
      (statusTab === "all" || s.Status === statusTab)
      && (typeFilter === "all" || s.ParkingType === typeFilter)
      && matchesSearch(s),
    ),
    [slots, statusTab, typeFilter, matchesSearch],
  );

  // Grouped by Block -> Parking Type for compact parking-lot layout
  const grouped = useMemo(() => {
    const byBlock = new Map<string, Map<string, MatrixSlot[]>>();
    for (const s of filteredSlots) {
      const bk = s.BlockName || "General / No Block";
      const tk = s.ParkingType || "Parking";
      if (!byBlock.has(bk)) byBlock.set(bk, new Map());
      const m = byBlock.get(bk)!;
      if (!m.has(tk)) m.set(tk, []);
      m.get(tk)!.push(s);
    }
    return Array.from(byBlock.entries())
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([blockName, typeMap]) => {
        const allInBlock = Array.from(typeMap.values()).flat();
        const blockCounts = { Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
        allInBlock.forEach((s) => { blockCounts[s.Status] += 1; });
        const types = Array.from(typeMap.entries())
          .sort(([a], [b]) => naturalCompare(a, b))
          .map(([t, list]) => {
            const sorted = [...list].sort((x, y) => naturalCompare(x.SlotNo, y.SlotNo));
            return {
              type: t,
              list: sorted,
              free: sorted.filter((s) => s.Status === "Available").length,
            };
          });
        return {
          blockName,
          total: allInBlock.length,
          blockCounts,
          types,
        };
      });
  }, [filteredSlots]);

  const forSaleCount = Math.max(0, counts.all - counts.Blocked);
  const occupiedPct = forSaleCount > 0 ? Math.round((counts.Booked / forSaleCount) * 100) : 0;
  const canSell = rights.canEdit;
  const canHold = rights.canCreate;

  const onTile = (s: MatrixSlot) => {
    if (s.Status === "OnHold" || s.Status === "Booked") return setInfoSlot(s);
    if (s.Status !== "Available") return;
    if (canSell && canHold) setChoiceSlot(s);
    else if (canSell) setSellSlot(s);
    else if (canHold) setHoldSlot(s);
  };

  const tileTitle = (s: MatrixSlot) => {
    if (s.Status === "Blocked") return "Blocked — not for sale";
    if (s.Status === "Available") {
      if (!canSell && !canHold) return "You don't have permission to sell or hold slots.";
      return canSell && canHold ? "Click to sell now or place a hold" : canSell ? "Click to sell standalone" : "Click to place hold";
    }
    const cust = s.HoldApplicantName || s.ApplicantName;
    return [s.SlotNo, slotPrimaryState(s), cust ? asName(cust) : null].filter(Boolean).join(" · ");
  };

  // ── High-Scale Table Columns (zero money columns on grid) ──────────────────
  const tableCols: GridCol<MatrixSlot>[] = useMemo(() => [
    {
      id: "slot",
      label: "Slot No.",
      sortKey: "SlotNo",
      locked: true,
      csv: (s) => s.SlotNo,
      cell: (s) => (
        <div className="min-w-0 leading-tight flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-muted/60 border border-border flex items-center justify-center shrink-0 text-muted-foreground">
            <ParkingTypeIcon type={s.ParkingType} size={12} />
          </span>
          <div className="min-w-0">
            <div className="text-[0.8125rem] font-semibold text-foreground tabular-nums">{s.SlotNo}</div>
            <div className="text-[0.6875rem] text-muted-foreground">{s.ParkingType || "Parking"}</div>
          </div>
        </div>
      ),
    },
    {
      id: "block",
      label: "Block",
      sortKey: "BlockName",
      csv: (s) => s.BlockName || "General",
      cell: (s) => <span className="text-xs text-foreground">{s.BlockName || "General"}</span>,
    },
    {
      id: "mode",
      label: "Allocation",
      sortKey: "Mode",
      csv: (s) => slotAllocationMode(s),
      cell: (s) => {
        const mode = slotAllocationMode(s);
        if (mode === "—") return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium",
            mode === "Standalone" ? TONE_PRIMARY_PILL : "border-border bg-muted/40 text-foreground",
          )}>
            {mode}
          </span>
        );
      },
    },
    {
      id: "status",
      label: "Status",
      sortKey: "Status",
      csv: (s) => slotPrimaryState(s),
      cell: (s) => {
        if (s.Status === "Booked") {
          return (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Sold
            </span>
          );
        }
        if (s.Status === "OnHold") {
          return (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_AMBER_PILL)}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {slotPrimaryState(s)}
            </span>
          );
        }
        if (s.Status === "Blocked") {
          return (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              Blocked
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[0.6875rem] font-medium text-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Free
          </span>
        );
      },
    },
    {
      id: "customer",
      label: "Customer / Holder",
      sortKey: "Customer",
      csv: (s) => (s.Status === "OnHold" ? s.HoldApplicantName || s.ApplicantName : s.ApplicantName) || "",
      cell: (s) => {
        const name = s.Status === "OnHold" ? s.HoldApplicantName || s.ApplicantName : s.ApplicantName;
        const mob = s.Status === "OnHold" ? s.HoldMobile || s.Mobile : s.Mobile;
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
      csv: (s) => s.BookingNo || s.HoldApplicationNo || s.ApplicationNo || "",
      cell: (s) => {
        const bNo = s.BookingNo;
        const aNo = s.HoldApplicationNo || s.ApplicationNo;
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
      id: "allotted",
      label: "Allotted On",
      sortKey: "AllotmentDate",
      csv: (s) => (s.AllotmentDate ? String(s.AllotmentDate).slice(0, 10) : ""),
      cell: (s) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {s.AllotmentDate ? String(s.AllotmentDate).slice(0, 10) : "—"}
        </span>
      ),
    },
  ], []);

  const [tablePrefs, setTablePrefs] = useGridPrefs("crm-parking-matrix-grid-v2", tableCols);

  const sortedTableRows = useMemo(() => {
    const dir = sort.dir === "desc" ? -1 : 1;
    const list = [...filteredSlots];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "BlockName": cmp = naturalCompare(a.BlockName || "", b.BlockName || ""); break;
        case "Mode": cmp = naturalCompare(slotAllocationMode(a), slotAllocationMode(b)); break;
        case "Status": cmp = naturalCompare(slotPrimaryState(a), slotPrimaryState(b)); break;
        case "Customer": cmp = naturalCompare(a.HoldApplicantName || a.ApplicantName || "", b.HoldApplicantName || b.ApplicantName || ""); break;
        case "BookingNo": cmp = naturalCompare(a.BookingNo || a.HoldApplicationNo || a.ApplicationNo || "", b.BookingNo || b.HoldApplicationNo || b.ApplicationNo || ""); break;
        case "AllotmentDate": cmp = naturalCompare(a.AllotmentDate || "", b.AllotmentDate || ""); break;
        default: cmp = naturalCompare(a.SlotNo, b.SlotNo);
      }
      return cmp * dir;
    });
    return list;
  }, [filteredSlots, sort]);

  const pagedTableRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedTableRows.slice(start, start + pageSize);
  }, [sortedTableRows, page, pageSize]);

  const tabs = useMemo(() => [
    { key: "all" as StatusTab, label: "All Slots", count: counts.all },
    { key: "Available" as StatusTab, label: "Free", count: counts.Available },
    { key: "OnHold" as StatusTab, label: "On Hold", count: counts.OnHold },
    { key: "Booked" as StatusTab, label: "Sold", count: counts.Booked },
    { key: "Blocked" as StatusTab, label: "Blocked", count: counts.Blocked },
  ], [counts]);

  const hasFilters = !!(search || typeFilter !== "all" || statusTab !== "all");
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setTypeFilter("all");
    setStatusTab("all");
    setPage(1);
  };

  const anyExpanded = grouped.some((g) => !collapsedBlocks[g.blockName]);
  const toggleAllBlocks = () => {
    if (anyExpanded) {
      const next: Record<string, boolean> = {};
      grouped.forEach((g) => { next[g.blockName] = true; });
      setCollapsedBlocks(next);
    } else {
      setCollapsedBlocks({});
    }
  };

  return (
    <>
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "CRM", path: "/crm/dashboard" }, { label: "Parking Matrix", path: "/crm/parking-matrix" }]} />

        {/* Enterprise Header Card */}
        <section className="rounded-xl border border-border bg-card px-5 py-4 shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Car size={13} className="text-primary" />
                <span>CRM · Parking Inventory</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[0.6875rem]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live sync
                </span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground mt-0.5">Parking Matrix</h1>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-[84ch]">
                Slot availability across blocks and parking types. Click any free slot to sell or hold, or inspect occupied slots.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {projectId && (
                <button
                  type="button"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className={cn(GRID_KEY, "h-9 w-9 !px-0")}
                  title="Refresh parking matrix"
                  aria-label="Refresh parking matrix"
                >
                  <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
                </button>
              )}
              {projectId && filteredSlots.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    exportGrid(sortedTableRows, tableCols, `parking-matrix-project-${projectId}.csv`);
                    toast.success(`Exported ${sortedTableRows.length} parking slots`);
                  }}
                  className={GRID_BTN}
                >
                  <Download size={13} />
                  <span>Export CSV</span>
                </button>
              )}
              <button type="button" onClick={() => navigate("/crm/parking-booking")} className={GRID_BTN}>
                <Wallet size={13} />
                <span className="hidden sm:inline">Parking Bookings</span>
              </button>
              <button type="button" onClick={() => navigate("/crm/setup/parking-master")} className={GRID_BTN}>
                <Car size={13} />
                <span className="hidden sm:inline">Parking Rates</span>
              </button>
              <button type="button" onClick={() => navigate("/crm/setup/parking-slot-master")} className={GRID_BTN}>
                <Grid3X3 size={13} />
                <span className="hidden sm:inline">Parking Slots</span>
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
              label="Parking slot availability"
              end={counts.all > 0 ? (
                <div className="hidden md:flex items-center gap-2.5 pr-1 text-xs">
                  <span className="text-muted-foreground tabular-nums">
                    <span className={cn("font-semibold", TONE_EMERALD_TEXT)}>{occupiedPct}% sold</span>
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

          {/* Filter & View Controls Bar */}
          <div className="px-4 py-3 border-b border-border bg-card flex flex-wrap items-center gap-2.5">
            <div className="w-full sm:w-60">
              <SearchableSelect
                value={projectId}
                onChange={(v) => { setProjectId(v); setBlockId(""); setTypeFilter("all"); setPage(1); }}
                placeholder={loadingProjects ? "Loading projects…" : projects.length ? "Select project…" : "No project accessible"}
                searchPlaceholder="Search projects…"
                options={projects.map((p) => ({ value: String(p.Id), label: p.Name }))}
              />
            </div>

            <div className="w-full sm:w-44">
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
                  placeholder="Search slot, customer, booking, app…"
                />

                {/* Quick Parking Type pills when multiple types exist */}
                {parkingTypes.length > 1 && (
                  <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
                    <button
                      type="button"
                      onClick={() => { setTypeFilter("all"); setPage(1); }}
                      className={cn(
                        "h-7 px-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
                        typeFilter === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      All types
                    </button>
                    {parkingTypes.map((pt) => (
                      <button
                        key={pt.type}
                        type="button"
                        onClick={() => { setTypeFilter((cur) => (cur === pt.type ? "all" : pt.type)); setPage(1); }}
                        className={cn(
                          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
                          typeFilter === pt.type ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <ParkingTypeIcon type={pt.type} size={12} />
                        <span>{pt.type}</span>
                        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{pt.free}</span>
                      </button>
                    ))}
                  </div>
                )}

                {hasFilters && (
                  <button type="button" onClick={clearFilters} className={GRID_BTN}>
                    Clear
                  </button>
                )}

                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  {viewMode === "matrix" && grouped.length > 1 && (
                    <button type="button" onClick={toggleAllBlocks} className={GRID_BTN}>
                      {anyExpanded ? "Collapse all" : "Expand all"}
                    </button>
                  )}
                  {viewMode === "matrix" && (
                    <button
                      type="button"
                      onClick={() => setCompactSlots((v) => !v)}
                      className={GRID_BTN}
                      title="Toggle compact number chips or detailed slot cards"
                    >
                      <span>{compactSlots ? "Detailed slots" : "Compact slots"}</span>
                    </button>
                  )}
                  {viewMode === "table" && (
                    <GridColumnChooser cols={tableCols} prefs={tablePrefs} onChange={setTablePrefs} />
                  )}

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
              <Car size={28} className="mx-auto text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">Select a project</p>
              <p className="text-xs text-muted-foreground">Choose a project above to load its parking slots by block and type.</p>
            </div>
          ) : isError ? (
            <div role="alert" className="py-14 px-4 text-center space-y-2">
              <p className="text-sm text-destructive">{translateError((error as Error)?.message || "Could not load parking matrix.")}</p>
              <button type="button" onClick={() => refetch()} className={GRID_BTN}>Try again</button>
            </div>
          ) : viewMode === "table" ? (
            <CrmGrid
              cols={tableCols}
              prefs={tablePrefs}
              onPrefs={setTablePrefs}
              rows={pagedTableRows}
              rowKey={(s) => s.Id}
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
              empty={hasFilters ? "No parking slots match these filters." : "No parking slots in this selection."}
              mobileCardRenderer={(s) => (
                <div
                  onClick={() => onTile(s)}
                  className="rounded-lg border border-border bg-card p-3.5 space-y-2 cursor-pointer hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground tabular-nums">{s.SlotNo}</div>
                      <div className="text-xs text-muted-foreground">
                        {[s.ParkingType, s.BlockName || "General"].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span className={cn(
                      "rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium shrink-0",
                      s.Status === "Booked" ? TONE_EMERALD_PILL : s.Status === "OnHold" ? TONE_AMBER_PILL : "border-border bg-card text-foreground",
                    )}>
                      {slotPrimaryState(s)}
                    </span>
                  </div>
                  {(s.HoldApplicantName || s.ApplicantName) && (
                    <div className="text-xs text-foreground capitalize">
                      {asName(s.HoldApplicantName || s.ApplicantName)}
                    </div>
                  )}
                </div>
              )}
            />
          ) : (
            <div className="p-4 space-y-4">
              {slots.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm border border-border border-l-2 border-l-emerald-500/50 bg-card inline-block" />
                      Free <strong className="text-foreground tabular-nums">{counts.Available}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm border border-amber-500/45 border-l-2 border-l-amber-500 bg-amber-500/15 inline-block" />
                      On Hold / Pending <strong className="text-foreground tabular-nums">{counts.OnHold}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm border border-emerald-500/40 border-l-2 border-l-emerald-500 bg-emerald-500/15 inline-block" />
                      Sold <strong className="text-foreground tabular-nums">{counts.Booked}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-border bg-muted/60 inline-block" />
                      Blocked <strong className="text-foreground tabular-nums">{counts.Blocked}</strong>
                    </span>
                  </div>
                  <span className="text-[0.6875rem] tabular-nums">
                    Showing {filteredSlots.length.toLocaleString("en-IN")} of {slots.length.toLocaleString("en-IN")} slots across {grouped.length} block{grouped.length === 1 ? "" : "s"}
                  </span>
                </div>
              )}

              {isLoading ? (
                <div className="py-16 text-center text-sm text-muted-foreground">Loading parking inventory…</div>
              ) : filteredSlots.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {hasFilters ? "No parking slots match these filters." : "No parking slots found in this project. Add them in Parking Slots."}
                  </p>
                  {hasFilters && (
                    <button type="button" onClick={clearFilters} className={GRID_BTN}>Reset filters</button>
                  )}
                </div>
              ) : (
                grouped.map(({ blockName, total: bTotal, blockCounts, types }) => {
                  const collapsed = !!collapsedBlocks[blockName];
                  const bSellable = Math.max(0, bTotal - blockCounts.Blocked);
                  const bookedPct = bSellable ? Math.round((blockCounts.Booked / bSellable) * 100) : 0;
                  const holdPct = bSellable ? Math.round((blockCounts.OnHold / bSellable) * 100) : 0;

                  return (
                    <section key={blockName} className="rounded-xl border border-border bg-card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setCollapsedBlocks((prev) => ({ ...prev, [blockName]: !prev[blockName] }))}
                        className="w-full px-4 py-2.5 border-b border-border bg-muted/25 hover:bg-muted/40 transition-colors flex flex-wrap items-center justify-between gap-3 text-left"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {collapsed ? <ChevronRight size={15} className="text-muted-foreground shrink-0" /> : <ChevronDown size={15} className="text-muted-foreground shrink-0" />}
                          <span className="text-sm font-semibold text-foreground">{blockName}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground tabular-nums">
                            {bTotal} {bTotal === 1 ? "slot" : "slots"}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                          <span className={TONE_EMERALD_TEXT}>{blockCounts.Booked} sold</span>
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
                          {types.map(({ type, list, free }) => (
                            <div key={type} className="p-3.5 space-y-2.5">
                              {/* Clean inline Parking Type header */}
                              <div className="flex items-center justify-between gap-2 px-0.5">
                                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                  <ParkingTypeIcon type={type} size={13} className="text-primary" />
                                  <span>{type}</span>
                                </div>
                                <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                                  {free} / {list.length} free
                                </span>
                              </div>

                              {/* High-density Parking Stall Grid */}
                              <div className={cn(
                                "grid gap-2",
                                compactSlots
                                  ? "grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12"
                                  : "grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10",
                              )}>
                                {list.map((s) => {
                                  const clickable = s.Status === "OnHold" || s.Status === "Booked" || (s.Status === "Available" && (canSell || canHold));
                                  const holdBadge = s.Status === "OnHold" ? fmtHoldRemaining(s.HoldUntil) : null;
                                  const customerName = s.Status === "Booked"
                                    ? (s.ApplicantName || s.BookingNo || "Sold")
                                    : s.Status === "OnHold"
                                      ? (s.HoldApplicantName || s.ApplicantName || (s.AllotmentId != null ? "Payment pending" : "On hold"))
                                      : s.Status === "Blocked"
                                        ? "Blocked"
                                        : "Free";

                                  const statusHint = s.Status === "OnHold"
                                    ? (s.AllotmentId != null ? "Pending" : holdBadge || "Hold")
                                    : s.Status === "Booked"
                                      ? "Sold"
                                      : null;

                                  return (
                                    <button
                                      key={s.Id}
                                      type="button"
                                      onClick={() => clickable && onTile(s)}
                                      disabled={!clickable}
                                      title={tileTitle(s)}
                                      className={cn(
                                        "group text-left rounded-lg border transition-all min-w-0",
                                        compactSlots ? "px-2 py-1.5" : "px-2.5 py-2 border-l-[3px]",
                                        s.Status === "Available" && "border-border border-l-emerald-500/45 bg-card hover:border-emerald-500/55 hover:border-l-emerald-500 hover:bg-emerald-500/[0.06]",
                                        s.Status === "OnHold" && "border-amber-500/45 border-l-amber-500 bg-amber-500/[0.09] hover:border-amber-500/80",
                                        s.Status === "Booked" && "border-emerald-500/40 border-l-emerald-500 bg-emerald-500/[0.09] hover:border-emerald-500/75",
                                        s.Status === "Blocked" && "border-dashed border-border bg-muted/40 opacity-60",
                                        clickable ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" : "cursor-default",
                                      )}
                                    >
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="inline-flex items-center gap-1 min-w-0">
                                          <span className={cn(
                                            "w-1.5 h-1.5 rounded-full shrink-0",
                                            s.Status === "Booked" ? "bg-emerald-500"
                                              : s.Status === "OnHold" ? "bg-amber-500"
                                                : s.Status === "Blocked" ? "bg-muted-foreground/50"
                                                  : "bg-emerald-500/50 group-hover:bg-emerald-500",
                                          )} />
                                          <span className="text-xs font-bold text-foreground truncate tabular-nums">
                                            {s.SlotNo}
                                          </span>
                                        </span>

                                        {!compactSlots && (
                                          s.Status === "Blocked" ? (
                                            <Lock size={10} className="text-muted-foreground shrink-0" />
                                          ) : statusHint ? (
                                            <span className={cn(
                                              "shrink-0 text-[0.5625rem] font-semibold uppercase tracking-wide",
                                              s.Status === "Booked" ? TONE_EMERALD_TEXT : TONE_AMBER_TEXT,
                                            )}>
                                              {statusHint}
                                            </span>
                                          ) : null
                                        )}
                                      </div>

                                      {!compactSlots && (
                                        <div className={cn(
                                          "mt-1 text-[0.6875rem] truncate",
                                          s.Status === "Booked" || s.Status === "OnHold"
                                            ? "text-foreground/90 font-medium capitalize"
                                            : "text-muted-foreground",
                                        )}>
                                          {s.Status === "Booked" || s.Status === "OnHold" ? asName(customerName) : customerName}
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
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

      {choiceSlot && (
        <SlotActionDialog
          slot={choiceSlot}
          onSell={() => { setSellSlot(choiceSlot); setChoiceSlot(null); }}
          onHold={() => { setHoldSlot(choiceSlot); setChoiceSlot(null); }}
          onClose={() => setChoiceSlot(null)}
        />
      )}
      {sellSlot && <SellDialog slot={sellSlot} projectId={projectId} onClose={() => setSellSlot(null)} />}
      {holdSlot && (
        <ModernPlaceHoldDialog
          entityType="Parking"
          entityId={holdSlot.Id}
          label={`slot ${holdSlot.SlotNo}`}
          subtitle={[holdSlot.ParkingType, holdSlot.BlockName].filter(Boolean).join(" · ")}
          projectId={projectId}
          canPlace={canHold}
          onDone={() => qc.invalidateQueries({ queryKey: ["parking-matrix"] })}
          onClose={() => setHoldSlot(null)}
        />
      )}
      {infoSlot && <TileInfoDialog slot={infoSlot} onClose={() => setInfoSlot(null)} />}
    </>
  );
}

export default ParkingMatrixPage;
