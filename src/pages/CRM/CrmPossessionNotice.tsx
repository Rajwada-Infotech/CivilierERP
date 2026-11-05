// CRM Possession Notice: the formal offer of possession to a buyer. Draft, then sent, then the customer acknowledges
// (or disputes); an acknowledged notice lets Handover be scheduled. Issued once the Pre-Possession check is Ready and
// the OC / CC received.
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, FileText, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Send,
  ShieldAlert, StickyNote, Trash2, UserCircle2,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmDataTable, CrmRowMenu, type CrmColumn, type RowMenuItem } from "@/components/crm/CrmDataTable";
import { CrmListToolbar, type CrmStatusTab } from "@/components/crm/CrmListToolbar";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/possession-notice";
const DELIVERY_MODES = ["Email", "Post", "Courier", "InPerson"];
const MODE_LABEL: Record<string, string> = { Email: "Email", Post: "Post", Courier: "Courier", InPerson: "In person" };
const EMPTY_EDIT = { OfferedDate: "", ResponseDeadline: "", DeliveryMode: "", Notes: "" };

// Dates where the user is (toISOString gives the UTC date, a day behind before 05:30 IST), worked out when a notice
// is opened rather than once when the page first loaded.
const localDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const RESPONSE_DAYS = 15;
const newForm = (bookingId = "") => ({ BookingId: bookingId, OfferedDate: localDay(), ResponseDeadline: localDay(RESPONSE_DAYS), DeliveryMode: "Courier", Notes: "" });

const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// A sent notice's deadline: overdue in red, a week or less left noted.
function deadlineInfo(dl?: string | null, status?: string) {
  if (!dl || status !== "Sent") return null;
  const diff = Math.ceil((new Date(dl).getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, late: true };
  if (diff <= 7) return { label: `${diff}d left`, late: false };
  return null;
}

const STATUS_CONFIG: Record<string, { label: string; tone: "done" | "waiting" | "stopped"; accent: string }> = {
  Draft:        { label: "Draft",        tone: "waiting", accent: "border-l-foreground/20" },
  Sent:         { label: "Sent",         tone: "waiting", accent: "border-l-foreground/50" },
  Acknowledged: { label: "Acknowledged", tone: "done",    accent: "border-l-foreground" },
  Disputed:     { label: "Disputed",     tone: "stopped", accent: "border-l-destructive" },
};

interface NoticePage { rows: any[]; total: number; counts: Record<string, number> }
async function fetchPage(q: CrmListQuery): Promise<NoticePage> {
  const r = await fetchWithAuth(`${API}?${listParams(q)}`);
  if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error || `Could not load the notices (${r.status}).`); }
  const d = await r.json();
  return { rows: d.rows ?? [], total: d.total ?? 0, counts: d.counts ?? {} };
}
async function fetchEligible(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}

// The response deadline can't come before the offer.
const checkDates = (offered: string, deadline: string) => (offered && deadline && deadline < offered ? "The response deadline can't be before the offered date." : null);

const ModePicker: React.FC<{ value: string; onChange: (m: string) => void }> = ({ value, onChange }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4">
    {DELIVERY_MODES.map((m) => (
      <button key={m} type="button" onClick={() => onChange(m)} className={`${value === m ? KEY_INK : KEY_LINE} h-9`}>{MODE_LABEL[m]}</button>
    ))}
  </div>
);

const Head: React.FC<{ icon: React.ReactNode; title: string; destructive?: boolean }> = ({ icon, title, destructive }) => (
  <DialogHeader>
    <DialogTitle className={`font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2 ${destructive ? "text-destructive" : ""}`}>{icon} {title}</DialogTitle>
  </DialogHeader>
);
const Foot: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>{children}</div>;
const Field: React.FC<{ label: string; children: React.ReactNode; hint?: React.ReactNode }> = ({ label, children, hint }) => (
  <label className="block space-y-1"><span className={`block ${LBL}`}>{label}</span>{children}{hint && <span className="block text-[0.6875rem] text-muted-foreground">{hint}</span>}</label>
);

// ── New notice dialog ─────────────────────────────────────────────────────────
function CreateDialog({ onClose, onCreated, navigate, prefillBookingId }: {
  onClose: () => void; onCreated: () => void; navigate: ReturnType<typeof useNavigate>; prefillBookingId?: string;
}) {
  const [form, setForm] = useState(() => newForm(prefillBookingId ?? ""));
  const [saving, setSaving] = useState(false);
  const { data: eligible = [], isFetching } = useQuery({ queryKey: ["crm-possession-notice-eligible"], queryFn: fetchEligible, staleTime: 0 });

  const handleCreate = async () => {
    if (!form.BookingId) return void toast.error("Select a booking.");
    const problem = checkDates(form.OfferedDate, form.ResponseDeadline);
    if (problem) return void toast.error(problem);
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create the notice.");
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
      <DialogContent className="max-w-lg p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <Head icon={<FileText size={14} />} title="New possession notice" />
        <p className="text-xs text-muted-foreground -mt-2">A formal offer of possession; the customer acknowledges it by the response deadline.</p>
        {isFetching ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading eligible bookings…</p>
        ) : noEligible ? (
          <div className="text-xs px-3 py-2.5 space-y-2" style={{ border: RULE_SOFT }}>
            <p className="font-semibold flex items-center gap-1.5"><ShieldAlert size={13} /> No booking can be sent a notice yet</p>
            <ul className="space-y-1 text-muted-foreground list-disc pl-4">
              <li><strong className="text-foreground">Pre-Possession Ready:</strong> all four checks passed.</li>
              <li><strong className="text-foreground">OC / CC received</strong> for the project or block.</li>
            </ul>
            <p className="text-muted-foreground">A notice may go out with dues outstanding (it carries a dues statement); every due must be cleared before Handover.</p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { onClose(); navigate("/crm/pre-possession"); }} className={`${KEY_LINE} h-8 px-3`}>Pre-Possession <ChevronRight size={11} /></button>
              <button onClick={() => { onClose(); navigate("/crm/oc-cc"); }} className={`${KEY_LINE} h-8 px-3`}>OC / CC <ChevronRight size={11} /></button>
            </div>
          </div>
        ) : (
          <>
            {/* Plain text options: a component inside an option rendered no name. */}
            <Field label="Booking *">
              <SearchableSelect value={form.BookingId} onChange={(v) => setForm((f) => ({ ...f, BookingId: v }))} placeholder="Select booking"
                searchPlaceholder="Search booking, customer or unit…"
                options={(eligible as any[]).map((b: any) => ({ value: String(b.Id), label: [b.BookingNo, b.ApplicantName, b.UnitNo].filter(Boolean).join(" · ") }))} />
            </Field>
            {form.BookingId && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Offered on"><DateInput value={form.OfferedDate} onChange={(e) => setForm((f) => ({ ...f, OfferedDate: e.target.value }))} className={INP} /></Field>
                  <Field label="Respond by"><DateInput value={form.ResponseDeadline} onChange={(e) => setForm((f) => ({ ...f, ResponseDeadline: e.target.value }))} className={INP} /></Field>
                </div>
                <Field label="Delivery"><ModePicker value={form.DeliveryMode} onChange={(m) => setForm((f) => ({ ...f, DeliveryMode: m }))} /></Field>
                <Field label="Notes">
                  <textarea value={form.Notes} rows={2} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))} placeholder="Remarks about this notice" className={`${INP} h-auto py-2 resize-none`} />
                </Field>
              </>
            )}
          </>
        )}
        <Foot>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          {!noEligible && <button onClick={handleCreate} disabled={saving || !form.BookingId} className={`${KEY_INK} h-9 px-4`}>{saving ? "Creating…" : "Create notice"}</button>}
        </Foot>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const CrmPossessionNotice: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  // New notice needs the create right; every action on a notice the edit right (the server checks both; the page
  // offered them to anyone).
  const { canCreate, canEdit } = usePageRights("crm-possession-notice");

  const prefillBookingId = sp.get("bookingId") ?? undefined;
  const [createOpen, setCreateOpen] = useState(() => sp.get("open") === "1");
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_EDIT });
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [sentTarget, setSentTarget] = useState<any | null>(null);
  const [sentMode, setSentMode] = useState("");
  const [sentSaving, setSentSaving] = useState(false);
  const [ackTarget, setAckTarget] = useState<any | null>(null);
  const [ackSaving, setAckSaving] = useState(false);
  const [disputeDialog, setDisputeDialog] = useState<number | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [retractDialog, setRetractDialog] = useState<number | null>(null);
  const [retractReason, setRetractReason] = useState("");
  const [proxyAckTarget, setProxyAckTarget] = useState<number | null>(null);
  const [proxyDisputeTarget, setProxyDisputeTarget] = useState<number | null>(null);
  const [proxySaving, setProxySaving] = useState(false);

  const list = useCrmListState({ pageSize: 25, defaultSort: { key: "CreatedAt", dir: "desc" } });
  const { data, isLoading, isError, error, isFetching, refetch } =
    useQuery({ queryKey: ["crm-possession-notice", list.query], queryFn: () => fetchPage(list.query), staleTime: 30_000 });
  const pageData = useSticky(data);
  const rows = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const counts = pageData?.counts ?? {};
  const showOnboarding = !isLoading && !isError && (counts.All ?? 0) === 0 && !list.hasFilters;

  const invalidate = () => ["crm-possession-notice", "crm-possession-notice-eligible", "crm-booking-lifecycle", "crm-dashboard", "crm-legal-milestones", "crm-handover"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  // One call shape for every action: the server's message on refusal.
  const act = async (url: string, method: string, body?: unknown) => {
    const res = await fetchWithAuth(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "The notice could not be changed.");
    return d;
  };

  const openEdit = (n: any) => {
    setEditTarget(n);
    setEditForm({
      OfferedDate: n.OfferedDate ? String(n.OfferedDate).slice(0, 10) : "",
      ResponseDeadline: n.ResponseDeadline ? String(n.ResponseDeadline).slice(0, 10) : "",
      DeliveryMode: n.DeliveryMode || "", Notes: n.Notes || "",
    });
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    const problem = checkDates(editForm.OfferedDate, editForm.ResponseDeadline);
    if (problem) return void toast.error(problem);
    setEditSaving(true);
    try {
      await act(`${API}/${editTarget.Id}`, "PUT", {
        OfferedDate: editForm.OfferedDate || undefined, ResponseDeadline: editForm.ResponseDeadline || undefined,
        DeliveryMode: editForm.DeliveryMode || undefined, Notes: editForm.Notes,
      });
      toast.success("Notice saved");
      setEditTarget(null);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setEditSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      await act(`${API}/${deleteTarget.Id}`, "DELETE");
      toast.success(`Notice ${deleteTarget.NoticeNo} deleted`);
      setDeleteTarget(null);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setDeleteSaving(false); }
  };

  const handleMarkSent = async () => {
    if (!sentTarget) return;
    const mode = sentMode || sentTarget.DeliveryMode;
    if (!mode) return void toast.error("Pick how it was sent.");
    setSentSaving(true);
    try {
      await act(`${API}/${sentTarget.Id}/mark-sent`, "PUT", { DeliveryMode: mode });
      toast.success("Notice marked sent");
      setSentTarget(null); setSentMode("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSentSaving(false); }
  };

  // Acknowledging opens the way to Handover, so it asks first (it went through on one click).
  const handleMarkAcknowledged = async () => {
    if (!ackTarget) return;
    setAckSaving(true);
    try {
      await act(`${API}/${ackTarget.Id}/mark-acknowledged`, "PUT");
      toast.success("Notice acknowledged");
      setAckTarget(null);
      invalidate();
      promptNextStep(navigate, "Possession notice acknowledged: handover can now be scheduled.", "/crm/handover", "Go to Handover");
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setAckSaving(false); }
  };

  const handleMarkDisputed = async () => {
    if (!disputeDialog || !disputeReason.trim()) return void toast.error("Enter the customer's objection.");
    try {
      await act(`${API}/${disputeDialog}/mark-disputed`, "PUT", { DisputeReason: disputeReason.trim() });
      toast.success("Notice marked disputed");
      setDisputeDialog(null); setDisputeReason("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRetractDispute = async () => {
    if (!retractDialog || !retractReason.trim()) return void toast.error("Enter how it was resolved.");
    try {
      await act(`${API}/${retractDialog}/retract-dispute`, "PUT", { RetractReason: retractReason.trim() });
      toast.success("Dispute withdrawn; the notice is back to Draft");
      setRetractDialog(null); setRetractReason("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const proxy = (path: "proxy-acknowledge" | "proxy-dispute") => async (method: ProxyMethod, remarks: string) => {
    const id = path === "proxy-acknowledge" ? proxyAckTarget : proxyDisputeTarget;
    if (!id) return;
    setProxySaving(true);
    try {
      await act(`${API}/${id}/${path}`, "PUT", { ProxyMethod: method, ProxyRemarks: remarks });
      toast.success(path === "proxy-acknowledge" ? "Customer's acknowledgement recorded" : "Customer's dispute recorded");
      setProxyAckTarget(null); setProxyDisputeTarget(null);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const tabs: CrmStatusTab[] = [
    { key: "All", label: "All", count: counts.All ?? 0 },
    { key: CrmStatus.DRAFT, label: "Draft", count: counts[CrmStatus.DRAFT] ?? 0, dot: "bg-foreground/20" },
    { key: "Sent", label: "Sent", count: counts.Sent ?? 0, dot: "bg-foreground/50" },
    { key: "Acknowledged", label: "Acknowledged", count: counts.Acknowledged ?? 0, dot: "bg-foreground" },
    { key: "Disputed", label: "Disputed", count: counts.Disputed ?? 0, dot: "bg-destructive" },
  ];

  // One main action per row; the rest in the ⋯ menu. All need the edit right.
  const renderActions = (n: any) => {
    let primary: React.ReactNode = null;
    let items: RowMenuItem[] = [];
    if (canEdit && n.Status === CrmStatus.DRAFT) {
      primary = <button onClick={() => { setSentTarget(n); setSentMode(n.DeliveryMode || ""); }} className={`${KEY_INK} h-7 px-2.5`}><Send size={11} /> Mark sent</button>;
      items = [
        { label: "Edit", icon: Pencil, onClick: () => openEdit(n) },
        { label: "Delete", icon: Trash2, danger: true, onClick: () => setDeleteTarget(n) },
      ];
    } else if (canEdit && n.Status === "Sent") {
      primary = <button onClick={() => setAckTarget(n)} className={`${KEY_INK} h-7 px-2.5`}><CheckCircle2 size={11} /> Acknowledge</button>;
      items = [
        { label: "Mark disputed", icon: AlertTriangle, onClick: () => { setDisputeDialog(n.Id); setDisputeReason(""); } },
        { heading: "Customer replied off the portal" },
        { label: "Record acknowledgement", icon: UserCircle2, onClick: () => setProxyAckTarget(n.Id) },
        { label: "Record dispute", icon: UserCircle2, onClick: () => setProxyDisputeTarget(n.Id) },
      ];
    } else if (canEdit && n.Status === "Disputed") {
      primary = <button onClick={() => { setRetractDialog(n.Id); setRetractReason(""); }} className={`${KEY_LINE} h-7 px-2.5`}><RotateCcw size={11} /> Withdraw dispute</button>;
    } else if (n.Status === "Acknowledged") {
      primary = <button onClick={() => navigate(`/crm/handover?bookingId=${n.BookingId}`)} className={`${KEY_LINE} h-7 px-2.5`}>Handover <ArrowRight size={11} /></button>;
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
        <span className="font-heading text-xs font-semibold tabular-nums whitespace-nowrap">{n.NoticeNo}</span>
        {n.Notes && <span title={n.Notes}><StickyNote size={11} className="text-muted-foreground" /></span>}
      </span>
    ) },
    { key: "applicant", header: "Customer", sortKey: "ApplicantName", cell: (n) => (
      <span className="font-medium block truncate max-w-[220px]" title={n.ApplicantName}><ApplicantNames name={n.ApplicantName} bookingId={n.BookingId} applicationId={n.ApplicationId} /></span>
    ) },
    { key: "booking", header: "Booking", sortKey: "BookingNo", className: "hidden md:table-cell",
      cell: (n) => <span className="font-heading text-xs tabular-nums text-muted-foreground whitespace-nowrap">{n.BookingNo}</span> },
    { key: "unit", header: "Unit", className: "hidden md:table-cell", cell: (n) => <span className="text-xs whitespace-nowrap">{n.UnitNo}</span> },
    { key: "status", header: "Status", sortKey: "Status", cell: (n) => {
      const cfg = STATUS_CONFIG[n.Status] ?? STATUS_CONFIG.Draft;
      return <SheetMark text={cfg.label} tone={cfg.tone} />;
    } },
    { key: "mode", header: "Sent by", className: "hidden xl:table-cell", cell: (n) => <span className="text-xs text-muted-foreground whitespace-nowrap">{n.DeliveryMode ? MODE_LABEL[n.DeliveryMode] ?? n.DeliveryMode : "—"}</span> },
    { key: "offered", header: "Offered", sortKey: "OfferedDate", className: "hidden lg:table-cell", cell: (n) => <span className="text-xs whitespace-nowrap tabular-nums">{fmtDate(n.OfferedDate)}</span> },
    { key: "deadline", header: "Respond by", sortKey: "ResponseDeadline", cell: (n) => {
      const dl = deadlineInfo(n.ResponseDeadline, n.Status);
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
          <span className="text-xs">{fmtDate(n.ResponseDeadline)}</span>
          {dl && <span className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em] ${dl.late ? "text-destructive" : "text-muted-foreground"}`}>{dl.label}</span>}
        </span>
      );
    } },
    { key: "dues", header: "Dues", align: "right", cell: (n) => n.OutstandingMilestones > 0 ? (
      <span className="font-heading text-xs font-bold text-destructive tabular-nums whitespace-nowrap"
        title={`${n.OutstandingMilestones} milestone(s) outstanding: to be cleared before Handover`}>{fmtRupees(n.OutstandingBalance)}</span>
    ) : <span className="text-xs text-muted-foreground" title="All dues cleared">Clear</span> },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-px whitespace-nowrap", cell: renderActions },
  ];

  const openNew = () => { setSp({}, { replace: true }); setCreateOpen(true); };
  const figures = [
    { label: "Notices", value: counts.All ?? 0, note: `${counts[CrmStatus.DRAFT] ?? 0} still in draft`, go: "All" },
    { label: "Sent", value: counts.Sent ?? 0, note: "Waiting for the customer", go: "Sent" },
    { label: "Acknowledged", value: counts.Acknowledged ?? 0, note: "Handover can be scheduled", go: "Acknowledged" },
    { label: "Disputed", value: counts.Disputed ?? 0, note: "Objection to settle", go: "Disputed" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Possession Notice"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Possession"
        title="Possession Notice"
        subtitle="The formal offer of possession to a buyer. It must be acknowledged before Handover is scheduled."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {canCreate && <button onClick={openNew} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New notice</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => list.setStatus(x.go)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          {showOnboarding ? (
            <div className="bg-card" style={{ border: RULE }}>
              <div className="py-10 text-center space-y-3 px-4" style={{ borderBottom: RULE }}>
                <FileText size={22} className="mx-auto text-muted-foreground" />
                <p className="font-medium text-foreground">No possession notices yet</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">Issue one once the Pre-Possession check is Ready and the project's OC / CC is received.</p>
                <div className="flex justify-center gap-2">
                  <button onClick={() => navigate("/crm/pre-possession")} className={`${KEY_LINE} h-9 px-3`}>Pre-Possession <ChevronRight size={12} /></button>
                  {canCreate && <button onClick={openNew} className={`${KEY_INK} h-9 px-3`}><Plus size={12} /> New notice</button>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4">
                {[["Draft", "Dates and delivery"], ["Sent", "Sent by the chosen means"], ["Customer replies", "Acknowledges or objects"], ["Acknowledged", "Handover can be scheduled"]].map(([t, s], i) => (
                  <div key={t} className="px-4 py-3" style={i < 3 ? { borderRight: RULE_SOFT } : undefined}>
                    <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.1em]"><span className="tabular-nums text-muted-foreground mr-1.5">{i + 1}</span>{t}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <CrmListToolbar tabs={tabs} status={list.status} onStatus={list.setStatus}
                searchValue={list.searchInput} onSearch={list.setSearchInput} placeholder="Search notice, customer, booking, unit…">
                <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              </CrmListToolbar>
              <CrmDataTable
                columns={columns} rows={rows} rowKey={(n) => n.Id}
                loading={isLoading} fetching={isFetching}
                error={isError ? (error as Error)?.message : null} onRetry={() => refetch()}
                sort={list.sort} onSort={list.toggleSort}
                rowAccent={(n) => (STATUS_CONFIG[n.Status] ?? STATUS_CONFIG.Draft).accent}
                empty={<>No notice matches these filters. <button onClick={list.reset} className="font-semibold text-foreground hover:underline ml-1">Clear filters</button></>}
                page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage}
              />
            </div>
          )}
        </div>
      </SheetShell>

      <Dialog open={!!sentTarget} onOpenChange={(o) => { if (!o) { setSentTarget(null); setSentMode(""); } }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Head icon={<Send size={14} />} title="Mark sent" />
          {sentTarget && <p className="text-xs text-muted-foreground -mt-2 tabular-nums">{sentTarget.NoticeNo} · {sentTarget.ApplicantName}</p>}
          <Field label="Sent by *"><ModePicker value={sentMode} onChange={setSentMode} /></Field>
          <Foot>
            <button onClick={() => { setSentTarget(null); setSentMode(""); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleMarkSent} disabled={sentSaving || !sentMode} className={`${KEY_INK} h-9 px-4`}>{sentSaving ? "Marking…" : "Mark sent"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ackTarget} onOpenChange={(o) => { if (!o) setAckTarget(null); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Head icon={<CheckCircle2 size={14} />} title="Acknowledge notice" />
          {ackTarget && <p className="text-sm">The customer has accepted <span className="font-heading font-bold tabular-nums">{ackTarget.NoticeNo}</span> ({ackTarget.ApplicantName}). Handover can then be scheduled.</p>}
          <Foot>
            <button onClick={() => setAckTarget(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleMarkAcknowledged} disabled={ackSaving} className={`${KEY_INK} h-9 px-4`}>{ackSaving ? "Saving…" : "Acknowledge"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Head icon={<Pencil size={14} />} title={`Edit draft · ${editTarget?.NoticeNo ?? ""}`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Offered on"><DateInput value={editForm.OfferedDate} onChange={(e) => setEditForm((f) => ({ ...f, OfferedDate: e.target.value }))} className={INP} /></Field>
            <Field label="Respond by"><DateInput value={editForm.ResponseDeadline} onChange={(e) => setEditForm((f) => ({ ...f, ResponseDeadline: e.target.value }))} className={INP} /></Field>
          </div>
          <Field label="Delivery"><ModePicker value={editForm.DeliveryMode} onChange={(m) => setEditForm((f) => ({ ...f, DeliveryMode: m }))} /></Field>
          <Field label="Notes">
            <textarea value={editForm.Notes} rows={2} onChange={(e) => setEditForm((f) => ({ ...f, Notes: e.target.value }))} className={`${INP} h-auto py-2 resize-none`} />
          </Field>
          <Foot>
            <button onClick={() => setEditTarget(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleEdit} disabled={editSaving} className={`${KEY_INK} h-9 px-4`}>{editSaving ? "Saving…" : "Save"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Head icon={<Trash2 size={14} />} title="Delete notice" destructive />
          <p className="text-sm">Delete <span className="font-heading font-bold tabular-nums">{deleteTarget?.NoticeNo}</span> ({deleteTarget?.ApplicantName}) for good? A new notice can then be issued for the booking. Only drafts can be deleted.</p>
          <Foot>
            <button onClick={() => setDeleteTarget(null)} className={`${KEY_LINE} h-9 px-4`}>Keep</button>
            <button onClick={handleDelete} disabled={deleteSaving} className={`${KEY_RED} h-9 px-4`}>{deleteSaving ? "Deleting…" : "Delete"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={!!disputeDialog} onOpenChange={(o) => { if (!o) { setDisputeDialog(null); setDisputeReason(""); } }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Head icon={<AlertTriangle size={14} />} title="Mark disputed" destructive />
          <p className="text-xs text-muted-foreground -mt-2">The notice stays disputed until the objection is settled and it is withdrawn and sent again.</p>
          <Field label="Customer's objection *">
            <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} rows={3} placeholder="What the customer objects to" className={`${INP} h-auto py-2 resize-none`} />
          </Field>
          <Foot>
            <button onClick={() => { setDisputeDialog(null); setDisputeReason(""); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleMarkDisputed} disabled={!disputeReason.trim()} className={`${KEY_RED} h-9 px-4`}>Mark disputed</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={!!retractDialog} onOpenChange={(o) => { if (!o) { setRetractDialog(null); setRetractReason(""); } }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Head icon={<RotateCcw size={14} />} title="Withdraw dispute" />
          <p className="text-xs text-muted-foreground -mt-2">The notice goes back to Draft so it can be revised and sent again.</p>
          <Field label="How it was settled *">
            <textarea value={retractReason} onChange={(e) => setRetractReason(e.target.value)} rows={3} placeholder="How the objection was resolved" className={`${INP} h-auto py-2 resize-none`} />
          </Field>
          <Foot>
            <button onClick={() => { setRetractDialog(null); setRetractReason(""); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleRetractDispute} disabled={!retractReason.trim()} className={`${KEY_INK} h-9 px-4`}>Back to draft</button>
          </Foot>
        </DialogContent>
      </Dialog>

      {proxyAckTarget !== null && (
        <ProxyActionDialog title="Record customer's acknowledgement"
          description="The customer acknowledged the possession notice without using their portal."
          confirmLabel="Record acknowledgement" saving={proxySaving} onClose={() => setProxyAckTarget(null)} onConfirm={proxy("proxy-acknowledge")} />
      )}
      {proxyDisputeTarget !== null && (
        <ProxyActionDialog title="Record customer's dispute"
          description="The customer disputed the possession notice without using their portal. Put their reason in the notes."
          confirmLabel="Record dispute" saving={proxySaving} onClose={() => setProxyDisputeTarget(null)} onConfirm={proxy("proxy-dispute")} />
      )}

      {createOpen && canCreate && (
        <CreateDialog onClose={() => { setCreateOpen(false); setSp({}, { replace: true }); }} onCreated={invalidate} navigate={navigate} prefillBookingId={prefillBookingId} />
      )}
    </>
  );
};

export default CrmPossessionNotice;
