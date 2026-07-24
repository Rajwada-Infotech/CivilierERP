import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Grid3x3, Layers, Clock, User, FileText, Building2, IndianRupee, CalendarClock, CheckCircle2 } from "lucide-react";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/unit-matrix";
const APP_API = "/api/crm/applications";
const HOLDS_API = "/api/crm/holds";

interface Option {
  Id: number;
  Name: string;
}

interface MatrixUnit {
  Id: number;
  UnitName: string;
  FloorNo: number | null;
  BlockId: number | null;
  BlockName: string | null;
  Status: "Available" | "Booked" | "OnHold" | "Blocked";
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
}

const STATUS_STYLE: Record<string, string> = {
  Available: "bg-emerald-500/15 text-emerald-600 border border-emerald-400/30",
  Booked: "bg-rose-500/15 text-rose-600 border border-rose-400/30",
  OnHold: "bg-amber-500/15 text-amber-600 border border-amber-400/30",
  Blocked: "bg-muted text-muted-foreground border border-border",
};
const BOOKING_STATUS_STYLE: Record<string, string> = {
  Pending: "text-amber-600 bg-amber-50 border-amber-200",
  Approved: "text-emerald-600 bg-emerald-50 border-emerald-200",
  Rejected: "text-red-600 bg-red-50 border-red-200",
  Cancelled: "text-muted-foreground bg-muted/50 border-border",
};
const fmtMoney = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchOptions<T>(url: string): Promise<T[]> {
  const res = await fetchWithAuth(url);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

async function fetchMatrix(projectId: string, blockId: string): Promise<MatrixUnit[]> {
  const params = new URLSearchParams({ projectId });
  if (blockId) params.set("blockId", blockId);
  const res = await fetchWithAuth(`${API}?${params}`);
  if (!res.ok) throw new Error("Failed to load unit matrix");
  return res.json();
}

const NONE = "__none__";

// Hour/minute-precision countdown — HoldUntil is a real DATETIME2(3), so a
// 72-hour auto-hold can show "68h 42m left" instead of a coarse day count
// that would sit at "3 days" for most of its life and jump straight to "0".
function timeLeft(until: string): string {
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return "Overdue";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}
function isOverdue(until: string | null): boolean {
  return !!until && new Date(until).getTime() - Date.now() <= 0;
}

// Available unit -> ask who it's being held for and for how long. Booking
// itself still happens through the normal Application -> Booking flow; this
// only reserves the unit against the matrix so no one else can book it
// while the customer decides.
function PlaceHoldDialog({ unit, projectId, onClose }: { unit: MatrixUnit; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [applicationId, setApplicationId] = useState("");
  const [holdDays, setHoldDays] = useState("3");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: allApps = [] } = useQuery({
    queryKey: ["crm-applications-for-hold"],
    queryFn: () => fetchOptions<any>(APP_API),
  });
  // Scoped to this unit's own Project — the backend now rejects a
  // cross-project hold outright, but showing every Application system-wide
  // here made that mismatch trivial to create by accident in the first
  // place. Same project match the matrix page itself already filters by.
  const apps = useMemo(
    () => (allApps as any[]).filter((a: any) => String(a.ProjectId) === projectId),
    [allApps, projectId]
  );

  const handlePlace = async () => {
    if (!applicationId) { toast.error("Select a customer"); return; }
    const days = parseInt(holdDays);
    if (!Number.isFinite(days) || days < 1) { toast.error("Enter a valid number of days"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(HOLDS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ EntityType: "Unit", EntityId: unit.Id, ApplicationId: parseInt(applicationId), HoldDays: days, Reason: reason || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Unit ${unit.UnitName} held for ${days} day(s)`);
      qc.invalidateQueries({ queryKey: ["unit-matrix"] });
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-heading">Hold Unit {unit.UnitName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Customer (Application) *</label>
            <select value={applicationId} onChange={(e) => setApplicationId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select customer</option>
              {apps.map((a: any) => (
                <option key={a.Id} value={String(a.Id)}>{a.ApplicationNo} — {a.ApplicantName} ({a.Mobile})</option>
              ))}
            </select>
            {apps.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">No open Applications for this Project yet — only Applications for the same Project as this unit can hold it.</p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Hold for how many days? *</label>
            <input type="number" min={1} max={90} value={holdDays} onChange={(e) => setHoldDays(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            <p className="text-[11px] text-muted-foreground mt-1">Auto-reverts to Available once this expires — a daily reminder goes to both sides until then.</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Reason (optional)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          <button onClick={handlePlace} disabled={saving}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Placing..." : "Place Hold"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Shared detail dialog for tapping any non-Available tile. Booked shows the
// booking record + a link into it. OnHold covers two distinct situations
// that both render as the same tile color: a pure Application-stage hold
// (no Booking yet — Release Hold is the only action), or a real Booking that
// exists but whose booking-amount milestone isn't Paid yet (Extend Hold /
// Cancel Booking, since the customer already committed and there's a real
// record to manage, not just a reservation to drop). Both show who's
// holding/booked it and which salesperson (AssignedTo) owns that
// Application, so a tap always answers "who, what, and via which record"
// instead of just the bare status label.
function TileInfoDialog({ unit, onClose }: { unit: MatrixUnit; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [releasing, setReleasing] = useState(false);
  const [extending, setExtending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [extendDays, setExtendDays] = useState("3");
  const [showExtend, setShowExtend] = useState(false);
  const isHold = unit.Status === "OnHold";
  const hasUnpaidBooking = isHold && !!unit.BookingId;
  const overdue = isHold && isOverdue(unit.HoldUntil);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["unit-matrix"] });

  const handleRelease = async () => {
    setReleasing(true);
    try {
      const res = await fetchWithAuth(`${HOLDS_API}/${unit.HoldId}/release`, { method: "PUT" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`Hold released — ${unit.UnitName} is Available again`);
      invalidate();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setReleasing(false);
    }
  };

  const handleExtend = async () => {
    const days = parseInt(extendDays);
    if (!Number.isFinite(days) || days < 1) { toast.error("Enter a valid number of days"); return; }
    setExtending(true);
    try {
      const res = await fetchWithAuth(`${HOLDS_API}/${unit.HoldId}/extend`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AdditionalDays: days }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`Hold extended by ${days} day(s)`);
      invalidate();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setExtending(false);
    }
  };

  // Only reachable while the Booking is still Pending (its own approval step
  // hasn't happened yet) — matches PUT /:id/reject's own transition rule.
  // An Approved-but-unpaid booking needs the fuller cancellation flow on the
  // Bookings page, not a shortcut from here.
  const handleCancelBooking = async () => {
    if (!unit.BookingId) return;
    setCancelling(true);
    try {
      const res = await fetchWithAuth(`/api/crm/bookings/${unit.BookingId}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Remarks: "Cancelled from Unit Matrix — booking amount was never paid" }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`Booking cancelled — ${unit.UnitName} is free again`);
      invalidate();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCancelling(false);
    }
  };

  const appNo = (isHold && unit.HoldApplicationNo) || unit.ApplicationNo;
  const applicantName = (isHold && unit.HoldApplicantName) || unit.ApplicantName;
  const mobile = (isHold && unit.HoldMobile) || unit.Mobile;
  const assignedName = (isHold && unit.HoldAssignedToName) || unit.AssignedToName;
  const assignedEmail = (isHold && unit.HoldAssignedToEmail) || unit.AssignedToEmail;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Building2 size={18} className="text-primary" />
            Unit {unit.UnitName}
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${overdue ? "bg-rose-500/15 text-rose-600 border-rose-400/30" : STATUS_STYLE[isHold ? "OnHold" : "Booked"]}`}>
              {isHold ? (hasUnpaidBooking ? "Booked — Payment Pending" : overdue ? "Hold Overdue" : "On Hold") : "Booked"}
            </span>
          </DialogTitle>
        </DialogHeader>

        {unit.BlockName && (
          <p className="text-xs text-muted-foreground -mt-2">{unit.BlockName}{unit.FloorNo != null ? ` · Floor ${unit.FloorNo}` : ""}{unit.AreaSqFt ? ` · ${unit.AreaSqFt} sqft` : ""}</p>
        )}

        <div className="rounded-xl border border-border p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><FileText size={14} className="text-primary" /> Application & Customer</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div><span className="text-muted-foreground block">Application No</span><span className="font-semibold text-sm">{appNo || "—"}</span></div>
            <div><span className="text-muted-foreground block">Applicant</span><span className="font-semibold text-sm">{applicantName || "—"}</span></div>
            <div><span className="text-muted-foreground block">Mobile</span><span className="font-medium">{mobile || "—"}</span></div>
            <div>
              <span className="text-muted-foreground flex items-center gap-1"><User size={11} /> Salesperson</span>
              <span className="font-medium">{assignedName || "—"}</span>
              {assignedEmail && <span className="block text-[11px] text-muted-foreground">{assignedEmail}</span>}
            </div>
          </div>
        </div>

        {isHold ? (
          <div className={`rounded-xl border p-4 space-y-2 ${overdue ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
            <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${overdue ? "text-rose-800" : "text-amber-800"}`}>
              <Clock size={14} /> Hold Status
            </h3>
            <div className="flex items-center justify-between text-xs">
              <span className={overdue ? "text-rose-700" : "text-amber-700"}>{overdue ? "Overdue since" : "Expires in"}</span>
              <span className={`font-bold text-sm ${overdue ? "text-rose-700" : "text-amber-700"}`}>{unit.HoldUntil ? timeLeft(unit.HoldUntil) : "—"}</span>
            </div>
            {hasUnpaidBooking && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pt-1 border-t border-current/10">
                <div><span className="text-muted-foreground block">Booking No</span><span className="font-semibold">{unit.BookingNo || "—"}</span></div>
                <div>
                  <span className="text-muted-foreground block">Status</span>
                  <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${BOOKING_STATUS_STYLE[unit.BookingStatus || ""] || ""}`}>
                    {unit.BookingStatus || "—"}
                  </span>
                </div>
              </div>
            )}
            {hasUnpaidBooking && (
              <p className="text-[11px] text-amber-700 bg-amber-100/60 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-1.5">
                <CheckCircle2 size={12} className="shrink-0" /> Booking amount not yet paid — this tile flips to Booked automatically once it's received.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-600" /> Booking</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><span className="text-muted-foreground block">Booking No</span><span className="font-semibold text-sm">{unit.BookingNo || "—"}</span></div>
              <div>
                <span className="text-muted-foreground block">Status</span>
                <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${BOOKING_STATUS_STYLE[unit.BookingStatus || ""] || ""}`}>
                  {unit.BookingStatus || "—"}
                </span>
              </div>
              <div className="flex items-center gap-1"><CalendarClock size={11} className="text-muted-foreground" /><span className="text-muted-foreground">Booked on</span></div>
              <div className="font-medium">{unit.BookingDate ? String(unit.BookingDate).slice(0, 10) : "—"}</div>
            </div>
          </div>
        )}

        {(unit.TotalValue != null || unit.GrandTotal != null) && (
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><IndianRupee size={14} className="text-primary" /> Financials</h3>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-muted-foreground block">Unit Value</span><span className="font-bold text-sm">{fmtMoney(unit.TotalValue)}</span></div>
              <div><span className="text-muted-foreground block">Grand Total</span><span className="font-bold text-sm">{fmtMoney(unit.GrandTotal ?? unit.TotalValue)}</span></div>
              <div><span className="text-muted-foreground block">Booking Amt</span><span className="font-bold text-sm">{fmtMoney(unit.BookingAmount)}</span></div>
            </div>
          </div>
        )}

        {showExtend && (
          <div className="rounded-lg border border-border p-2.5 flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Extend by (days)</label>
              <input type="number" min={1} max={90} value={extendDays} onChange={(e) => setExtendDays(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <button onClick={handleExtend} disabled={extending}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {extending ? "Extending..." : "Confirm"}
            </button>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-border flex-wrap">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
          {hasUnpaidBooking ? (
            <>
              {unit.BookingStatus === "Pending" && (
                <button onClick={handleCancelBooking} disabled={cancelling}
                  className="px-3 py-1.5 text-sm border border-rose-200 text-rose-600 rounded-lg font-medium hover:bg-rose-50 disabled:opacity-40">
                  {cancelling ? "Cancelling..." : "Cancel Booking"}
                </button>
              )}
              {unit.HoldId && (
                <button onClick={() => setShowExtend((s) => !s)}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg font-medium hover:bg-muted">
                  Extend Hold
                </button>
              )}
              <button onClick={() => navigate(`/crm/bookings?applicationId=${unit.ApplicationId}`)}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                Open Booking
              </button>
            </>
          ) : isHold ? (
            <button onClick={handleRelease} disabled={releasing}
              className="px-4 py-1.5 text-sm bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700 disabled:opacity-40">
              {releasing ? "Releasing..." : "Release Hold"}
            </button>
          ) : (
            <button onClick={() => navigate(`/crm/bookings?applicationId=${unit.ApplicationId}`)}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
              Open Booking
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UnitMatrixPage() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [holdTarget, setHoldTarget] = useState<MatrixUnit | null>(null);
  const [infoTarget, setInfoTarget] = useState<MatrixUnit | null>(null);

  // Forces a re-render every minute so the hold countdown badges (and any
  // open TileInfoDialog) tick down live instead of only updating on refetch.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const { data: projects = [] } = useQuery({
    queryKey: ["unit-matrix-projects"],
    queryFn: () => fetchOptions<Option>(`${API}/projects`),
  });

  const { data: blocks = [] } = useQuery({
    queryKey: ["unit-matrix-blocks", projectId],
    queryFn: () => fetchOptions<Option>(`${API}/blocks?projectId=${projectId}`),
    enabled: !!projectId,
  });

  const { data: units = [], isLoading } = useQuery({
    queryKey: ["unit-matrix", projectId, blockId],
    queryFn: () => fetchMatrix(projectId, blockId),
    enabled: !!projectId,
  });

  const grouped = useMemo(() => {
    const byFloor = new Map<string, MatrixUnit[]>();
    for (const u of units) {
      const key = u.FloorNo != null ? `Floor ${u.FloorNo}` : "Floor —";
      if (!byFloor.has(key)) byFloor.set(key, []);
      byFloor.get(key)!.push(u);
    }
    return Array.from(byFloor.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [units]);

  const stats = useMemo(() => {
    const total = units.length;
    const available = units.filter((u) => u.Status === "Available").length;
    const booked = units.filter((u) => u.Status === "Booked").length;
    const onHold = units.filter((u) => u.Status === "OnHold").length;
    const blocked = units.filter((u) => u.Status === "Blocked").length;
    return { total, available, booked, onHold, blocked };
  }, [units]);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "CRM", path: "/crm/dashboard" },
          { label: "Unit Matrix", path: "/crm/unit-matrix" },
        ]}
      />
      <FollowupShell
        title="Unit Matrix"
        icon={Grid3x3}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/crm/setup/unit-master")}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-sm font-medium rounded-lg hover:bg-muted transition-colors"
            >
              <Layers size={14} /> Unit Master
            </button>
            <button
              onClick={() => navigate("/crm/setup/block-master")}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-sm font-medium rounded-lg hover:bg-muted transition-colors"
            >
              <Layers size={14} /> Block Master
            </button>
          </div>
        }
      >
        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="min-w-56 space-y-1.5">
            <label className="text-xs text-muted-foreground">Project</label>
            <Select
              value={projectId || NONE}
              onValueChange={(v) => {
                setProjectId(v === NONE ? "" : v);
                setBlockId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.Id} value={String(p.Id)}>
                    {p.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48 space-y-1.5">
            <label className="text-xs text-muted-foreground">Block</label>
            <Select
              value={blockId || NONE}
              onValueChange={(v) => setBlockId(v === NONE ? "" : v)}
              disabled={!projectId}
            >
              <SelectTrigger>
                <SelectValue placeholder="All blocks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All blocks</SelectItem>
                {blocks.map((b) => (
                  <SelectItem key={b.Id} value={String(b.Id)}>
                    {b.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!projectId ? (
          <div className="py-20 text-center text-muted-foreground text-sm">
            Select a project to view its unit matrix
          </div>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Total Units", value: stats.total, dot: "bg-blue-400" },
                { label: "Available", value: stats.available, dot: "bg-emerald-500" },
                { label: "On Hold", value: stats.onHold, dot: "bg-amber-500" },
                { label: "Booked", value: stats.booked, dot: "bg-rose-500" },
                { label: "Blocked", value: stats.blocked, dot: "bg-muted-foreground" },
              ].map(({ label, value, dot }) => (
                <div key={label} className="rounded-xl border border-border bg-card p-4">
                  <div className={`w-2 h-2 rounded-full ${dot} mb-3`} />
                  <p className="text-2xl font-bold font-heading text-foreground leading-none">{value}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
                </div>
              ))}
            </div>

            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground text-sm">Loading matrix...</div>
            ) : units.length === 0 ? (
              <div className="py-20 text-center text-muted-foreground text-sm">No units found for this selection</div>
            ) : (
              <div className="space-y-6">
                {grouped.map(([floor, floorUnits]) => (
                  <div key={floor}>
                    <div className="flex items-center gap-2 mb-2.5 text-sm font-semibold text-foreground">
                      <Layers size={14} className="text-muted-foreground" />
                      {floor}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {floorUnits.map((u) => (
                        <button
                          key={u.Id}
                          onClick={() => {
                            if (u.Status === "Available") setHoldTarget(u);
                            else if (u.Status === "OnHold" || u.Status === "Booked") setInfoTarget(u);
                          }}
                          disabled={u.Status === "Blocked"}
                          className={`text-left bg-card border border-border rounded-xl p-3.5 transition-colors ${
                            u.Status !== "Blocked" ? "hover:border-primary/50 hover:shadow-sm cursor-pointer" : "cursor-default opacity-90"
                          }`}
                          title={u.BlockName ? `${u.BlockName} — ${u.UnitName}` : u.UnitName}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="font-bold text-sm text-foreground truncate">{u.UnitName}</span>
                            <span
                              className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                                u.Status === "OnHold" && isOverdue(u.HoldUntil) ? "bg-rose-500/15 text-rose-600 border border-rose-400/30" : STATUS_STYLE[u.Status]
                              }`}
                            >
                              {u.Status === "OnHold" ? (isOverdue(u.HoldUntil) ? "Overdue" : "Hold") : u.Status}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                            {u.Status === "Booked" ? (u.ApplicantName || u.BookingNo || "—")
                              : u.Status === "OnHold" ? (
                                <>
                                  <Clock size={11} className="shrink-0" />
                                  {(u.HoldApplicantName || u.ApplicantName)} · {u.HoldUntil ? timeLeft(u.HoldUntil) : ""}
                                </>
                              ) : "—"}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </FollowupShell>

      {holdTarget && <PlaceHoldDialog unit={holdTarget} projectId={projectId} onClose={() => setHoldTarget(null)} />}
      {infoTarget && <TileInfoDialog unit={infoTarget} onClose={() => setInfoTarget(null)} />}
    </>
  );
}

export default UnitMatrixPage;
