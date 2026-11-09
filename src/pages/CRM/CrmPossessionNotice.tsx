// CRM Possession Notice: the formal offer of possession to a buyer. Draft, then sent, then the customer acknowledges
// (or disputes); an acknowledged notice lets Handover be scheduled. Issued once the Pre-Possession check is Ready and
// the OC / CC received.
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Download, ExternalLink, FileText, ListChecks, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Send,
  ShieldAlert, StickyNote, Trash2, UserCircle2,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, CrmRowMenu, GridColumnChooser, GridMiniTable, GridRelated, GridSavedViews, GridSearch, GridTabs,
  exportGrid, useGridPrefs, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol, type RowMenuItem,
} from "@/components/crm/CrmDataTable";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, CollectionBar, Initials, MoneyBand, asName } from "./payments/parts";
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
async function fetchNotice(id: string): Promise<any> {
  const r = await fetchWithAuth(`${API}/${encodeURIComponent(id)}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load this notice.");
  return d;
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
              <li><strong className="text-foreground">Pre-Possession Ready:</strong> dues cleared and all three checks passed.</li>
              <li><strong className="text-foreground">OC / CC received</strong> for the project or block.</li>
            </ul>
            <p className="text-muted-foreground">Pre-Possession is Ready only once every due is cleared.</p>
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

// A notice's steps. Disputed stops at the customer's reply.
const STEPS = ["Draft", "Sent", "Acknowledged"];
const stepOf = (s: string) => (s === "Acknowledged" ? 3 : s === "Sent" || s === "Disputed" ? 2 : 1);
function StepBar({ status, onDark }: { status: string; onDark?: boolean }) {
  const done = stepOf(status);
  const off = onDark ? "bg-white/15" : "bg-slate-200 dark:bg-slate-700";
  return (
    <span className="flex gap-0.5 w-full">
      {STEPS.map((s, i) => (
        <span key={s} className={cn("flex-1 rounded-full", onDark ? "h-2.5" : "h-1.5",
          i < done ? (done === STEPS.length ? (onDark ? BAND_DOT.collected : "bg-emerald-500") : (onDark ? BAND_DOT.finance : "bg-amber-400"))
            : status === "Disputed" && i === done ? "bg-rose-500" : off)} />
      ))}
    </span>
  );
}
const noticeDash = <span className="text-muted-foreground">—</span>;
const modeText = (m?: string | null) => (m ? MODE_LABEL[m] ?? m : "—");
const duesCell = (n: any) => (n.OutstandingMilestones > 0
  ? <span className="tabular-nums font-semibold text-destructive" title={`${n.OutstandingMilestones} milestone(s) outstanding: to be cleared before Handover`}>{fmtRupees(n.OutstandingBalance)}</span>
  : <span className="text-muted-foreground">Clear</span>);

function buildCols(actions: (n: any) => React.ReactNode): GridCol<any>[] {
  return [
    { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (n) => n.ApplicantName, cell: (n) => (
      <span className="flex items-center gap-3 py-1.5 min-w-0">
        <Initials name={n.ApplicantName} />
        <span className="min-w-0">
          <span className="block font-semibold text-foreground capitalize truncate" title={n.ApplicantName}>{asName(n.ApplicantName)}</span>
          <span className="block text-xs text-muted-foreground tabular-nums truncate">{n.NoticeNo} · {n.BookingNo} · {n.UnitNo}</span>
        </span>
      </span>
    ) },
    { id: "progress", label: "Progress", sortKey: "Status", csv: (n) => (STATUS_CONFIG[n.Status] ?? STATUS_CONFIG.Draft).label, cell: (n) => (
      <span className="block min-w-[12rem] py-1.5">
        <StepBar status={n.Status} />
        <span className="mt-1.5 flex justify-between gap-3 text-xs">
          <span className={cn("font-medium", n.Status === "Disputed" ? "text-destructive" : "text-foreground")} title={n.DisputeReason || undefined}>{(STATUS_CONFIG[n.Status] ?? STATUS_CONFIG.Draft).label}</span>
          <span className="text-muted-foreground">{n.DeliveryMode ? modeText(n.DeliveryMode) : ""}</span>
        </span>
      </span>
    ) },
    { id: "offered", label: "Offered on", sortKey: "OfferedDate", csv: (n) => n.OfferedDate, cell: (n) => <span className="tabular-nums">{fmtDate(n.OfferedDate)}</span> },
    { id: "deadline", label: "Respond by", sortKey: "ResponseDeadline", csv: (n) => n.ResponseDeadline, cell: (n) => {
      const dl = deadlineInfo(n.ResponseDeadline, n.Status);
      return (
        <span className="inline-flex flex-col leading-tight">
          <span className="tabular-nums">{fmtDate(n.ResponseDeadline)}</span>
          {dl && <span className={cn("mt-0.5 text-xs tabular-nums", dl.late ? "font-semibold text-destructive" : "text-muted-foreground")}>{dl.label}</span>}
        </span>
      );
    } },
    { id: "dues", label: "Dues", align: "right", csv: (n) => n.OutstandingBalance, cell: duesCell },
    { id: "act", label: "Actions", locked: true, cell: actions },
    { id: "no", label: "Notice no", hiddenByDefault: true, sortKey: "NoticeNo", csv: (n) => n.NoticeNo, cell: (n) => <span className="tabular-nums">{n.NoticeNo}</span> },
    { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", csv: (n) => n.BookingNo, cell: (n) => <span className="tabular-nums">{n.BookingNo}</span> },
    { id: "unit", label: "Unit", hiddenByDefault: true, csv: (n) => n.UnitNo, cell: (n) => n.UnitNo },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (n) => n.Mobile, cell: (n) => <span className="tabular-nums">{n.Mobile || "—"}</span> },
    { id: "mode", label: "Sent by", hiddenByDefault: true, csv: (n) => n.DeliveryMode, cell: (n) => modeText(n.DeliveryMode) },
    { id: "sent", label: "Sent on", hiddenByDefault: true, csv: (n) => n.SentAt, cell: (n) => (n.SentAt ? <span className="tabular-nums">{fmtDate(n.SentAt)}</span> : noticeDash) },
    { id: "ack", label: "Acknowledged on", hiddenByDefault: true, csv: (n) => n.AcknowledgedAt, cell: (n) => (n.AcknowledgedAt ? <span className="tabular-nums">{fmtDate(n.AcknowledgedAt)}</span> : noticeDash) },
    { id: "reason", label: "Objection", hiddenByDefault: true, csv: (n) => n.DisputeReason, cell: (n) => n.DisputeReason || "—" },
    { id: "notes", label: "Notes", hiddenByDefault: true, csv: (n) => n.Notes, cell: (n) => n.Notes || "—" },
  ];
}

function nextLine(n: any): string {
  switch (n.Status) {
    case "Draft": return "Draft. It has not gone to the customer yet.";
    case "Sent": return "Waiting for the customer to acknowledge or object.";
    case "Acknowledged": return "The customer has accepted. Handover can be scheduled once every due is cleared.";
    case "Disputed": return `The customer objected${n.DisputeReason ? `: ${n.DisputeReason}` : "."} Settle it, then withdraw the dispute to send a revised notice.`;
    default: return "";
  }
}

/** One notice on its own page: where it stands, every step with its date, and its notes. */
function NoticeRecord({ id, actions, onBack }: { id: string; actions: (n: any) => React.ReactNode; onBack: () => void }) {
  const { data: n, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-possession-notice", "record", id], queryFn: () => fetchNotice(id), retry: false });
  if (isLoading) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !n) return (
    <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
      <p className="text-destructive">{translateError((error as Error)?.message || "Notice not found")}</p>
      <button type="button" onClick={onBack} className={cn(GRID_BTN, "mt-3")}>All notices</button>
    </div>
  );
  const cfg = STATUS_CONFIG[n.Status] ?? STATUS_CONFIG.Draft;
  const dl = deadlineInfo(n.ResponseDeadline, n.Status);
  const steps = [
    { step: "Created", at: n.CreatedAt }, { step: "Sent", at: n.SentAt, note: n.DeliveryMode ? `By ${modeText(n.DeliveryMode)}` : "" },
    { step: "Acknowledged", at: n.AcknowledgedAt }, { step: "Disputed", at: n.DisputedAt, note: n.DisputeReason },
  ].filter((s) => s.at);
  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Possession Notice · ${n.NoticeNo}`} title={<span className="capitalize">{asName(n.ApplicantName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{cfg.label}</span>}
        sub={[n.BookingNo, n.UnitNo, n.Mobile].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All notices</button>
          <Link to={`/crm/bookings?view=${n.BookingId}`} className={BAND_KEY}><ExternalLink size={13} /> Open booking</Link>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={cfg.label} leadNote={`step ${stepOf(n.Status)} of ${STEPS.length}`}
        bar={<StepBar status={n.Status} onDark />}
        figures={[
          { label: "Offered on", value: fmtDate(n.OfferedDate), note: "Date of the offer" },
          { label: "Respond by", dot: dl?.late ? BAND_DOT.overdue : undefined, value: fmtDate(n.ResponseDeadline), note: dl ? dl.label : "Customer's deadline", alert: !!dl?.late },
          { label: "Sent by", value: modeText(n.DeliveryMode), note: n.SentAt ? `On ${fmtDate(n.SentAt)}` : "Not sent yet" },
          { label: "Dues", dot: n.OutstandingMilestones > 0 ? BAND_DOT.overdue : BAND_DOT.collected, value: n.OutstandingMilestones > 0 ? fmtRupees(n.OutstandingBalance) : "Clear", note: n.OutstandingMilestones > 0 ? "Clear before Handover" : "Nothing outstanding", alert: n.OutstandingMilestones > 0 },
        ]}
        footer={nextLine(n)} />
      <GridRelated icon={ListChecks} title="Actions and steps" action={actions(n)}>
        <GridMiniTable rows={steps} rowKey={(s) => s.step} empty="No steps recorded." cols={[
          { header: "Step", cell: (s) => <span className="font-medium">{s.step}</span> },
          { header: "When", cell: (s) => <span className="tabular-nums">{fmtDate(s.at)}</span> },
          { header: "Details", cell: (s) => <span className="text-muted-foreground whitespace-normal">{s.note || "—"}</span> },
        ]} />
      </GridRelated>
      <GridRelated icon={StickyNote} title="Notes">
        <p className="px-4 py-3 text-[0.8125rem] whitespace-pre-wrap">{n.Notes || <span className="text-muted-foreground">No notes.</span>}</p>
      </GridRelated>
    </div>
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

  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const [exporting, setExporting] = useState(false);
  const list = useCrmListState({ pageSize, defaultSort: { key: "CreatedAt", dir: "desc" } });
  // The open notice lives in the address, so a refresh or a shared link lands on it (?open=1 is the New Notice link).
  const noticeId = sp.get("notice");
  const openNotice = (id: number) => setSp((p) => { p.set("notice", String(id)); return p; });
  const closeNotice = () => setSp((p) => { p.delete("notice"); return p; });
  const { data, isLoading, isError, error, isFetching, refetch } =
    useQuery({ queryKey: ["crm-possession-notice", list.query], queryFn: () => fetchPage(list.query), staleTime: 30_000 });
  const pageData = useSticky(data);
  const rows = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const counts = pageData?.counts ?? {};

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
      <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {primary}
        <CrmRowMenu items={items} />
      </div>
    );
  };

  const noticeCols = buildCols(renderActions);
  const [prefs, setPrefs] = useGridPrefs("crm-possession-notice-cols-v1", noticeCols);
  const all = counts.All ?? 0, ack = counts.Acknowledged ?? 0, sent = counts.Sent ?? 0, draft = counts[CrmStatus.DRAFT] ?? 0, disputed = counts.Disputed ?? 0, late = counts.Overdue ?? 0;
  const tabs: { key: string; label: string; count: number | null }[] = [
    { key: "All", label: "All notices", count: all }, { key: CrmStatus.DRAFT, label: "Draft", count: draft }, { key: "Sent", label: "Sent", count: sent },
    { key: "Overdue", label: "Response overdue", count: late }, { key: "Acknowledged", label: "Acknowledged", count: ack }, { key: "Disputed", label: "Disputed", count: disputed },
  ].map((t) => ({ ...t, count: pageData ? t.count : null }));
  const openNew = () => { setSp({}, { replace: true }); setCreateOpen(true); };
  const refreshBtn = (
    <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
  );
  const handleExport = async () => {
    setExporting(true);
    try {
      const url = (n: number) => ({ ...list.query, page: n, pageSize: 100 });
      const first = await fetchPage(url(1));
      let out = first.rows;
      for (let n = 2; out.length < first.total; n++) { const more = await fetchPage(url(n)); if (!more.rows.length) break; out = out.concat(more.rows); }
      exportGrid(out, noticeCols, `possession-notices-${list.status}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Possession Notice"]} />
      {noticeId ? <NoticeRecord id={noticeId} actions={renderActions} onBack={closeNotice} /> : (
      <>
      <MoneyBand eyebrow="CRM · Possession" title="Possession Notice" sub="The formal offer of possession to a buyer. It must be acknowledged before Handover is scheduled."
        actions={<>
          {canCreate && <button type="button" onClick={openNew} className={BAND_KEY_MAIN}><Plus size={13} /> New notice</button>}
          {refreshBtn}
        </>}
        lead={`${ack} of ${all}`} leadNote="notices acknowledged"
        bar={<CollectionBar onDark due={all} collected={ack} finance={sent} recorded={0} />}
        figures={[
          { label: "Acknowledged", dot: BAND_DOT.collected, value: String(ack), note: "Handover can be scheduled" },
          { label: "Sent", dot: BAND_DOT.finance, value: String(sent), note: late ? `${late} past the response date` : "Waiting for the customer", alert: late > 0 },
          { label: "Draft", dot: BAND_DOT.notDue, value: String(draft), note: "Not yet sent" },
          { label: "Disputed", dot: BAND_DOT.overdue, value: String(disputed), note: "Objection to settle", alert: disputed > 0 },
        ]} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<string> label="Possession notices" active={list.status} onChange={list.setStatus} tabs={tabs} />
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Notice, customer, booking or unit" />
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          {list.hasFilters && <button type="button" onClick={list.reset} className={GRID_BTN}>Clear filters</button>}
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey="crm-possession-notice-views"
              current={{ status: list.status, search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize }}
              onApply={(v) => { setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]); list.apply(v); }} />
            <GridColumnChooser cols={noticeCols} prefs={prefs} onChange={setPrefs} />
            <button type="button" onClick={handleExport} disabled={exporting} className={GRID_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
          </div>
        </div>
        <CrmGrid cols={noticeCols} prefs={prefs} onPrefs={setPrefs} rows={rows} rowKey={(n) => n.Id} noRowNumbers
          loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()}
          sort={list.sort} onSort={list.toggleSort} onRowClick={(n) => openNotice(n.Id)}
          empty={list.hasFilters ? "No notice matches these filters." : "No possession notices yet. Issue one once the Pre-Possession check is Ready and the OC / CC is received."}
          page={list.page} pageSize={pageSize} total={total} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
      </div>
      </>
      )}

      {sentTarget && (
      <Dialog open onOpenChange={(o) => { if (!o) { setSentTarget(null); setSentMode(""); } }}>
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
      )}

      {ackTarget && (
      <Dialog open onOpenChange={(o) => { if (!o) setAckTarget(null); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Head icon={<CheckCircle2 size={14} />} title="Acknowledge notice" />
          {ackTarget && <p className="text-sm">The customer has accepted <span className="font-heading font-bold tabular-nums">{ackTarget.NoticeNo}</span> ({ackTarget.ApplicantName}). Handover can then be scheduled.</p>}
          <Foot>
            <button onClick={() => setAckTarget(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleMarkAcknowledged} disabled={ackSaving} className={`${KEY_INK} h-9 px-4`}>{ackSaving ? "Saving…" : "Acknowledge"}</button>
          </Foot>
        </DialogContent>
      </Dialog>
      )}

      {editTarget && (
      <Dialog open onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
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
      )}

      {deleteTarget && (
      <Dialog open onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Head icon={<Trash2 size={14} />} title="Delete notice" destructive />
          <p className="text-sm">Delete <span className="font-heading font-bold tabular-nums">{deleteTarget?.NoticeNo}</span> ({deleteTarget?.ApplicantName}) for good? A new notice can then be issued for the booking. Only drafts can be deleted.</p>
          <Foot>
            <button onClick={() => setDeleteTarget(null)} className={`${KEY_LINE} h-9 px-4`}>Keep</button>
            <button onClick={handleDelete} disabled={deleteSaving} className={`${KEY_RED} h-9 px-4`}>{deleteSaving ? "Deleting…" : "Delete"}</button>
          </Foot>
        </DialogContent>
      </Dialog>
      )}

      {disputeDialog && (
      <Dialog open onOpenChange={(o) => { if (!o) { setDisputeDialog(null); setDisputeReason(""); } }}>
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
      )}

      {retractDialog && (
      <Dialog open onOpenChange={(o) => { if (!o) { setRetractDialog(null); setRetractReason(""); } }}>
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
      )}

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
    </div>
  );
};

export default CrmPossessionNotice;
