import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState } from "react";
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
  CalendarDays, Clock, ArrowRight, StickyNote,
} from "lucide-react";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { cn } from "@/lib/utils";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmDataTable, CrmRowMenu, type CrmColumn, type RowMenuItem } from "@/components/crm/CrmDataTable";
import { CrmListToolbar, type CrmStatusTab } from "@/components/crm/CrmListToolbar";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";

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
const STATUS_CONFIG: Record<string, { label: string; badgeCls: string; accent: string; Icon: React.ElementType }> = {
  Draft:        { label: "Draft",        badgeCls: "text-slate-600 bg-slate-100 border-slate-300", accent: "border-l-slate-300", Icon: FileText      },
  Sent:         { label: "Sent",         badgeCls: "text-blue-600 bg-blue-50 border-blue-200",     accent: "border-l-blue-400",  Icon: Send          },
  Acknowledged: { label: "Acknowledged", badgeCls: "text-green-700 bg-green-50 border-green-200",  accent: "border-l-green-500", Icon: CheckCircle2  },
  Disputed:     { label: "Disputed",     badgeCls: "text-red-600 bg-red-50 border-red-200",        accent: "border-l-red-500",   Icon: AlertTriangle },
};

const moneyCompact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

// ── Fetchers ──────────────────────────────────────────────────────────────────
// Server-side paging: rows for one page + per-status counts (counts ignore the
// status filter so the tabs stay stable while you switch between them).
interface NoticePage { rows: any[]; total: number; counts: Record<string, number> }
async function fetchPage(q: CrmListQuery): Promise<NoticePage> {
  const r = await fetchWithAuth(`${API}?${listParams(q)}`);
  if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error || `HTTP ${r.status}`); }
  const d = await r.json();
  return { rows: d.rows ?? [], total: d.total ?? 0, counts: d.counts ?? {} };
}
async function fetchEligible(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}

// ── Delivery mode ─────────────────────────────────────────────────────────────
const MODE_ICON: Record<string, string> = { Email: "✉", Post: "📮", Courier: "📦", InPerson: "🤝" };
function ModeBadge({ mode }: { mode?: string | null }) {
  if (!mode) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className="text-xs text-muted-foreground whitespace-nowrap">{MODE_ICON[mode] ?? "📄"} {mode}</span>;
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
      <DialogContent accent="crm" className="max-w-lg">
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
                <p className="text-[10px] text-amber-600 pt-1 leading-relaxed">
                  Note: the notice may be issued even if dues are outstanding — it serves as a formal offer with a dues statement attached. All dues must be cleared before the actual <strong>Handover</strong>.
                </p>
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

// ── Main page ─────────────────────────────────────────────────────────────────
const CrmPossessionNotice: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  usePageRights("crm-possession-notice");

  const prefillBookingId = sp.get("bookingId") ?? undefined;
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

  const list = useCrmListState({ pageSize: 25, defaultSort: { key: "CreatedAt", dir: "desc" } });
  const { data, isLoading, isError, error, dataUpdatedAt, isFetching, refetch } =
    useQuery({ queryKey: ["crm-possession-notice", list.query], queryFn: () => fetchPage(list.query), staleTime: 30_000 });
  const pageData = useSticky(data);
  const rows = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const counts = pageData?.counts ?? {};
  const showOnboarding = !isLoading && !isError && (counts.All ?? 0) === 0 && !list.hasFilters;

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
          Notes:            editForm.Notes,
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

  const tabs: CrmStatusTab[] = [
    { key: "All",           label: "All",          count: counts.All ?? 0 },
    { key: CrmStatus.DRAFT, label: "Draft",        count: counts[CrmStatus.DRAFT] ?? 0, dot: "bg-slate-400" },
    { key: "Sent",          label: "Sent",         count: counts.Sent ?? 0,             dot: "bg-blue-500"  },
    { key: "Acknowledged",  label: "Acknowledged", count: counts.Acknowledged ?? 0,     dot: "bg-green-500" },
    { key: "Disputed",      label: "Disputed",     count: counts.Disputed ?? 0,         dot: "bg-red-500"   },
  ];

  // One primary action per row; everything else lives in the ⋯ menu.
  const renderActions = (n: any) => {
    const btn = "inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md transition-colors whitespace-nowrap";
    let primary: React.ReactNode = null;
    let items: RowMenuItem[] = [];

    if (n.Status === CrmStatus.DRAFT) {
      primary = (
        <button onClick={() => { setSentTarget(n); setSentMode(n.DeliveryMode || ""); }}
          className={cn(btn, "bg-blue-600 text-white hover:bg-blue-700")}><Send size={11} /> Mark sent</button>
      );
      items = [
        { label: "Edit",   icon: Pencil, onClick: () => openEdit(n) },
        { label: "Delete", icon: Trash2, danger: true, onClick: () => setDeleteTarget(n) },
      ];
    } else if (n.Status === "Sent") {
      primary = (
        <button onClick={() => handleMarkAcknowledged(n.Id)}
          className={cn(btn, "bg-green-600 text-white hover:bg-green-700")}><CheckCircle2 size={11} /> Acknowledge</button>
      );
      items = [
        { label: "Mark disputed", icon: AlertTriangle, onClick: () => { setDisputeDialog(n.Id); setDisputeReason(""); } },
        { heading: "Customer replied off-portal" },
        { label: "Record acknowledgement", icon: UserCircle2, onClick: () => setProxyAckTarget(n.Id) },
        { label: "Record dispute",         icon: UserCircle2, onClick: () => setProxyDisputeTarget(n.Id) },
      ];
    } else if (n.Status === "Disputed") {
      primary = (
        <button onClick={() => { setRetractDialog(n.Id); setRetractReason(""); }}
          className={cn(btn, "bg-amber-500 text-white hover:bg-amber-600")}><RotateCcw size={11} /> Retract</button>
      );
    } else if (n.Status === "Acknowledged") {
      primary = (
        <button onClick={() => navigate(`/crm/handover?bookingId=${n.BookingId}`)}
          className={cn(btn, "bg-primary text-primary-foreground hover:bg-primary/90")}>Handover <ArrowRight size={11} /></button>
      );
    }

    return (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {primary}
        <CrmRowMenu items={items} />
      </div>
    );
  };

  const columns: CrmColumn<any>[] = [
    { key: "notice", header: "Notice", sortKey: "NoticeNo", cell: (n) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{n.NoticeNo}</span>
        {n.Notes && <span title={n.Notes}><StickyNote size={11} className="text-muted-foreground" /></span>}
      </span>
    ) },
    { key: "applicant", header: "Applicant", sortKey: "ApplicantName", cell: (n) => (
      <span className="font-medium block truncate max-w-[220px]" title={n.ApplicantName}>{n.ApplicantName}</span>
    ) },
    { key: "booking", header: "Booking", sortKey: "BookingNo", className: "hidden md:table-cell",
      cell: (n) => <span className="text-xs text-muted-foreground whitespace-nowrap">{n.BookingNo}</span> },
    { key: "unit", header: "Unit", className: "hidden md:table-cell",
      cell: (n) => <span className="text-xs whitespace-nowrap">{n.UnitNo}</span> },
    { key: "status", header: "Status", sortKey: "Status", cell: (n) => {
      const cfg = STATUS_CONFIG[n.Status] ?? STATUS_CONFIG.Draft;
      return (
        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap", cfg.badgeCls)}>
          <cfg.Icon size={10} />{cfg.label}
        </span>
      );
    } },
    { key: "mode", header: "Mode", className: "hidden xl:table-cell", cell: (n) => <ModeBadge mode={n.DeliveryMode} /> },
    { key: "offered", header: "Offered", sortKey: "OfferedDate", className: "hidden lg:table-cell",
      cell: (n) => <span className="text-xs whitespace-nowrap">{fmtDate(n.OfferedDate)}</span> },
    { key: "deadline", header: "Deadline", sortKey: "ResponseDeadline", cell: (n) => {
      const dl = deadlineInfo(n.ResponseDeadline, n.Status);
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-xs">{fmtDate(n.ResponseDeadline)}</span>
          {dl && <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", dl.cls)}>{dl.label}</span>}
        </span>
      );
    } },
    { key: "dues", header: "Dues", align: "right", cell: (n) => n.OutstandingMilestones > 0 ? (
      <span className="text-xs font-semibold text-red-600 tabular-nums whitespace-nowrap"
        title={`${n.OutstandingMilestones} milestone(s) outstanding · ₹${Math.round(n.OutstandingBalance).toLocaleString("en-IN")} — must be cleared before Handover`}>
        ₹{moneyCompact.format(n.OutstandingBalance)}
      </span>
    ) : (
      <span title="All dues cleared"><CheckCircle2 size={14} className="text-green-600 inline" /></span>
    ) },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-px whitespace-nowrap", cell: renderActions },
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
        {!showOnboarding && (
          <div className="space-y-3">
            <CrmListToolbar
              tabs={tabs} status={list.status} onStatus={list.setStatus}
              searchValue={list.searchInput} onSearch={list.setSearchInput}
              placeholder="Search notice, applicant, booking, unit…">
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
            </CrmListToolbar>

            <CrmDataTable
              columns={columns}
              rows={rows}
              rowKey={(n) => n.Id}
              loading={isLoading}
              fetching={isFetching}
              error={isError ? (error as Error)?.message : null}
              onRetry={() => refetch()}
              sort={list.sort}
              onSort={list.toggleSort}
              rowAccent={(n) => (STATUS_CONFIG[n.Status] ?? STATUS_CONFIG.Draft).accent}
              empty={<>No notices match these filters. <button onClick={list.reset} className="text-primary hover:underline ml-1">Clear filters</button></>}
              page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage}
            />
          </div>
        )}

        {/* Empty state */}
        {showOnboarding && (
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
          <DialogContent accent="crm" className="max-w-sm">
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
          <DialogContent accent="crm" className="max-w-md">
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
          <DialogContent accent="crm" className="max-w-sm">
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
          <DialogContent accent="crm" className="max-w-sm">
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
          <DialogContent accent="crm" className="max-w-sm">
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