import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import {
  Plus, AlertTriangle, RotateCcw, UserCircle2,
  CheckCircle2, Send, ShieldAlert, Loader2,
  ChevronRight, FileText, Pencil, Trash2,
  CalendarDays, Clock, MapPin, ArrowRight, Search, X,
} from "lucide-react";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { cn } from "@/lib/utils";

const API = "/api/crm/possession-notice";
const DELIVERY_MODES = ["Email", "Post", "Courier", "InPerson"];
const EMPTY_EDIT = { OfferedDate: "", ResponseDeadline: "", DeliveryMode: "", Notes: "" };

const todayISO    = () => new Date().toISOString().slice(0, 10);
const deadlineISO = () => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10); };
const EMPTY_FORM  = { BookingId: "", OfferedDate: todayISO(), ResponseDeadline: deadlineISO(), DeliveryMode: "Courier", Notes: "" };

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function deadlineInfo(dl?: string | null, status?: string) {
  if (!dl || status !== "Sent") return null;
  const diff = Math.ceil((new Date(dl).getTime() - Date.now()) / 86_400_000);
  if (diff < 0)  return { label: `Overdue by ${Math.abs(diff)}d`, cls: "text-red-600 bg-red-50 border-red-200" };
  if (diff <= 3) return { label: `${diff}d left`, cls: "text-orange-600 bg-orange-50 border-orange-200" };
  if (diff <= 7) return { label: `${diff}d left`, cls: "text-amber-600 bg-amber-50 border-amber-200" };
  return null;
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, {
  label: string; badgeCls: string; borderCls: string; bgCls: string; Icon: React.ElementType;
}> = {
  Draft:        { label: "Draft",        badgeCls: "text-slate-600 bg-slate-100 border-slate-300",    borderCls: "border-l-slate-300",    bgCls: "bg-card",                        Icon: FileText      },
  Sent:         { label: "Sent",         badgeCls: "text-blue-600 bg-blue-50 border-blue-200",        borderCls: "border-l-blue-400",      bgCls: "bg-blue-500/[0.02]",             Icon: Send          },
  Acknowledged: { label: "Acknowledged", badgeCls: "text-green-700 bg-green-50 border-green-200",     borderCls: "border-l-green-500",     bgCls: "bg-green-500/[0.03]",            Icon: CheckCircle2  },
  Disputed:     { label: "Disputed",     badgeCls: "text-red-600 bg-red-50 border-red-200",           borderCls: "border-l-red-500",       bgCls: "bg-red-500/[0.03]",              Icon: AlertTriangle },
};

// ── Fetchers ──────────────────────────────────────────────────────────────────
async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error || `HTTP ${r.status}`); }
  return r.json();
}
async function fetchEligible(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}

// ── Delivery mode badge ───────────────────────────────────────────────────────
const MODE_ICON: Record<string, string> = { Email: "✉", Post: "📮", Courier: "📦", InPerson: "🤝" };
function ModeBadge({ mode }: { mode?: string | null }) {
  if (!mode) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border rounded px-1.5 py-0.5">
      <span>{MODE_ICON[mode] ?? "📄"}</span>{mode}
    </span>
  );
}

// ── New notice dialog ─────────────────────────────────────────────────────────
interface CreateDialogProps { onClose: () => void; onCreated: () => void; navigate: ReturnType<typeof useNavigate>; prefillBookingId?: string; }
function CreateDialog({ onClose, onCreated, navigate, prefillBookingId }: CreateDialogProps) {
  const [form, setForm] = useState({ ...EMPTY_FORM, BookingId: prefillBookingId ?? "" });
  const [saving, setSaving] = useState(false);

  const { data: eligible = [], isFetching } = useQuery({
    queryKey: ["crm-possession-notice-eligible"],
    queryFn: fetchEligible,
    staleTime: 0,
  });

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Select a booking"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Notice ${data.NoticeNo} created`);
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };

  const noEligible = !isFetching && (eligible as any[]).length === 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-base flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText size={14} className="text-primary" />
            </div>
            New Possession Notice
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5 ml-9">Creates a formal offer of possession — customer must acknowledge within the response deadline</p>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Booking */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Booking *</label>
            {isFetching ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 size={12} className="animate-spin" /> Loading eligible bookings…
              </div>
            ) : noEligible ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2.5">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                  <ShieldAlert size={15} /> No eligible bookings
                </p>
                <p className="text-xs text-amber-700 leading-relaxed">Both gates must be cleared before a notice can be issued:</p>
                <ul className="space-y-1.5 text-xs text-amber-700">
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-amber-200 text-amber-800 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">1</span>
                    <span><strong>Pre-Possession Ready</strong> — all 4 checks must pass (Dues, Documentation, Quality, Utility)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-amber-200 text-amber-800 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                    <span><strong>OC/CC Received</strong> — project Occupancy or Completion Certificate must be on file</span>
                  </li>
                </ul>
                <div className="flex gap-4 pt-1">
                  <button onClick={() => { onClose(); navigate("/crm/pre-possession"); }}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold">
                    Pre-Possession Check <ChevronRight size={11} />
                  </button>
                  <button onClick={() => { onClose(); navigate("/crm/oc-cc"); }}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold">
                    OC / CC <ChevronRight size={11} />
                  </button>
                </div>
              </div>
            ) : (
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                <option value="">Select booking…</option>
                {(eligible as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>
                    {b.BookingNo} — {b.ApplicantName} ({b.UnitNo})
                  </option>
                ))}
              </select>
            )}
          </div>

          {!noEligible && form.BookingId && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                    <CalendarDays size={10} className="inline mr-1" />Offered Date
                  </label>
                  <input type="date" value={form.OfferedDate}
                    onChange={(e) => setForm((f) => ({ ...f, OfferedDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                    <Clock size={10} className="inline mr-1" />Response Deadline
                  </label>
                  <input type="date" value={form.ResponseDeadline}
                    onChange={(e) => setForm((f) => ({ ...f, ResponseDeadline: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Delivery Mode</label>
                <div className="grid grid-cols-4 gap-2">
                  {DELIVERY_MODES.map((m) => (
                    <button key={m} type="button" onClick={() => setForm((f) => ({ ...f, DeliveryMode: m }))}
                      className={cn(
                        "text-xs font-medium py-2 rounded-lg border transition-colors text-center",
                        form.DeliveryMode === m
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted text-muted-foreground",
                      )}>
                      {MODE_ICON[m]} {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Notes (optional)</label>
                <textarea value={form.Notes} rows={2}
                  onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                  placeholder="Any remarks about this notice…"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none" />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border mt-2">
          <button onClick={onClose}
            className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          {!noEligible && (
            <button onClick={handleCreate} disabled={saving || !form.BookingId}
              className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Creating…" : "Create Notice"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Notice card ───────────────────────────────────────────────────────────────
interface NoticeCardProps {
  n: any;
  onMarkSent: (n: any) => void;
  onEdit: (n: any) => void;
  onDelete: (n: any) => void;
  onAcknowledge: (id: number) => void;
  onDispute: (id: number) => void;
  onProxyAck: (id: number) => void;
  onProxyDispute: (id: number) => void;
  onRetract: (id: number) => void;
  onHandover: (bookingId: number) => void;
}
function NoticeCard({ n, onMarkSent, onEdit, onDelete, onAcknowledge, onDispute, onProxyAck, onProxyDispute, onRetract, onHandover }: NoticeCardProps) {
  const cfg = STATUS_CONFIG[n.Status] ?? STATUS_CONFIG.Draft;
  const { Icon } = cfg;
  const dl = deadlineInfo(n.ResponseDeadline, n.Status);

  return (
    <div className={cn(
      "rounded-xl border border-l-4 overflow-hidden transition-shadow hover:shadow-sm",
      cfg.borderCls, cfg.bgCls,
    )}>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: identity */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-sm font-bold text-primary">{n.NoticeNo}</span>
              <span className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                cfg.badgeCls,
              )}>
                <Icon size={10} />{cfg.label}
              </span>
              {dl && (
                <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border", dl.cls)}>
                  <Clock size={9} />{dl.label}
                </span>
              )}
            </div>

            <div className="mt-1.5">
              <div className="text-sm font-semibold text-foreground leading-tight">{n.ApplicantName}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{n.BookingNo} · {n.UnitNo}</div>
            </div>
          </div>

          {/* Right: dates + mode */}
          <div className="shrink-0 text-right space-y-1.5 hidden sm:block">
            <div className="flex items-center justify-end gap-2">
              <ModeBadge mode={n.DeliveryMode} />
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center justify-end gap-1">
              <CalendarDays size={10} />
              <span>Offered {fmtDate(n.OfferedDate)}</span>
            </div>
            {n.ResponseDeadline && (
              <div className={cn(
                "text-[11px] flex items-center justify-end gap-1",
                dl ? dl.cls.split(" ")[0] : "text-muted-foreground",
              )}>
                <Clock size={10} />
                <span>Deadline {fmtDate(n.ResponseDeadline)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-2 flex-wrap">
          {n.Status === CrmStatus.DRAFT && (
            <>
              <button onClick={() => onMarkSent(n)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                <Send size={11} /> Mark Sent
              </button>
              <button onClick={() => onEdit(n)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">
                <Pencil size={11} /> Edit
              </button>
              <button onClick={() => onDelete(n)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors ml-auto">
                <Trash2 size={11} /> Delete
              </button>
            </>
          )}

          {n.Status === "Sent" && (
            <>
              <button onClick={() => onAcknowledge(n.Id)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors">
                <CheckCircle2 size={11} /> Acknowledge
              </button>
              <button onClick={() => onDispute(n.Id)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                <AlertTriangle size={11} /> Dispute
              </button>
              <div className="h-4 w-px bg-border mx-1" />
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Off-portal:</span>
              <button onClick={() => onProxyAck(n.Id)}
                className="flex items-center gap-1 text-xs text-amber-700 hover:underline font-medium">
                <UserCircle2 size={11} /> Ack
              </button>
              <button onClick={() => onProxyDispute(n.Id)}
                className="flex items-center gap-1 text-xs text-amber-700 hover:underline font-medium">
                <UserCircle2 size={11} /> Dispute
              </button>
            </>
          )}

          {n.Status === "Disputed" && (
            <button onClick={() => onRetract(n.Id)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors">
              <RotateCcw size={11} /> Retract Dispute
            </button>
          )}

          {n.Status === "Acknowledged" && (
            <button onClick={() => onHandover(n.BookingId)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Schedule Handover <ArrowRight size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const CrmPossessionNotice: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  usePageRights("crm-possession-notice");

  const prefillBookingId = sp.get("bookingId") ?? undefined;
  const [search,               setSearch]               = useState("");
  const [statusFilter,         setStatusFilter]         = useState("All");
  const [createOpen,           setCreateOpen]           = useState(() => sp.get("open") === "1");
  const [editTarget,           setEditTarget]           = useState<any | null>(null);
  const [editForm,             setEditForm]             = useState({ ...EMPTY_EDIT });
  const [editSaving,           setEditSaving]           = useState(false);
  const [deleteTarget,         setDeleteTarget]         = useState<any | null>(null);
  const [deleteSaving,         setDeleteSaving]         = useState(false);
  const [sentTarget,           setSentTarget]           = useState<any | null>(null);
  const [sentMode,             setSentMode]             = useState("");
  const [sentSaving,           setSentSaving]           = useState(false);
  const [disputeDialog,        setDisputeDialog]        = useState<number | null>(null);
  const [disputeReason,        setDisputeReason]        = useState("");
  const [retractDialog,        setRetractDialog]        = useState<number | null>(null);
  const [retractReason,        setRetractReason]        = useState("");
  const [proxyAckTarget,       setProxyAckTarget]       = useState<number | null>(null);
  const [proxyDisputeTarget,   setProxyDisputeTarget]   = useState<number | null>(null);
  const [proxySaving,          setProxySaving]          = useState(false);

  const { data: notices = [], isLoading, dataUpdatedAt, isFetching, refetch } =
    useQuery({ queryKey: ["crm-possession-notice"], queryFn: fetchAll, staleTime: 30_000 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-possession-notice"] });
    qc.invalidateQueries({ queryKey: ["crm-possession-notice-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  };

  const openEdit = (n: any) => {
    setEditTarget(n);
    setEditForm({
      OfferedDate:      n.OfferedDate      ? String(n.OfferedDate).slice(0, 10) : "",
      ResponseDeadline: n.ResponseDeadline ? String(n.ResponseDeadline).slice(0, 10) : "",
      DeliveryMode:     n.DeliveryMode     || "",
      Notes:            n.Notes            || "",
    });
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${editTarget.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          OfferedDate:      editForm.OfferedDate      || undefined,
          ResponseDeadline: editForm.ResponseDeadline || undefined,
          DeliveryMode:     editForm.DeliveryMode     || undefined,
          Notes:            editForm.Notes            || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Notice updated");
      setEditTarget(null);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setEditSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${deleteTarget.Id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Notice ${deleteTarget.NoticeNo} deleted`);
      setDeleteTarget(null);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setDeleteSaving(false); }
  };

  const handleMarkSent = async () => {
    if (!sentTarget) return;
    const mode = sentMode || sentTarget.DeliveryMode;
    if (!mode) { toast.error("Select a delivery mode before marking sent"); return; }
    setSentSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${sentTarget.Id}/mark-sent`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DeliveryMode: mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Notice marked Sent");
      setSentTarget(null); setSentMode("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSentSaving(false); }
  };

  const handleMarkAcknowledged = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}/mark-acknowledged`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Notice acknowledged");
      promptNextStep(navigate, "Possession notice acknowledged — handover can now be scheduled.", "/crm/handover", "Go to Handover");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleMarkDisputed = async () => {
    if (!disputeDialog || !disputeReason.trim()) { toast.error("Dispute reason is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${disputeDialog}/mark-disputed`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DisputeReason: disputeReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Notice marked Disputed");
      setDisputeDialog(null); setDisputeReason("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRetractDispute = async () => {
    if (!retractDialog || !retractReason.trim()) { toast.error("Retract reason is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${retractDialog}/retract-dispute`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ RetractReason: retractReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Dispute retracted — notice returned to Draft");
      setRetractDialog(null); setRetractReason("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleProxyAcknowledge = async (method: ProxyMethod, remarks: string) => {
    if (!proxyAckTarget) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${proxyAckTarget}/proxy-acknowledge`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer acknowledgement recorded");
      setProxyAckTarget(null); invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const handleProxyDispute = async (method: ProxyMethod, remarks: string) => {
    if (!proxyDisputeTarget) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${proxyDisputeTarget}/proxy-dispute`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer dispute recorded");
      setProxyDisputeTarget(null); invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const noticeList = notices as any[];
  const counts = {
    all:          noticeList.length,
    draft:        noticeList.filter((n) => n.Status === CrmStatus.DRAFT).length,
    sent:         noticeList.filter((n) => n.Status === "Sent").length,
    acknowledged: noticeList.filter((n) => n.Status === "Acknowledged").length,
    disputed:     noticeList.filter((n) => n.Status === "Disputed").length,
  };

  const filtered = useMemo(() => {
    let list = noticeList;
    if (statusFilter !== "All") list = list.filter((n) => n.Status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((n) =>
        n.ApplicantName?.toLowerCase().includes(q) ||
        n.BookingNo?.toLowerCase().includes(q) ||
        n.NoticeNo?.toLowerCase().includes(q) ||
        n.UnitNo?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [noticeList, statusFilter, search]);

  const STAT_TABS = [
    { key: "All",          label: "All",          count: counts.all,          cls: "border-border text-foreground",                           activeCls: "bg-foreground text-background border-foreground" },
    { key: "Draft",        label: "Draft",        count: counts.draft,        cls: "border-slate-300 text-slate-600",                         activeCls: "bg-slate-600 text-white border-slate-600" },
    { key: "Sent",         label: "Sent",         count: counts.sent,         cls: "border-blue-300 text-blue-600",                           activeCls: "bg-blue-600 text-white border-blue-600" },
    { key: "Acknowledged", label: "Acknowledged", count: counts.acknowledged, cls: "border-green-300 text-green-700",                         activeCls: "bg-green-600 text-white border-green-600" },
    { key: "Disputed",     label: "Disputed",     count: counts.disputed,     cls: "border-red-300 text-red-600",                             activeCls: "bg-red-600 text-white border-red-600" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Possession Notice"]} />
      <CrmShell
        title="Possession Notice"
        subtitle="Formal offer of possession to buyers — must be acknowledged before Handover is scheduled"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            <button onClick={() => { setSp({}, { replace: true }); setCreateOpen(true); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90">
              <Plus size={14} /> New Notice
            </button>
          </div>
        }
      >
        {noticeList.length > 0 && (
          <>
            {/* Stat + filter tabs */}
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              {STAT_TABS.map((t) => (
                <button key={t.key} onClick={() => setStatusFilter(t.key)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors",
                    statusFilter === t.key ? t.activeCls : `${t.cls} bg-background hover:bg-muted`,
                  )}>
                  {t.label}
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                    statusFilter === t.key ? "bg-white/20" : "bg-muted/80",
                  )}>
                    {t.count}
                  </span>
                </button>
              ))}

              {/* Search */}
              <div className="ml-auto relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="text-sm pl-7 pr-7 py-1.5 border border-border rounded-lg bg-background w-48 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Notice cards */}
            {isLoading ? (
              <div className="py-16 flex items-center justify-center text-muted-foreground text-sm gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                No notices match the current filter
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((n) => (
                  <NoticeCard
                    key={n.Id}
                    n={n}
                    onMarkSent={(x) => { setSentTarget(x); setSentMode(x.DeliveryMode || ""); }}
                    onEdit={openEdit}
                    onDelete={setDeleteTarget}
                    onAcknowledge={handleMarkAcknowledged}
                    onDispute={(id) => { setDisputeDialog(id); setDisputeReason(""); }}
                    onProxyAck={setProxyAckTarget}
                    onProxyDispute={setProxyDisputeTarget}
                    onRetract={(id) => { setRetractDialog(id); setRetractReason(""); }}
                    onHandover={(bookingId) => navigate(`/crm/handover?bookingId=${bookingId}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!isLoading && noticeList.length === 0 && (
          <div className="space-y-4">
            <div className="p-8 rounded-xl border-2 border-dashed border-border bg-muted/10 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <FileText size={26} className="text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">No possession notices yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                  Issue a notice after the Pre-Possession Check is <strong>Ready</strong> and the project has a received OC/CC.
                </p>
              </div>
              <div className="flex justify-center gap-4 pt-1">
                <button onClick={() => navigate("/crm/pre-possession")}
                  className="flex items-center gap-1 text-sm text-primary hover:underline font-medium">
                  Pre-Possession <ChevronRight size={14} />
                </button>
                <button onClick={() => { setSp({}, { replace: true }); setCreateOpen(true); }}
                  className="flex items-center gap-1.5 text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
                  <Plus size={13} /> New Notice
                </button>
              </div>
            </div>

            {/* Workflow steps */}
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-bold text-muted-foreground mb-4 uppercase tracking-wider">Notice Workflow</p>
              <div className="flex items-start gap-2 flex-wrap sm:flex-nowrap">
                {[
                  { label: "Draft",        sub: "Fill details & delivery mode",    cls: "bg-slate-100 border-slate-300 text-slate-700" },
                  { label: "Mark Sent",    sub: "Dispatch via chosen channel",     cls: "bg-blue-50 border-blue-200 text-blue-700" },
                  { label: "Customer Acts", sub: "Acknowledges or raises dispute",  cls: "bg-amber-50 border-amber-200 text-amber-700" },
                  { label: "Acknowledged", sub: "Handover can now be scheduled",   cls: "bg-green-50 border-green-200 text-green-700" },
                ].map(({ label, sub, cls }, idx, arr) => (
                  <React.Fragment key={label}>
                    <div className="flex-1 min-w-[80px]">
                      <div className={cn("text-xs font-bold px-2.5 py-1 rounded-lg border text-center mb-1", cls)}>{label}</div>
                      <div className="text-[10px] text-muted-foreground text-center leading-tight">{sub}</div>
                    </div>
                    {idx < arr.length - 1 && (
                      <ArrowRight size={14} className="text-muted-foreground/40 shrink-0 mt-2 hidden sm:block" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Mark-Sent dialog ── */}
        <Dialog open={!!sentTarget} onOpenChange={(o) => { if (!o) { setSentTarget(null); setSentMode(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-base">
                <Send size={16} className="text-blue-600" /> Mark Notice Sent
              </DialogTitle>
            </DialogHeader>
            {sentTarget && (
              <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 text-xs text-muted-foreground">
                {sentTarget.NoticeNo} · {sentTarget.ApplicantName}
              </div>
            )}
            <p className="text-sm text-muted-foreground">Confirm the channel used to dispatch this notice.</p>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Delivery Mode *</label>
              <div className="grid grid-cols-2 gap-2">
                {DELIVERY_MODES.map((m) => (
                  <button key={m} type="button" onClick={() => setSentMode(m)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors",
                      sentMode === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted text-muted-foreground",
                    )}>
                    <span>{MODE_ICON[m]}</span> {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <button onClick={() => { setSentTarget(null); setSentMode(""); }}
                className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleMarkSent} disabled={sentSaving || !sentMode}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-40">
                {sentSaving ? "Marking…" : "Mark Sent"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Edit dialog ── */}
        <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-base">
                <Pencil size={15} /> Edit Draft — {editTarget?.NoticeNo}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Offered Date</label>
                  <input type="date" value={editForm.OfferedDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, OfferedDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Response Deadline</label>
                  <input type="date" value={editForm.ResponseDeadline}
                    onChange={(e) => setEditForm((f) => ({ ...f, ResponseDeadline: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Delivery Mode</label>
                <div className="grid grid-cols-4 gap-2">
                  {DELIVERY_MODES.map((m) => (
                    <button key={m} type="button" onClick={() => setEditForm((f) => ({ ...f, DeliveryMode: m }))}
                      className={cn(
                        "text-xs font-medium py-2 rounded-lg border transition-colors text-center",
                        editForm.DeliveryMode === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted text-muted-foreground",
                      )}>
                      {MODE_ICON[m]} {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Notes</label>
                <textarea value={editForm.Notes} rows={2}
                  onChange={(e) => setEditForm((f) => ({ ...f, Notes: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <button onClick={() => setEditTarget(null)}
                className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleEdit} disabled={editSaving}
                className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-40">
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Delete confirmation ── */}
        <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-base text-red-600">
                <Trash2 size={16} /> Delete Notice
              </DialogTitle>
            </DialogHeader>
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {deleteTarget?.NoticeNo} · {deleteTarget?.ApplicantName}
            </div>
            <p className="text-sm text-muted-foreground">
              This will permanently remove the notice and allow a new one to be issued for this booking. Only Draft notices can be deleted.
            </p>
            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleDelete} disabled={deleteSaving}
                className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-40">
                {deleteSaving ? "Deleting…" : "Delete Notice"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Dispute dialog ── */}
        <Dialog open={!!disputeDialog} onOpenChange={(o) => { if (!o) { setDisputeDialog(null); setDisputeReason(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-base">
                <AlertTriangle size={16} className="text-red-500" /> Mark Disputed
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Record the customer's objection. The notice stays Disputed until you retract and re-issue.</p>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Dispute Reason *</label>
              <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}
                rows={3} placeholder="Describe the customer's objection in detail…"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none" />
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <button onClick={() => { setDisputeDialog(null); setDisputeReason(""); }}
                className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleMarkDisputed} disabled={!disputeReason.trim()}
                className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-40">
                Mark Disputed
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Retract dispute ── */}
        <Dialog open={!!retractDialog} onOpenChange={(o) => { if (!o) { setRetractDialog(null); setRetractReason(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-base">
                <RotateCcw size={16} className="text-amber-600" /> Retract Dispute
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Returns the notice to Draft so it can be revised and re-sent. Document the resolution.</p>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Resolution Notes *</label>
              <textarea value={retractReason} onChange={(e) => setRetractReason(e.target.value)}
                rows={3} placeholder="How was the customer's dispute resolved?"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none" />
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <button onClick={() => { setRetractDialog(null); setRetractReason(""); }}
                className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleRetractDispute} disabled={!retractReason.trim()}
                className="px-5 py-2 text-sm bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-40">
                Retract &amp; Return to Draft
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Proxy dialogs ── */}
        {proxyAckTarget !== null && (
          <ProxyActionDialog
            title="Record Customer Acknowledgement"
            description="You are recording that the customer acknowledged the possession notice without logging into their portal."
            confirmLabel="Record Acknowledgement"
            saving={proxySaving}
            onClose={() => setProxyAckTarget(null)}
            onConfirm={handleProxyAcknowledge}
          />
        )}
        {proxyDisputeTarget !== null && (
          <ProxyActionDialog
            title="Record Customer Dispute"
            description="You are recording that the customer disputed the possession notice without using the portal. Include their reason in the notes."
            confirmLabel="Record Dispute"
            saving={proxySaving}
            onClose={() => setProxyDisputeTarget(null)}
            onConfirm={handleProxyDispute}
          />
        )}
      </CrmShell>

      {createOpen && (
        <CreateDialog
          onClose={() => { setCreateOpen(false); setSp({}, { replace: true }); }}
          onCreated={invalidate}
          navigate={navigate}
          prefillBookingId={prefillBookingId}
        />
      )}
    </>
  );
};

export default CrmPossessionNotice;
