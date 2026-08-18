import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  Plus, Search, Car, ExternalLink, X, CreditCard,
  FileText, AlertTriangle, CheckCircle2, ShieldAlert,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/parking";
const APP_API = "/api/crm/applications";
const EMPTY_FORM = {
  ApplicationId: "", ProjectId: "", BlockId: "",
  ParkingMasterId: "", ParkingSlotId: "", Notes: "",
};
const PAYMENT_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Bank Transfer", "DD"];
const RELEASE_ROLES = ["super_admin"];

const inr = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

interface Allotment {
  Id: number;
  BookingId: number | null;
  ApplicationId: number | null;
  BookingNo: string | null;
  BookingStatus: string | null;
  BookingGrandTotal: number | null;
  BookingTotalPaid: number | null;
  ApplicantName: string | null;
  Mobile: string | null;
  CurrentParkingType: string;
  SlotNo: string | null;
  ParkingSlotNo: string | null;
  Quantity: number;
  RateSnapshot: number | null;
  GstRateSnapshot: number | null;
  GstAmount: number | null;
  TotalAmount: number;
  PaymentStatus: "Pending" | "Paid";
  ReceiptNo: string | null;
  PaymentMode: string | null;
  PaymentReceivedDate: string | null;
  Notes: string | null;
  CreatedAt: string | null;
}

async function fetchAllotments(): Promise<Allotment[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchApplications(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${APP_API}?includeConverted=1`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/unit-master/projects"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBlocks(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/block-master"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchParkingRates(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/parking-master"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchAvailableSlots(projectId?: string, blockId?: string): Promise<any[]> {
  if (!projectId) return [];
  try {
    const params = new URLSearchParams({ projectId });
    if (blockId) params.set("blockId", blockId);
    const r = await fetchWithAuth(`/api/parking-matrix?${params}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

function bookingCollectedPct(a: Allotment): number {
  const total = Number(a.BookingGrandTotal || 0);
  if (total <= 0) return 0;
  return Math.min(100, Math.round((Number(a.BookingTotalPaid || 0) / total) * 100));
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── DETAIL PANEL ────────────────────────────────────────────────────────────

interface DetailPanelProps {
  allotment: Allotment | null;
  canRelease: boolean;
  onClose: () => void;
  onMarkPaid: (mode: string, date: string) => Promise<void>;
  onRequestRelease: (a: Allotment) => void;
  navigate: (path: string) => void;
}

const DetailPanel: React.FC<DetailPanelProps> = ({
  allotment: a, canRelease, onClose, onMarkPaid, onRequestRelease, navigate,
}) => {
  const [mode, setMode] = useState("");
  const [date, setDate] = useState("");
  const [paying, setPaying] = useState(false);

  if (!a) return null;

  const isLinked = !!a.BookingId;
  const pct = bookingCollectedPct(a);

  const handlePay = async () => {
    setPaying(true);
    try { await onMarkPaid(mode, date); }
    finally { setPaying(false); }
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-[480px] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border">
          <div>
            <SheetHeader className="p-0">
              <SheetTitle className="text-base font-semibold leading-tight">{a.ApplicantName || "—"}</SheetTitle>
            </SheetHeader>
            <p className="text-sm text-muted-foreground mt-0.5">{a.Mobile || "—"}</p>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {isLinked ? (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-blue-600 bg-blue-50 border-blue-200">
                Unit Booking
              </span>
            ) : (
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${a.PaymentStatus === "Paid" ? "text-green-700 bg-green-50 border-green-200" : "text-orange-600 bg-orange-50 border-orange-200"}`}>
                {a.PaymentStatus === "Paid" ? "Paid" : "Payment Pending"}
              </span>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Parking allotment details */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Parking Details</h3>
            <div className="rounded-xl border border-border divide-y divide-border">
              <div className="grid grid-cols-2 divide-x divide-border">
                <div className="px-4 py-3">
                  <div className="text-xs text-muted-foreground mb-0.5">Type</div>
                  <div className="text-sm font-medium">{a.CurrentParkingType}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs text-muted-foreground mb-0.5">Slot</div>
                  <div className="text-sm font-mono font-medium">{a.SlotNo || a.ParkingSlotNo || "—"}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border">
                <div className="px-4 py-3">
                  <div className="text-xs text-muted-foreground mb-0.5">Base Rate</div>
                  <div className="text-sm font-medium">{inr(a.RateSnapshot)}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs text-muted-foreground mb-0.5">GST {a.GstRateSnapshot ? `(${a.GstRateSnapshot}%)` : ""}</div>
                  <div className="text-sm font-medium">{inr(a.GstAmount)}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs text-muted-foreground mb-0.5">Total</div>
                  <div className="text-sm font-semibold">{inr(a.TotalAmount)}</div>
                </div>
              </div>
              {a.Notes && (
                <div className="px-4 py-3">
                  <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><FileText size={10} /> Notes</div>
                  <div className="text-sm text-muted-foreground">{a.Notes}</div>
                </div>
              )}
              <div className="px-4 py-3">
                <div className="text-xs text-muted-foreground">Allotted on</div>
                <div className="text-sm">{formatDate(a.CreatedAt)}</div>
              </div>
            </div>
          </section>

          {/* Unit-linked: booking context */}
          {isLinked && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Linked Booking</h3>
              <div className="rounded-xl border border-border divide-y divide-border">
                <div className="px-4 py-3 flex items-center justify-between">
                  <button
                    onClick={() => { onClose(); navigate(`/crm/bookings?view=${a.BookingId}`); }}
                    className="font-mono text-sm text-primary hover:underline flex items-center gap-1.5"
                  >
                    {a.BookingNo} <ExternalLink size={11} />
                  </button>
                  {a.BookingStatus && (
                    <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground bg-muted/30">
                      {a.BookingStatus}
                    </span>
                  )}
                </div>
                {Number(a.BookingGrandTotal) > 0 && (
                  <div className="px-4 py-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Booking collected</span>
                      <span className="font-medium">{inr(a.BookingTotalPaid)} <span className="text-muted-foreground font-normal">of</span> {inr(a.BookingGrandTotal)}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-all ${pct >= 100 ? "bg-green-500" : pct > 0 ? "bg-amber-400" : "bg-muted-foreground/20"}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">{pct}% of booking grand total collected</div>
                  </div>
                )}
                <div className="px-4 py-3 bg-blue-50/50">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    Parking is included in this unit booking's grand total. Payment is collected through the booking's milestone schedule — open the booking to view or record payments.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Standalone: payment capture */}
          {!isLinked && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                <span className="flex items-center gap-1.5"><CreditCard size={12} /> Payment</span>
              </h3>
              <div className="rounded-xl border border-border divide-y divide-border">
                {a.PaymentStatus === "Paid" ? (
                  <>
                    <div className="px-4 py-3 flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                      <span className="text-sm font-medium text-green-700">Payment Received</span>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-border">
                      <div className="px-4 py-3">
                        <div className="text-xs text-muted-foreground mb-0.5">Receipt No.</div>
                        <div className="text-sm font-mono font-medium">{a.ReceiptNo || "—"}</div>
                      </div>
                      <div className="px-4 py-3">
                        <div className="text-xs text-muted-foreground mb-0.5">Mode</div>
                        <div className="text-sm font-medium">{a.PaymentMode || "—"}</div>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-xs text-muted-foreground mb-0.5">Received Date</div>
                      <div className="text-sm">{formatDate(a.PaymentReceivedDate)}</div>
                    </div>
                  </>
                ) : (
                  <div className="px-4 py-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Amount due</span>
                      <span className="text-base font-semibold">{inr(a.TotalAmount)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Payment Mode</label>
                        <select value={mode} onChange={(e) => setMode(e.target.value)}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                          <option value="">Select mode</option>
                          {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Received Date</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                          max={new Date().toISOString().split("T")[0]}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                      </div>
                    </div>
                    <button onClick={handlePay} disabled={paying || !mode || !date}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors">
                      <CheckCircle2 size={14} />
                      {paying ? "Recording payment…" : `Confirm Payment — ${inr(a.TotalAmount)}`}
                    </button>
                    <p className="text-xs text-muted-foreground text-center">A receipt number will be auto-generated upon confirmation.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Release — super admin only */}
          {canRelease && (
            <section>
              <div className="rounded-xl border border-red-200 bg-red-50/50 px-4 py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={14} className="text-red-500 shrink-0" />
                  <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">Administrative Action</span>
                </div>
                <p className="text-xs text-red-600 leading-relaxed">
                  Releasing this allotment will free the slot back to available inventory.
                  {isLinked && " The linked booking's grand total and payment milestones will be recalculated."}
                  {a.PaymentStatus === "Paid" && " This allotment has already been paid — release is blocked."}
                </p>
                {a.PaymentStatus !== "Paid" && (
                  <button
                    onClick={() => onRequestRelease(a)}
                    className="w-full px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors"
                  >
                    Request Release
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

// ── MAIN PAGE ────────────────────────────────────────────────────────────────

const CrmParkingBooking: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const canRelease = RELEASE_ROLES.includes(currentUser?.role ?? "");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "Pending" | "Paid">("");
  const [linkFilter, setLinkFilter] = useState<"" | "linked" | "standalone">("");
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [selectedAllotment, setSelectedAllotment] = useState<Allotment | null>(null);
  // Release dialog — super admin only; requires a written reason
  const [releaseTarget, setReleaseTarget] = useState<Allotment | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseConfirmText, setReleaseConfirmText] = useState("");
  const [releaseSaving, setReleaseSaving] = useState(false);

  const { data: allotments = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-parking-all"], queryFn: fetchAllotments, staleTime: 30_000,
  });
  const { data: applications = [] } = useQuery({
    queryKey: ["crm-applications-dropdown"], queryFn: fetchApplications, staleTime: 60_000,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000,
  });
  const { data: blocks = [] } = useQuery({
    queryKey: ["block-master"], queryFn: fetchBlocks, staleTime: 5 * 60_000,
  });
  const { data: parkingRates = [] } = useQuery({
    queryKey: ["parking-master-all"], queryFn: fetchParkingRates, staleTime: 60_000,
  });
  const { data: slots = [] } = useQuery({
    queryKey: ["parking-matrix-standalone", form.ProjectId, form.BlockId],
    queryFn: () => fetchAvailableSlots(form.ProjectId, form.BlockId),
    enabled: newDialogOpen && !!form.ProjectId,
  });

  const blocksForProject = useMemo(() =>
    form.ProjectId
      ? (blocks as any[]).filter((b: any) => String(b.ProjectId) === form.ProjectId)
      : (blocks as any[]),
    [blocks, form.ProjectId]);

  const ratesForScope = useMemo(() =>
    (parkingRates as any[])
      .filter((r: any) =>
        r.IsActive &&
        (!form.ProjectId || String(r.ProjectId) === form.ProjectId) &&
        (!r.BlockId || !form.BlockId || String(r.BlockId) === form.BlockId)
      )
      .map((r: any) => ({
        ...r,
        AvailableSlotCount: (slots as any[]).filter(
          (s: any) => s.Status === "Available" && s.ParkingType === r.ParkingType
        ).length,
      })),
    [parkingRates, form.ProjectId, form.BlockId, slots]);

  const selectedRate = ratesForScope.find((r: any) => String(r.Id) === form.ParkingMasterId);
  const availableSlots = useMemo(() =>
    (slots as any[]).filter(
      (s: any) => s.Status === "Available" && (!selectedRate || s.ParkingType === selectedRate.ParkingType)
    ),
    [slots, selectedRate]);

  const filtered = useMemo(() =>
    (allotments as Allotment[]).filter((a) => {
      const matchSearch = !search
        || a.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || a.Mobile?.includes(search)
        || a.BookingNo?.toLowerCase().includes(search.toLowerCase())
        || (a.SlotNo || a.ParkingSlotNo)?.toLowerCase().includes(search.toLowerCase());
      // Status filter is meaningful only for standalone rows. Unit-linked
      // parking has no independent payment status — the booking is the unit
      // of payment, so Pending/Paid filters should never hide unit-linked rows.
      const matchStatus = !statusFilter || !!a.BookingId || a.PaymentStatus === statusFilter;
      const matchLink = !linkFilter || (linkFilter === "linked" ? !!a.BookingId : !a.BookingId);
      return matchSearch && matchStatus && matchLink;
    }), [allotments, search, statusFilter, linkFilter]);

  const standalonePending = filtered
    .filter((a) => !a.BookingId && a.PaymentStatus !== "Paid")
    .reduce((s, a) => s + Number(a.TotalAmount || 0), 0);

  const standalonePaid = filtered
    .filter((a) => !a.BookingId && a.PaymentStatus === "Paid")
    .reduce((s, a) => s + Number(a.TotalAmount || 0), 0);

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setNewDialogOpen(false); };

  const handleCreate = async () => {
    if (!form.ApplicationId) { toast.error("Select a customer application"); return; }
    if (!form.ParkingMasterId) { toast.error("Select a parking type / rate"); return; }
    if (!form.ParkingSlotId) { toast.error("Select a specific parking slot"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/standalone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApplicationId: form.ApplicationId,
          ParkingMasterId: form.ParkingMasterId,
          ParkingSlotId: parseInt(form.ParkingSlotId),
          Quantity: 1,
          Notes: form.Notes || null,
          Immediate: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Parking allotted — ${inr(data.TotalAmount)}`);
      resetForm();
      qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
      qc.invalidateQueries({ queryKey: ["parking-matrix-standalone"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (mode: string, date: string) => {
    if (!selectedAllotment) return;
    const res = await fetchWithAuth(`${API}/${selectedAllotment.Id}/mark-paid`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ PaymentMode: mode || null, ReceivedDate: date || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast.success(`Payment recorded — Receipt ${data.ReceiptNo}`);
    setSelectedAllotment(null);
    qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
  };

  const handleRelease = async () => {
    if (!releaseTarget) return;
    const reason = releaseReason.trim();
    if (!reason) { toast.error("A reason is required"); return; }
    if (releaseConfirmText.toUpperCase() !== "RELEASE") { toast.error('Type RELEASE to confirm'); return; }
    setReleaseSaving(true);
    try {
      const url = `${API}/${releaseTarget.Id}?reason=${encodeURIComponent(reason)}`;
      const res = await fetchWithAuth(url, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Release failed"); return; }
      if (data.pending) {
        toast.success("Amendment queued — legal documents are under verification. This needs sign-off before the slot is released.");
      } else {
        toast.success("Parking allotment released and slot returned to inventory");
      }
      setReleaseTarget(null);
      setReleaseReason("");
      setReleaseConfirmText("");
      setSelectedAllotment(null);
      qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
    } catch (e: any) {
      toast.error(e.message || "Network error");
    } finally {
      setReleaseSaving(false);
    }
  };

  const columns: ColumnDef<Allotment, unknown>[] = [
    {
      accessorKey: "ApplicantName", header: "Customer", size: 180,
      cell: (i) => (
        <button onClick={() => setSelectedAllotment(i.row.original)} className="text-left group">
          <div className="font-medium group-hover:text-primary transition-colors">{i.row.original.ApplicantName || "—"}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile || "—"}</div>
        </button>
      ),
    },
    {
      id: "booking", header: "Booking / Type", size: 150, enableSorting: false,
      cell: (i) => {
        const a = i.row.original;
        return a.BookingNo ? (
          <button
            onClick={() => navigate(`/crm/bookings?view=${a.BookingId}`)}
            className="font-mono text-xs text-primary hover:underline flex items-center gap-1"
          >
            {a.BookingNo} <ExternalLink size={10} />
          </button>
        ) : (
          <span className="text-xs px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-600 font-medium">
            Standalone
          </span>
        );
      },
    },
    {
      accessorKey: "CurrentParkingType", header: "Parking Type", size: 120,
      cell: (i) => <span className="text-sm">{i.getValue() as string}</span>,
    },
    {
      id: "slot", header: "Slot", size: 90, enableSorting: false,
      cell: (i) => (
        <span className="font-mono text-sm">{i.row.original.SlotNo || i.row.original.ParkingSlotNo || "—"}</span>
      ),
    },
    {
      accessorKey: "TotalAmount", header: "Amount", size: 120,
      cell: (i) => <span className="font-semibold tabular-nums">{inr(i.row.original.TotalAmount)}</span>,
    },
    {
      id: "status", header: "Payment Status", size: 160, enableSorting: false,
      cell: (i) => {
        const a = i.row.original;
        if (a.BookingId) {
          const pct = bookingCollectedPct(a);
          return (
            <div className="space-y-1">
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-blue-600 bg-blue-50 border-blue-200">
                With Booking
              </span>
              {Number(a.BookingGrandTotal) > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 bg-muted rounded-full h-1 overflow-hidden">
                    <div
                      className={`h-1 rounded-full ${pct >= 100 ? "bg-green-500" : pct > 0 ? "bg-amber-400" : "bg-muted-foreground/20"}`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{pct}%</span>
                </div>
              )}
            </div>
          );
        }
        return (
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${a.PaymentStatus === "Paid" ? "text-green-700 bg-green-50 border-green-200" : "text-orange-600 bg-orange-50 border-orange-200"}`}>
            {a.PaymentStatus === "Paid" ? "Paid" : "Pending"}
          </span>
        );
      },
    },
    {
      id: "allotted", header: "Allotted On", size: 110, enableSorting: false,
      cell: (i) => <span className="text-xs text-muted-foreground">{formatDate(i.row.original.CreatedAt)}</span>,
    },
    {
      id: "view", header: "", size: 70, enableSorting: false,
      cell: (i) => (
        <button
          onClick={() => setSelectedAllotment(i.row.original)}
          className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <CrmShell
      title="Parking Allotments"
      subtitle="Standalone parking sales and unit-linked allotments across all bookings"
      action={
        <button
          onClick={() => setNewDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus size={14} /> New Standalone Sale
        </button>
      }
    >
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground mb-1">Standalone — Pending Collection</div>
          <div className="text-lg font-semibold tabular-nums">{inr(standalonePending)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground mb-1">Standalone — Collected</div>
          <div className="text-lg font-semibold tabular-nums text-green-700">{inr(standalonePaid)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3 col-span-2 sm:col-span-1">
          <div className="text-xs text-muted-foreground mb-1">Total Allotments (visible)</div>
          <div className="text-lg font-semibold tabular-nums">{filtered.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-56">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer, mobile, booking no., slot…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          {([
            { k: "" as const, l: "All" },
            { k: "Pending" as const, l: "Standalone Pending" },
            { k: "Paid" as const, l: "Standalone Paid" },
          ]).map((o) => (
            <button key={o.k || "all"} onClick={() => setStatusFilter(o.k)}
              className={`px-2.5 py-1 rounded-md border font-medium transition-colors ${statusFilter === o.k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
              {o.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {([
            { k: "" as const, l: "All types" },
            { k: "linked" as const, l: "Unit-linked" },
            { k: "standalone" as const, l: "Standalone" },
          ]).map((o) => (
            <button key={o.k || "all-t"} onClick={() => setLinkFilter(o.k)}
              className={`px-2.5 py-1 rounded-md border font-medium transition-colors ${linkFilter === o.k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
              {o.l}
            </button>
          ))}
        </div>
        {(statusFilter || linkFilter || search) && (
          <button onClick={() => { setStatusFilter(""); setLinkFilter(""); setSearch(""); }}
            className="text-xs text-muted-foreground hover:text-foreground underline px-1">
            Clear filters
          </button>
        )}
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No parking allotments found"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Detail panel */}
      {selectedAllotment && (
        <DetailPanel
          allotment={selectedAllotment}
          canRelease={canRelease}
          onClose={() => setSelectedAllotment(null)}
          onMarkPaid={handleMarkPaid}
          onRequestRelease={(a) => { setReleaseTarget(a); setSelectedAllotment(null); }}
          navigate={navigate}
        />
      )}

      {/* Release confirmation — super admin, requires written reason + RELEASE text */}
      <Dialog open={!!releaseTarget} onOpenChange={(o) => { if (!o) { setReleaseTarget(null); setReleaseReason(""); setReleaseConfirmText(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle size={16} /> Release Parking Allotment
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              You are about to release slot <strong>{releaseTarget?.SlotNo || releaseTarget?.ParkingSlotNo || "—"}</strong> ({releaseTarget?.CurrentParkingType}) allotted to <strong>{releaseTarget?.ApplicantName}</strong>.
              {releaseTarget?.BookingId && " The linked booking's grand total and milestones will be recalculated."}
              {" "}This action cannot be undone without re-allotting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1">Reason for release <span className="text-red-500">*</span></label>
              <textarea
                value={releaseReason}
                onChange={(e) => setReleaseReason(e.target.value)}
                placeholder="State the reason — this will be recorded in the audit trail."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">
                Type <span className="font-mono text-red-600">RELEASE</span> to confirm
              </label>
              <input
                value={releaseConfirmText}
                onChange={(e) => setReleaseConfirmText(e.target.value)}
                placeholder="RELEASE"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-red-500 font-mono"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button
              onClick={() => { setReleaseTarget(null); setReleaseReason(""); setReleaseConfirmText(""); }}
              disabled={releaseSaving}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRelease}
              disabled={releaseSaving || !releaseReason.trim() || releaseConfirmText.toUpperCase() !== "RELEASE"}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors"
            >
              {releaseSaving ? "Releasing…" : "Confirm Release"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New standalone sale dialog */}
      <Dialog open={newDialogOpen} onOpenChange={(o) => { if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Standalone Parking Sale</DialogTitle>
            <DialogDescription>
              Sells parking directly to a customer with no unit booking involved. To allot parking against an existing unit booking, open that booking's Details tab.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1.5">Customer Application <span className="text-red-500">*</span></label>
              <select value={form.ApplicationId} onChange={(e) => setForm((f) => ({ ...f, ApplicationId: e.target.value }))}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">Select application</option>
                {(applications as any[]).map((a: any) => (
                  <option key={a.Id} value={String(a.Id)}>
                    {a.ApplicantName} — {a.Mobile} ({a.ApplicationNo})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium block mb-1.5">Project</label>
                <select value={form.ProjectId}
                  onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value, BlockId: "", ParkingMasterId: "", ParkingSlotId: "" }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                  <option value="">All projects</option>
                  {(projects as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Block</label>
                <select value={form.BlockId}
                  onChange={(e) => setForm((f) => ({ ...f, BlockId: e.target.value, ParkingMasterId: "", ParkingSlotId: "" }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                  <option value="">Any block</option>
                  {blocksForProject.map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.Name || b.BlockName}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium block mb-1.5">Parking Type / Rate <span className="text-red-500">*</span></label>
                <select value={form.ParkingMasterId}
                  onChange={(e) => setForm((f) => ({ ...f, ParkingMasterId: e.target.value, ParkingSlotId: "" }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                  <option value="">Select type</option>
                  {ratesForScope.map((r: any) => (
                    <option key={r.Id} value={String(r.Id)} disabled={r.AvailableSlotCount === 0}>
                      {r.ParkingType} — {inr(r.Charge)} + {r.GstRate}% GST
                      {r.AvailableSlotCount > 0 ? ` (${r.AvailableSlotCount} slots free)` : " — Full"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Slot <span className="text-red-500">*</span></label>
                <select value={form.ParkingSlotId}
                  onChange={(e) => setForm((f) => ({ ...f, ParkingSlotId: e.target.value }))}
                  disabled={!selectedRate}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50">
                  <option value="">{selectedRate ? "Select slot" : "Pick a type first"}</option>
                  {availableSlots.map((s: any) => (
                    <option key={s.Id} value={String(s.Id)}>
                      {s.SlotNo}{s.BlockName ? ` (${s.BlockName})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {form.ProjectId && ratesForScope.length === 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No parking rates configured for this project/block. Set them up in Parking Master before selling.
              </p>
            )}
            {selectedRate && (
              <div className="rounded-lg bg-muted/30 border border-border px-3 py-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base amount</span>
                  <span>{inr(selectedRate.Charge)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GST ({selectedRate.GstRate}%)</span>
                  <span>{inr(Math.round(selectedRate.Charge * selectedRate.GstRate / 100 * 100) / 100)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-border mt-1.5 pt-1.5">
                  <span>Total payable</span>
                  <span>{inr(selectedRate.Charge + Math.round(selectedRate.Charge * selectedRate.GstRate / 100 * 100) / 100)}</span>
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium block mb-1.5">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button onClick={resetForm} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !form.ApplicationId || !form.ParkingMasterId || !form.ParkingSlotId}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {saving ? "Creating…" : "Create Allotment"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmParkingBooking;
