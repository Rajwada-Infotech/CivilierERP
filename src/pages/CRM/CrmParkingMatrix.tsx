import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Car, Clock, User, FileText } from "lucide-react";

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

const API = "/api/parking-matrix";
const RATE_API = "/api/parking-master/rate";
const APP_API = "/api/crm/applications";
const HOLDS_API = "/api/crm/holds";

interface Option {
  Id: number;
  Name: string;
}

interface MatrixSlot {
  Id: number;
  SlotNo: string;
  ParkingType: string;
  BlockId: number | null;
  BlockName: string | null;
  Status: "Available" | "Booked" | "OnHold" | "Blocked";
  AllotmentId: number | null;
  BookingId: number | null;
  BookingNo: string | null;
  AllotmentDate: string | null;
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

async function fetchOptions<T>(url: string): Promise<T[]> {
  const res = await fetchWithAuth(url);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

async function fetchMatrix(projectId: string, blockId: string): Promise<MatrixSlot[]> {
  const params = new URLSearchParams({ projectId });
  if (blockId) params.set("blockId", blockId);
  const res = await fetchWithAuth(`${API}?${params}`);
  if (!res.ok) throw new Error("Failed to load parking matrix");
  return res.json();
}

const NONE = "__none__";

// Hour/minute-precision countdown — mirrors CrmUnitMatrix.tsx's timeLeft().
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

// Available slot -> choose whether to sell it now or just hold it for a
// customer who's still deciding.
function ActionChoiceDialog({
  slot, onClose, onSell, onHold,
}: { slot: MatrixSlot; onClose: () => void; onSell: () => void; onHold: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading">Parking Slot {slot.SlotNo}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-2 pt-1">
          <button onClick={onSell} className="px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 text-left">
            Sell Now
            <span className="block text-[11px] font-normal opacity-80">Allot this slot to a customer immediately</span>
          </button>
          <button onClick={onHold} className="px-4 py-2.5 text-sm border border-border rounded-lg font-medium hover:bg-muted text-left">
            Place On Hold
            <span className="block text-[11px] font-normal text-muted-foreground">Reserve for N days while the customer decides</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Buying a parking slot never requires a unit booking — this dialog only
// asks who it's for (any Application) and how many. If that same customer
// also has a unit booking, staff can instead allot parking from the
// booking's own Charges dialog so it rides the booking's payment schedule;
// this path always creates a standalone, independently-paid sale.
function BookParkingDialog({
  slot, projectId, onClose,
}: { slot: MatrixSlot; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [applicationId, setApplicationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: apps = [] } = useQuery({
    queryKey: ["crm-applications-for-parking"],
    queryFn: () => fetchOptions<any>(APP_API),
  });

  const { data: rate } = useQuery({
    queryKey: ["parking-rate", projectId, slot.BlockId, slot.ParkingType],
    queryFn: async () => {
      const params = new URLSearchParams({ projectId, parkingType: slot.ParkingType });
      if (slot.BlockId) params.set("blockId", String(slot.BlockId));
      const r = await fetchWithAuth(`${RATE_API}?${params}`);
      return r.ok ? r.json() : null;
    },
  });

  const handleBook = async () => {
    if (!applicationId) { toast.error("Select a customer"); return; }
    if (!rate?.Id) { toast.error(`No active parking rate configured for ${slot.ParkingType} in this project/block`); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/crm/parking/standalone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApplicationId: parseInt(applicationId),
          ParkingMasterId: rate.Id,
          ParkingSlotId: slot.Id,
          Quantity: parseInt(quantity) || 1,
          Notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Parking slot ${slot.SlotNo} sold — ₹${data.TotalAmount.toLocaleString("en-IN")}`);
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
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
        <DialogHeader><DialogTitle className="font-heading">Book Parking Slot {slot.SlotNo}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-muted/30 border border-border p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium">{slot.ParkingType}</span></div>
            <div className="flex justify-between mt-1"><span className="text-muted-foreground">Rate</span>
              <span className="font-medium">{rate ? `₹${Number(rate.Charge).toLocaleString("en-IN")} + ${rate.GstRate}% GST` : "No rate configured"}</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Customer (Application) *</label>
            <select value={applicationId} onChange={(e) => setApplicationId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select customer</option>
              {(apps as any[]).map((a: any) => (
                <option key={a.Id} value={String(a.Id)}>{a.ApplicationNo} — {a.ApplicantName} ({a.Mobile})</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">This customer does not need an existing unit booking — parking can be sold on its own.</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          <button onClick={handleBook} disabled={saving}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Booking..." : "Book Slot"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlaceHoldDialog({ slot, onClose }: { slot: MatrixSlot; onClose: () => void }) {
  const qc = useQueryClient();
  const [applicationId, setApplicationId] = useState("");
  const [holdDays, setHoldDays] = useState("3");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: apps = [] } = useQuery({
    queryKey: ["crm-applications-for-parking"],
    queryFn: () => fetchOptions<any>(APP_API),
  });

  const handlePlace = async () => {
    if (!applicationId) { toast.error("Select a customer"); return; }
    const days = parseInt(holdDays);
    if (!Number.isFinite(days) || days < 1) { toast.error("Enter a valid number of days"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(HOLDS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ EntityType: "Parking", EntityId: slot.Id, ApplicationId: parseInt(applicationId), HoldDays: days, Reason: reason || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Parking slot ${slot.SlotNo} held for ${days} day(s)`);
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
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
        <DialogHeader><DialogTitle className="font-heading">Hold Parking Slot {slot.SlotNo}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Customer (Application) *</label>
            <select value={applicationId} onChange={(e) => setApplicationId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select customer</option>
              {(apps as any[]).map((a: any) => (
                <option key={a.Id} value={String(a.Id)}>{a.ApplicationNo} — {a.ApplicantName} ({a.Mobile})</option>
              ))}
            </select>
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

// Shared detail dialog for tapping any non-Available tile — mirrors
// CrmUnitMatrix.tsx's TileInfoDialog. Parking allotments can be standalone
// (sold independent of a unit booking, BookingId NULL) so the Booked path
// only offers an "Open Booking" link when one actually exists. OnHold now
// also covers "an Allotment exists but its own linked milestone isn't Paid
// yet" — Extend Hold is offered there; releasing/cancelling an unpaid
// allotment itself already has a proper flow on the booking's own Charges
// dialog (crmParking.js applyReleaseParking, gated by the same legal-work/
// amendment-queue rules as any other post-booking edit), so this dialog
// doesn't shortcut around that — it links out instead.
function TileInfoDialog({ slot, onClose }: { slot: MatrixSlot; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [releasing, setReleasing] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extendDays, setExtendDays] = useState("3");
  const [showExtend, setShowExtend] = useState(false);
  const isHold = slot.Status === "OnHold";
  const hasUnpaidAllotment = isHold && !!slot.AllotmentId;
  const overdue = isHold && isOverdue(slot.HoldUntil);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["parking-matrix"] });

  const handleRelease = async () => {
    setReleasing(true);
    try {
      const res = await fetchWithAuth(`${HOLDS_API}/${slot.HoldId}/release`, { method: "PUT" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`Hold released — slot ${slot.SlotNo} is Available again`);
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
      const res = await fetchWithAuth(`${HOLDS_API}/${slot.HoldId}/extend`, {
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

  const appNo = (isHold && slot.HoldApplicationNo) || slot.ApplicationNo;
  const applicantName = (isHold && slot.HoldApplicantName) || slot.ApplicantName;
  const mobile = (isHold && slot.HoldMobile) || slot.Mobile;
  const assignedName = (isHold && slot.HoldAssignedToName) || slot.AssignedToName;
  const assignedEmail = (isHold && slot.HoldAssignedToEmail) || slot.AssignedToEmail;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">
            Slot {slot.SlotNo} — {isHold ? (hasUnpaidAllotment ? "Booked, Payment Pending" : "On Hold") : "Booked"}
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-lg bg-muted/30 border border-border p-3 text-sm space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground flex items-center gap-1"><FileText size={12} /> Application</span>
            <span className="font-medium">{appNo || "—"}</span>
          </div>
          <div className="flex justify-between"><span className="text-muted-foreground">Applicant</span><span className="font-medium">{applicantName || "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Mobile</span><span className="font-medium">{mobile || "—"}</span></div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground flex items-center gap-1"><User size={12} /> Salesperson</span>
            <span className="font-medium text-right">{assignedName || "—"}{assignedEmail ? <span className="block text-[11px] text-muted-foreground font-normal">{assignedEmail}</span> : null}</span>
          </div>
          {hasUnpaidAllotment && (
            <div className="flex justify-between"><span className="text-muted-foreground">Booking No</span><span className="font-medium">{slot.BookingNo || "Standalone parking sale"}</span></div>
          )}
          {isHold ? (
            <div className="flex justify-between items-center pt-1 border-t border-border/60">
              <span className="text-muted-foreground">{overdue ? "Hold" : "Expires in"}</span>
              <span className={`font-medium ${overdue ? "text-rose-600" : "text-amber-600"}`}>{slot.HoldUntil ? timeLeft(slot.HoldUntil) : "—"}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between pt-1 border-t border-border/60"><span className="text-muted-foreground">Booking No</span><span className="font-medium">{slot.BookingNo || "Standalone parking sale"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Sold on</span><span className="font-medium">{slot.AllotmentDate ? String(slot.AllotmentDate).slice(0, 10) : "—"}</span></div>
            </>
          )}
          {hasUnpaidAllotment && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
              Parking charge not yet paid — this tile flips to Booked automatically once it's received.
            </p>
          )}
        </div>

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
          {hasUnpaidAllotment ? (
            <>
              {slot.HoldId && (
                <button onClick={() => setShowExtend((s) => !s)}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg font-medium hover:bg-muted">
                  Extend Hold
                </button>
              )}
              <button onClick={() => navigate(slot.BookingId ? `/crm/bookings?applicationId=${slot.ApplicationId}` : `/crm/applications`)}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                {slot.BookingId ? "Open Booking" : "Open Application"}
              </button>
            </>
          ) : isHold ? (
            <button onClick={handleRelease} disabled={releasing}
              className="px-4 py-1.5 text-sm bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700 disabled:opacity-40">
              {releasing ? "Releasing..." : "Release Hold"}
            </button>
          ) : slot.BookingId ? (
            <button onClick={() => navigate(`/crm/bookings?applicationId=${slot.ApplicationId}`)}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
              Open Booking
            </button>
          ) : (
            <button onClick={() => navigate(`/crm/applications`)}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
              Open Application
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ParkingMatrixPage() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [choiceSlot, setChoiceSlot] = useState<MatrixSlot | null>(null);
  const [sellSlot, setSellSlot] = useState<MatrixSlot | null>(null);
  const [holdSlot, setHoldSlot] = useState<MatrixSlot | null>(null);
  const [infoSlot, setInfoSlot] = useState<MatrixSlot | null>(null);

  // Forces a re-render every minute so hold countdown badges (and any open
  // TileInfoDialog) tick down live instead of only updating on refetch.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const { data: projects = [] } = useQuery({
    queryKey: ["parking-matrix-projects"],
    queryFn: () => fetchOptions<Option>(`${API}/projects`),
  });

  const { data: blocks = [] } = useQuery({
    queryKey: ["parking-matrix-blocks", projectId],
    queryFn: () => fetchOptions<Option>(`${API}/blocks?projectId=${projectId}`),
    enabled: !!projectId,
  });

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ["parking-matrix", projectId, blockId],
    queryFn: () => fetchMatrix(projectId, blockId),
    enabled: !!projectId,
  });

  const stats = useMemo(() => {
    const total = slots.length;
    const available = slots.filter((s) => s.Status === "Available").length;
    const onHold = slots.filter((s) => s.Status === "OnHold").length;
    const booked = slots.filter((s) => s.Status === "Booked").length;
    const blocked = slots.filter((s) => s.Status === "Blocked").length;
    return { total, available, onHold, booked, blocked };
  }, [slots]);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "CRM", path: "/crm/dashboard" },
          { label: "Parking Matrix", path: "/crm/parking-matrix" },
        ]}
      />
      <FollowupShell
        title="Parking Matrix"
        icon={Car}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/crm/setup/parking-master")}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-sm font-medium rounded-lg hover:bg-muted transition-colors"
            >
              <Car size={14} /> Parking Rate Master
            </button>
            <button
              onClick={() => navigate("/crm/setup/parking-slot-master")}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-sm font-medium rounded-lg hover:bg-muted transition-colors"
            >
              <Car size={14} /> Parking Slot Master
            </button>
          </div>
        }
      >
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
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.Id} value={String(p.Id)}>{p.Name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48 space-y-1.5">
            <label className="text-xs text-muted-foreground">Block</label>
            <Select value={blockId || NONE} onValueChange={(v) => setBlockId(v === NONE ? "" : v)} disabled={!projectId}>
              <SelectTrigger><SelectValue placeholder="All blocks" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All blocks</SelectItem>
                {blocks.map((b) => <SelectItem key={b.Id} value={String(b.Id)}>{b.Name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!projectId ? (
          <div className="py-20 text-center text-muted-foreground text-sm">Select a project to view its parking matrix</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Total Slots", value: stats.total, dot: "bg-blue-400" },
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
            ) : slots.length === 0 ? (
              <div className="py-20 text-center text-muted-foreground text-sm">No parking slots found for this selection</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {slots.map((s) => (
                  <button
                    key={s.Id}
                    onClick={() => {
                      if (s.Status === "Available") setChoiceSlot(s);
                      else if (s.Status === "OnHold" || s.Status === "Booked") setInfoSlot(s);
                    }}
                    disabled={s.Status === "Blocked"}
                    className={`text-left bg-card border border-border rounded-xl p-3.5 transition-colors ${
                      s.Status !== "Blocked" ? "hover:border-primary/50 hover:shadow-sm cursor-pointer" : "cursor-default opacity-90"
                    }`}
                    title={s.BlockName ? `${s.BlockName} — ${s.SlotNo}` : s.SlotNo}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-bold text-sm text-foreground truncate">#{s.SlotNo}</span>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                        s.Status === "OnHold" && isOverdue(s.HoldUntil) ? "bg-rose-500/15 text-rose-600 border border-rose-400/30" : STATUS_STYLE[s.Status]
                      }`}>
                        {s.Status === "OnHold" ? (isOverdue(s.HoldUntil) ? "Overdue" : "Hold") : s.Status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      {s.Status === "Booked" ? (s.ApplicantName || s.BookingNo || "—")
                        : s.Status === "OnHold" ? (
                          <>
                            <Clock size={11} className="shrink-0" />
                            {(s.HoldApplicantName || s.ApplicantName)} · {s.HoldUntil ? timeLeft(s.HoldUntil) : ""}
                          </>
                        ) : "—"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </FollowupShell>

      {choiceSlot && (
        <ActionChoiceDialog
          slot={choiceSlot}
          onClose={() => setChoiceSlot(null)}
          onSell={() => { setSellSlot(choiceSlot); setChoiceSlot(null); }}
          onHold={() => { setHoldSlot(choiceSlot); setChoiceSlot(null); }}
        />
      )}
      {sellSlot && <BookParkingDialog slot={sellSlot} projectId={projectId} onClose={() => setSellSlot(null)} />}
      {holdSlot && <PlaceHoldDialog slot={holdSlot} onClose={() => setHoldSlot(null)} />}
      {infoSlot && <TileInfoDialog slot={infoSlot} onClose={() => setInfoSlot(null)} />}
    </>
  );
}

export default ParkingMatrixPage;
