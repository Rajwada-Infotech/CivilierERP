import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/utils/formatCurrency";
import {
  Plus, CheckCircle2, AlertTriangle, XCircle, ExternalLink, Lock,
  Pencil, ScrollText, RotateCcw, UserCircle2, Circle, ChevronDown, ChevronUp,
  FileText, Upload, File as FileIcon, Download, Check, History, RefreshCw, Send, FileImage, FileSpreadsheet, X, Search, AlertCircle, Info, ArrowRight, ShieldAlert, Eye, Loader2
} from "lucide-react";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RefreshButton } from "@/components/ui/RefreshButton";


const API = "/api/crm/sales-deed";
const USERS_API = "/api/users"; 

const STATUS_CFG: Record<string, { text: string; bar: string }> = {
  Draft:      { text: "text-muted-foreground", bar: "bg-border" },
  Executed:   { text: "text-blue-700",   bar: "bg-blue-500" },
  Registered: { text: "text-emerald-700", bar: "bg-emerald-500" },
  Overdue:    { text: "text-rose-700",   bar: "bg-rose-500" },
  Cancelled:  { text: "text-rose-700",   bar: "bg-rose-500" },
};
const APPROVAL_CFG: Record<string, { text: string; bar: string }> = {
  Approved:    { text: "text-emerald-700", bar: "bg-emerald-500" },
  Rejected:    { text: "text-rose-700",    bar: "bg-rose-500" },
  Pending:     { text: "text-amber-700",   bar: "bg-amber-500" },
  NotSent:     { text: "text-muted-foreground", bar: "bg-border" },
  NotRequired: { text: "text-muted-foreground", bar: "bg-border" },
};

const DOC_STATUS_COLOR: Record<string, string> = {
  Requested: 'text-amber-600 bg-amber-50 border-amber-200',
  Uploaded:  'text-blue-600 bg-blue-50 border-blue-200',
  Verified:  'text-emerald-600 bg-emerald-50 border-emerald-200',
  Rejected:  'text-red-600 bg-red-50 border-red-200',
};

// Plain-language description of what staff should do next for a given
// document row — the old layout left people guessing what "Requested" vs
// "Uploaded" vs a Mandatory badge actually meant for them right now.
function docNextStep(doc: any): string {
  if (doc.Status === 'Verified') return 'Checked and accepted.';
  if (doc.Status === 'Rejected') return 'Rejected — attach a corrected file.';
  if (doc.Status === 'Uploaded') return 'Uploaded — awaiting staff review.';
  return doc.IsMandatory ? 'Required — attach a file to proceed.' : 'Requested — attach a file.';
}

const LOG_ACTION_CFG: Record<string, { label: string; color: string }> = {
  SeniorApprove:   { label: 'Senior Approved',     color: 'text-emerald-600' },
  SeniorReject:    { label: 'Senior Rejected',      color: 'text-rose-600' },
  Submitted:       { label: 'Resubmitted',          color: 'text-blue-600' },
  SendToCustomer:  { label: 'Sent to Customer',     color: 'text-blue-600' },
  CustomerApprove: { label: 'Customer Approved',    color: 'text-emerald-600' },
  CustomerRecheck: { label: 'Recheck Requested',    color: 'text-amber-600' },
  DirectorApprove: { label: 'Director Approved',    color: 'text-emerald-700' },
  DirectorReject:  { label: 'Director Rejected',    color: 'text-rose-700' },
};

function StatusBadge({ status, cfg = STATUS_CFG }: { status: string; cfg?: typeof STATUS_CFG }) {
  const c = cfg[status] ?? { text: "text-muted-foreground", bar: "bg-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider", c.text)}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", c.bar)} />
      {status}
    </span>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function mimeIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileText size={16} className="text-red-500 shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={16} className="text-emerald-500 shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}

function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
// ── Deed Stepper ────────────────────────────────────────────────────────────
type StepState = "done" | "current" | "upcoming";
type DeedTab = "Overview" | "Documents" | "Legal & Approval" | "Registration" | "History";

function deedDocumentProgress(documents: any[] | undefined): { required: number; uploaded: number; percent: number } {
  const mandatory = (documents || []).filter((d) => d.IsMandatory);
  const required = mandatory.length;
  const uploaded = mandatory.filter((d) => d.HasFile).length;
  const percent = required > 0 ? Math.round((uploaded / required) * 100) : 0;
  return { required, uploaded, percent };
}

function deedStepStates(d: any, documents: any[] | undefined, context: any): { label: string; state: StepState; tab: DeedTab }[] {
  const legalAssigned = !!d?.LegalExecutiveId;
  const docs = deedDocumentProgress(documents);
  const docsDone = docs.required > 0 && docs.percent === 100;
  const senior = d?.SeniorApprovalStatus === "Approved";
  const custApproved = d?.CustomerApprovalStatus === "Approved";
  const dirApproved = d?.DirectorApprovalStatus === "Approved";
  const qpConfirmed = context?.queryPaymentStatus === "Confirmed";
  const executed = !!d?.ExecutedBy;
  const registered = !!d?.RegistrationNo;

  // Each step used to read its own "done" flag straight off the record and
  // its "current" flag off just the PRECEDING step's flag, independently —
  // so if the underlying data was ever out of sequence (e.g. a legacy/bad
  // row where CustomerApprovalStatus and DirectorApprovalStatus were
  // Approved despite SeniorApprovalStatus never being set — a combination
  // the real gates added to this page now make impossible to reach honestly,
  // but which can still exist as leftover data), the stepper showed
  // contradictory checkmarks out of order AND two steps marked "current" at
  // once. A step's true position in this chain is never independent of the
  // ones before it — an approval that could only ever legitimately happen
  // after an earlier gate can't meaningfully be "done" while that gate isn't.
  // Single sequential pass instead: a step is "done" only if its own flag is
  // true AND every step before it is also done; the first not-done step is
  // the one and only "current" step; everything after that is "upcoming".
  const raw: { label: string; done: boolean; tab: DeedTab }[] = [
    { label: "Draft Setup", done: true, tab: "Overview" },
    { label: "Legal Assigned", done: legalAssigned, tab: "Legal & Approval" },
    { label: `Draft Docs${docs.required > 0 ? ` (${docs.percent}%)` : ""}`, done: docsDone, tab: "Documents" },
    { label: "Senior Approve", done: senior, tab: "Legal & Approval" },
    { label: "Customer Review", done: custApproved, tab: "Legal & Approval" },
    { label: "Director Approve", done: dirApproved, tab: "Legal & Approval" },
    { label: "Stamp Duty", done: qpConfirmed, tab: "Registration" },
    { label: "Execution", done: executed, tab: "Registration" },
    { label: "Registered", done: registered, tab: "Registration" },
  ];

  let blocked = false;
  return raw.map((s) => {
    let state: StepState;
    if (!blocked && s.done) {
      state = "done";
    } else if (!blocked) {
      state = "current";
      blocked = true;
    } else {
      state = "upcoming";
    }
    return { label: s.label, state, tab: s.tab };
  });
}

function DeedStepper({ steps, activeTab, onStepClick }: { steps: { label: string; state: StepState; tab: DeedTab }[]; activeTab: DeedTab; onStepClick: (t: DeedTab) => void }) {
  return (
    <div className="flex items-center overflow-x-auto thin-scroll pb-1">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <button onClick={() => onStepClick(s.tab)}
            className={cn("flex items-center gap-1.5 shrink-0 rounded-lg px-2 py-1.5 hover:bg-muted/60 transition-colors group", activeTab === s.tab ? "bg-muted/50" : "")}>
            <span className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ring-2",
              s.state === "done"
                ? "bg-emerald-500 text-white ring-emerald-200 dark:ring-emerald-900"
                : s.state === "current"
                ? "bg-primary text-primary-foreground ring-primary/25"
                : "bg-muted text-muted-foreground ring-transparent")}>
              {s.state === "done" ? <Check size={11} /> : i + 1}
            </span>
            <span className={cn("text-[11px] font-semibold whitespace-nowrap leading-tight",
              s.state === "done" ? "text-emerald-600 dark:text-emerald-400"
              : s.state === "current" ? "text-foreground"
              : "text-muted-foreground/60")}>
              {s.label}
            </span>
          </button>
          {i < steps.length - 1 && (
            <div className={cn("w-4 h-px mx-0.5 shrink-0", steps[i + 1].state !== "upcoming" ? "bg-emerald-400" : "bg-border")} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Step circle indicators ────────────────────────────────────────────────────
function StepCircle({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  if (done) return (
    <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
      <CheckCircle2 size={14} className="text-white" />
    </div>
  );
  if (active) return (
    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 text-[11px] font-bold text-primary-foreground">
      {n}
    </div>
  );
  return (
    <div className="w-7 h-7 rounded-full border-2 border-border flex items-center justify-center shrink-0 text-[11px] font-semibold text-muted-foreground">
      {n}
    </div>
  );
}

// ── Manual step card (DocCollection / DeedDrafting / InternalApproval) ───────
function ManualStep({
  n, label, hint, done, date, notes,
  onSave, saving,
}: {
  n: number; label: string; hint?: string;
  done: boolean; date: string | null; notes: string | null;
  onSave: (done: boolean, date: string, notes: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [formDate, setFormDate] = useState(() => date ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [formNotes, setFormNotes] = useState(notes || "");

  const submit = (markDone: boolean) => {
    onSave(markDone, formDate, formNotes);
    setEditing(false);
  };

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepCircle n={n} done={done} active={!done} />
        <div className="w-px flex-1 bg-border mt-1" />
      </div>
      <div className="flex-1 min-w-0 pb-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={cn("text-sm font-semibold", done ? "text-foreground" : "text-foreground")}>{label}</p>
            {done ? (
              <p className="text-xs text-emerald-600 mt-0.5">Completed {fmtDate(date)}{notes ? ` · ${notes}` : ""}</p>
            ) : hint ? (
              <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
            ) : null}
          </div>
          {done && !editing && (
            <button onClick={() => setEditing(true)} className="text-[11px] text-primary hover:underline shrink-0 flex items-center gap-1">
              <Pencil size={10} /> Edit
            </button>
          )}
        </div>

        {(!done || editing) && (
          <div className="mt-2 space-y-2 bg-muted/30 rounded-lg px-3 py-3 border border-border">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Date</label>
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                  className="w-full mt-0.5 text-sm border border-border rounded px-2 py-1 bg-background" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes (optional)</label>
                <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Any remarks"
                  className="w-full mt-0.5 text-sm border border-border rounded px-2 py-1 bg-background" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              {editing && (
                <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted">Cancel</button>
              )}
              {done && editing && (
                <button onClick={() => submit(false)} disabled={saving}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                  {saving ? "..." : "Mark Undone"}
                </button>
              )}
              <button onClick={() => submit(true)} disabled={saving}
                className="text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 font-medium">
                {saving ? "Saving..." : done ? "Update" : "Mark Done"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Read-only auto step ───────────────────────────────────────────────────────
function AutoStep({
  n, label, done, status, children, isLast = false,
}: {
  n: number; label: string; done: boolean; status?: React.ReactNode;
  children?: React.ReactNode; isLast?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepCircle n={n} done={done} active={!done} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className={cn("flex-1 min-w-0", isLast ? "pb-0" : "pb-5")}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold">{label}</p>
          {status}
        </div>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

// ── Date step (Appointment / Index II) ───────────────────────────────────────
function DateStep({
  n, label, hint, value, onSave, saving, isLast = false,
}: {
  n: number; label: string; hint?: string;
  value: string | null; onSave: (date: string) => void; saving: boolean; isLast?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [formDate, setFormDate] = useState(() => value ? String(value).slice(0, 10) : "");
  const done = !!value;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepCircle n={n} done={done} active={!done} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className={cn("flex-1 min-w-0", isLast ? "pb-0" : "pb-5")}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{label}</p>
            {done && !editing ? (
              <p className="text-xs text-emerald-600 mt-0.5">{fmtDate(value)}</p>
            ) : hint ? (
              <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
            ) : null}
          </div>
          {done && !editing && (
            <button onClick={() => { setFormDate(String(value).slice(0, 10)); setEditing(true); }}
              className="text-[11px] text-primary hover:underline shrink-0 flex items-center gap-1">
              <Pencil size={10} /> Edit
            </button>
          )}
        </div>
        {(!done || editing) && (
          <div className="mt-2 flex items-center gap-2">
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
            <button onClick={() => { onSave(formDate); setEditing(false); }} disabled={saving || !formDate}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 font-medium">
              {saving ? "..." : "Save"}
            </button>
            {editing && (
              <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Deed details collapsible ──────────────────────────────────────────────────
function DeedDetailsSection({ detail, onSave, saving }: {
  detail: any;
  onSave: (fields: Record<string, string>) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const locked = !!detail.SentToCustomerAt;
  const [form, setForm] = useState({
    DeedValue: detail.DeedValue != null ? String(detail.DeedValue) : "",
    StampDuty: detail.StampDuty != null ? String(detail.StampDuty) : "",
    RegistrationFee: detail.RegistrationFee != null ? String(detail.RegistrationFee) : "",
    StampDutyCredit: detail.StampDutyCredit != null ? String(detail.StampDutyCredit) : "",
    SubRegistrarOffice: detail.SubRegistrarOffice || "",
    DeedDate: detail.DeedDate ? String(detail.DeedDate).slice(0, 10) : "",
    RegistrationDeadline: detail.RegistrationDeadline ? String(detail.RegistrationDeadline).slice(0, 10) : "",
    WitnessNames: detail.WitnessNames || "",
    Notes: detail.Notes || "",
  });

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-4">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Deed Details</span>
        {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3">
          {locked && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/30 border border-border rounded px-3 py-1.5">
              <Lock size={11} /> Locked — sent to customer for approval on {fmtDate(detail.SentToCustomerAt)}.
            </div>
          )}
          {editing ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Deed Value", "DeedValue", "number"],
                  ["Stamp Duty", "StampDuty", "number"],
                  ["Registration Fee", "RegistrationFee", "number"],
                  ["AFS Stamp Duty Credit", "StampDutyCredit", "number"],
                  ["Deed Date", "DeedDate", "date"],
                  ["Registration Deadline", "RegistrationDeadline", "date"],
                ].map(([lbl, key, type]) => (
                  <div key={key} className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{lbl}</label>
                    <Input type={type} className="h-9 text-sm font-mono" value={(form as any)[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sub-Registrar Office</label>
                <Input className="h-9 text-sm" value={form.SubRegistrarOffice}
                  onChange={(e) => setForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Witness Names</label>
                <Input className="h-9 text-sm" value={form.WitnessNames}
                  onChange={(e) => setForm((f) => ({ ...f, WitnessNames: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
                <textarea rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" value={form.Notes}
                  onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={() => { onSave(form); setEditing(false); }} disabled={saving}
                  className="text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 font-medium">
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1 text-sm">
                {[
                  ["Deed Value", detail.DeedValue ? formatINR(detail.DeedValue) : "—"],
                  ["Stamp Duty", detail.StampDuty ? formatINR(detail.StampDuty) : "—"],
                  ["Registration Fee", detail.RegistrationFee ? formatINR(detail.RegistrationFee) : "—"],
                  ["AFS Credit", detail.StampDutyCredit != null ? "− " + formatINR(detail.StampDutyCredit) : "—"],
                  ["Deed Date", fmtDate(detail.DeedDate)],
                  ["Reg. Deadline", fmtDate(detail.RegistrationDeadline)],
                  ["Sub-Registrar Office", detail.SubRegistrarOffice || "—"],
                  ["Witness Names", detail.WitnessNames || "—"],
                ].map(([lbl, val]) => (
                  <div key={lbl} className="flex justify-between gap-3 py-1 border-b border-border/50 last:border-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{lbl}</span>
                    <span className="text-right text-xs font-mono">{val}</span>
                  </div>
                ))}
                {detail.Notes && (
                  <p className="text-xs text-muted-foreground pt-1 italic">{detail.Notes}</p>
                )}
              </div>
              {!locked && (
                <div className="flex justify-end pt-1">
                  <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                    <Pencil size={10} /> Edit
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  BookingId: "", DeedValue: "", StampDuty: "", RegistrationFee: "",
  StampDutyCredit: "", SubRegistrarOffice: "", DeedDate: "", RegistrationDeadline: "",
};

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchEligible(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookingContext(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try { const r = await fetchWithAuth(`${API}/booking/${bookingId}/context`); return r.ok ? r.json() : null; } catch { return null; }
}
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${USERS_API}/legal-executives`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.id), label: u.name }));
  } catch { return []; }
}

const CrmSalesDeed: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const deedIdFilter = sp.get("deedId");
  const [deedDeepLinkOpened, setDeedDeepLinkOpened] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [stepSaving, setStepSaving] = useState(false);
  const [deedDetailSaving, setDeedDetailSaving] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [sendingToCustomer, setSendingToCustomer] = useState(false);
  const [proxyApproveDialog, setProxyApproveDialog] = useState(false);
  const [proxyRecheckDialog, setProxyRecheckDialog] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);

  // Execution / Registration fields
  const [execForm, setExecForm] = useState({ ExecutedBy: "", RegistrationNo: "", BookNo: "", PartNo: "", RegistrationDate: "", PossessionDate: "" });
  const [execSaving, setExecSaving] = useState(false);
  const [execEditing, setExecEditing] = useState(false);

  // State management additions
  const [activeTab, setActiveTab] = useState<'Overview'|'Documents'|'Legal & Approval'|'Registration'|'History'>('Overview');
  const [assigningLegal, setAssigningLegal] = useState(false);
  const [selectedLegalExec, setSelectedLegalExec] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [newDocType, setNewDocType] = useState('ExecutedDeed');
  const [newDocLabel, setNewDocLabel] = useState('');
  const [requestingDoc, setRequestingDoc] = useState(false);
  // The old "Download" link was the ONLY way to look at an attached
  // document — it forces a save-to-disk (Content-Disposition: attachment)
  // instead of letting staff actually view the file, so verifying a doc
  // meant downloading it first every single time. This opens an in-page
  // preview (image/PDF) fetched with the same auth as everything else on
  // this page — window.open() with a bare URL can't carry the bearer
  // token, so we fetch a blob and preview that instead.
  const [previewDoc, setPreviewDoc] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);
  const handlePreviewDoc = async (doc: any) => {
    setPreviewLoading(doc.Id);
    try {
      const res = await fetchWithAuth(`${API}/documents/file/${doc.Id}`);
      if (!res.ok) throw new Error("Could not load file");
      const blob = await res.blob();
      setPreviewDoc({ url: URL.createObjectURL(blob), mime: doc.MimeType, name: doc.FileName || doc.DocumentType });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setPreviewLoading(null); }
  };
  const closePreview = () => {
    if (previewDoc) URL.revokeObjectURL(previewDoc.url);
    setPreviewDoc(null);
  };
  // Same root cause as the preview above: this route sits behind
  // authMiddleware with no query-token fallback, so the previous plain
  // `window.open(url, '_blank')` always 401'd — "Download" never actually
  // worked. Fetch with the real auth header this page already uses
  // everywhere else, then trigger the save via a throwaway anchor.
  const handleDownloadDoc = async (doc: any) => {
    try {
      const res = await fetchWithAuth(`${API}/documents/file/${doc.Id}`);
      if (!res.ok) throw new Error("Could not download file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = doc.FileName || doc.DocumentType || 'document';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast.error(translateError(e.message)); }
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: deeds = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-sales-deed"], queryFn: fetchAll, staleTime: 30_000,
  });
  const { data: eligible = [] } = useQuery({
    queryKey: ["crm-sales-deed-eligible"], queryFn: fetchEligible, staleTime: 60_000,
  });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-sales-deed-context", form.BookingId],
    queryFn: () => fetchBookingContext(form.BookingId),
    enabled: !!form.BookingId,
  });
  
  const { data: deedDetail, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-sale-deed-detail", detailId],
    queryFn: async () => {
      if (!detailId) return null;
      const r = await fetchWithAuth(`${API}/${detailId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!detailId,
    staleTime: 15_000,
  });
  
  const { data: users = [] } = useQuery({ queryKey: ['legal-executives'], queryFn: fetchUsers, staleTime: 300_000 });

  const detail = deedDetail?.deed ?? (detailId != null ? (deeds as any[]).find((d: any) => d.Id === detailId) : null);

  const { data: detailContext } = useQuery({
    queryKey: ["crm-sales-deed-context", detail ? String(detail.BookingId) : ""],
    queryFn: () => fetchBookingContext(String(detail?.BookingId ?? "")),
    enabled: !!detail?.BookingId,
  });

  const agreementRegistered = context?.agreement?.Status === "Registered";
  const isLoanFinanced = context?.booking?.FinancingType === "LoanFinanced";
  const loanCleared = !context?.loanBlockReason;
  const handoverCleared = !context?.requiresHandoverBeforeDeed || context?.handoverStatus === "Completed";
  const canCreate = !!form.BookingId && agreementRegistered && loanCleared && handoverCleared && !contextLoading;

  const registered = detail?.Status === CrmStatus.REGISTERED;
  const cancelled = detail?.Status === CrmStatus.CANCELLED;
  const progressLocked = registered || cancelled;

  useEffect(() => {
    if (!deepLinkBookingId || dialogOpen) return;
    if ((deeds as any[]).some((d: any) => String(d.BookingId) === deepLinkBookingId)) return;
    if ((eligible as any[]).some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
      setDialogOpen(true);
    }
  }, [deepLinkBookingId, deeds.length, eligible.length]);

  useEffect(() => {
    if (!deedIdFilter || deedDeepLinkOpened || !(deeds as any[]).length) return;
    const match = (deeds as any[]).find((d: any) => String(d.Id) === deedIdFilter);
    if (match) { setDeedDeepLinkOpened(true); selectDetail(match.Id); }
  }, [deedIdFilter, deedDeepLinkOpened, deeds]);

  useEffect(() => {
    if (!context?.agreement) return;
    const credit = Number(context.agreement.AfsStampDuty ?? 0) || 0;
    if (credit > 0) setForm((f) => ({ ...f, StampDutyCredit: f.StampDutyCredit === "" ? String(credit) : f.StampDutyCredit }));
  }, [context?.agreement?.AfsStampDuty]);

  const invalidateDetail = () => {
    qc.invalidateQueries({ queryKey: ['crm-sale-deed-detail', detailId] });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    if (detailId) invalidateDetail();
  };

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!canCreate) { toast.error("This booking isn't eligible yet"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Sale deed ${data.DeedNo} created`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const selectDetail = (id: number) => {
    const d = (deeds as any[]).find((x: any) => x.Id === id);
    if (d) {
      setExecForm({
        ExecutedBy: d.ExecutedBy || "", RegistrationNo: d.RegistrationNo || "",
        BookNo: d.BookNo || "", PartNo: d.PartNo || "",
        RegistrationDate: d.RegistrationDate ? String(d.RegistrationDate).slice(0, 10) : "",
        PossessionDate: d.PossessionDate ? String(d.PossessionDate).slice(0, 10) : "",
      });
    }
    setExecEditing(false);
    setDetailId(id);
    setSp((p) => { p.set("deedId", String(id)); return p; }, { replace: true });
    setActiveTab('Overview');
  };

  const saveFields = async (fields: Record<string, any>) => {
    if (!detailId) return;
    const res = await fetchWithAuth(`${API}/${detailId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  };

  const handleManualStep = async (
    prefix: "DocCollection" | "DeedDrafting" | "InternalApproval",
    done: boolean, date: string, notes: string,
  ) => {
    setStepSaving(true);
    try {
      await saveFields({
        [`${prefix}Done`]: done,
        [`${prefix}Date`]: done ? (date || null) : null,
        [`${prefix}Notes`]: done ? (notes || null) : null,
      });
      toast.success(done ? `${prefix.replace(/([A-Z])/g, " $1").trim()} marked done` : "Step marked undone");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setStepSaving(false); }
  };

  const handleSaveDeedDetails = async (fields: Record<string, string>) => {
    setDeedDetailSaving(true);
    try {
      await saveFields(fields);
      toast.success("Deed details updated");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setDeedDetailSaving(false); }
  };

  const handleSaveIndex2 = async (date: string) => {
    setStepSaving(true);
    try {
      await saveFields({ Index2ReceivedDate: date || null });
      toast.success("Index II received date saved");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setStepSaving(false); }
  };

  const handleSaveExecution = async () => {
    setExecSaving(true);
    try {
      const data = await saveFields(execForm);
      toast.success(`Deed status: ${data?.status || "updated"}`);
      setExecEditing(false);
      invalidate();
      qc.invalidateQueries({ queryKey: ["crm-handover-eligible"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExecSaving(false); }
  };

  const handleSendToCustomer = async () => {
    if (!detailId) return;
    setSendingToCustomer(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/send-to-customer`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Sent to customer for approval");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSendingToCustomer(false); }
  };

  const handleProxyApprove = async (method: ProxyMethod, remarks: string) => {
    if (!detailId) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/proxy-customer-approve`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer approval recorded");
      setProxyApproveDialog(false);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const handleProxyRecheck = async (method: ProxyMethod, remarks: string) => {
    if (!detailId) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/proxy-customer-recheck`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer recheck request recorded");
      setProxyRecheckDialog(false);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const handleAssignLegal = async (legalExecutiveId: string) => {
    if (!detailId) return;
    setAssigningLegal(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/assign-legal`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ LegalExecutiveId: legalExecutiveId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Legal executive assigned");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setAssigningLegal(false); }
  };

  const handleAttachDoc = async (docId: number, file: File) => {
    if (!detailId) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetchWithAuth(`${API}/${detailId}/documents/${docId}/attach`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("File attached");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleUploadDoc = async (file: File, documentType: string, label?: string) => {
    if (!detailId) return;
    setUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append('files', file);
      formData.append('DocumentType', documentType);
      if (label) formData.append('Label', label);
      const res = await fetchWithAuth(`${API}/${detailId}/documents/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document uploaded");
      invalidateDetail();
      setNewDocLabel('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setUploadingDoc(false); }
  };

  // Requests a mandatory document requirement dynamically — the recovery
  // path for the "no mandatory documents requested yet" dead end: previously
  // the ONLY mandatory doc a deed could ever have was the single 'DeedDraft'
  // row auto-seeded at creation, with no way to ask for another if that one
  // was ever consumed by something else, or a rejection needed a genuinely
  // fresh copy.
  const handleRequestDoc = async (documentType: string, label?: string) => {
    if (!detailId) return;
    setRequestingDoc(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/documents/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ DocumentType: documentType, Label: label, IsMandatory: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Mandatory document requested");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRequestingDoc(false); }
  };

  const handleResubmit = async () => {
    if (!detailId) return;
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/submit`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Resubmitted for senior approval");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleVerifyDoc = async (docId: number) => {
    if (!detailId) return;
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/documents/${docId}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ Status: 'Verified' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document verified");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  // Rejecting used to have no UI path at all on this page — the backend
  // route accepted a Reject status but nothing here ever sent one. Mirrors
  // Agreement's own document rejection: remarks describing the mismatch are
  // mandatory, not optional.
  const handleRejectDoc = async (docId: number) => {
    if (!detailId) return;
    const remarks = window.prompt("Describe what's wrong with this document (required):");
    if (!remarks?.trim()) return;
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/documents/${docId}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ Status: 'Rejected', Remarks: remarks.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document rejected");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const [search, setSearch] = useState("");
  const handleCancelDeed = async () => {
    if (!detailId) return;
    try {
      const r = await fetchWithAuth(`${API}/${detailId}/cancel`, { method: "PUT" });
      if (!r.ok) {
        const err = await r.json();
        alert(err.error || "Failed to cancel sale deed");
        return;
      }
      qc.invalidateQueries({ queryKey: ["crm-sale-deed-detail", detailId] });
      qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const filtered = (deeds as any[]).filter(d => 
    !search || 
    d.ApplicantName?.toLowerCase().includes(search.toLowerCase()) || 
    d.DeedNo?.toLowerCase().includes(search.toLowerCase()) ||
    d.BookingNo?.toLowerCase().includes(search.toLowerCase()) ||
    d.UnitNo?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Sale Deeds"]} />
      <CrmShell
        title="CRM — Sale Deeds"
        subtitle="Conveyance deeds transferring legal ownership (s.54 TPA 1882)"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            <button onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> New Deed
            </button>
          </div>
        }
      >
        <div className="flex gap-4 h-[calc(100vh-220px)]">
          {/* List (Left Pane) */}
          <div className="w-80 shrink-0 flex flex-col gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search deeds..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll space-y-1.5">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">No deeds found</div>
              ) : (filtered as any[]).map((d: any) => {
                const railColor = d.Status === "Registered" ? "#10b981" : d.Status === "Executed" ? "#3b82f6" : d.Status === "Cancelled" ? "#f43f5e" : "var(--border)";
                return (
                  <button key={d.Id} onClick={() => selectDetail(d.Id)}
                    className={`w-full text-left rounded-lg border overflow-hidden transition-colors ${detailId === d.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"}`}>
                    <div className="flex">
                      <div className="w-[3px] shrink-0 self-stretch" style={{ background: railColor }} />
                      <div className="flex-1 min-w-0 p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold leading-tight truncate">{d.ApplicantName}</span>
                          <StatusBadge status={d.Status} />
                        </div>
                        {d.BookingStatus === 'Cancelled' && (
                          <div className="text-[10px] font-semibold text-red-600">⚠ Booking cancelled — locked</div>
                        )}
                        <div className="text-[11px] font-mono text-muted-foreground">{d.DeedNo}</div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-muted-foreground truncate">{d.BookingNo} · {d.UnitNo}</div>
                          {d.RegistrationNo && <div className="shrink-0 text-[10px] text-emerald-600 font-mono">{d.RegistrationNo}</div>}
                        </div>
                        <div className="text-[11px] flex items-center gap-1">
                          <UserCircle2 size={10} className="text-muted-foreground shrink-0" />
                          {d.LegalExecutiveName ? <span className="text-foreground font-medium truncate">{d.LegalExecutiveName}</span> : <span className="text-amber-600 font-medium">Unassigned</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail (Right Pane) */}
          <div className="flex-1 overflow-y-auto thin-scroll space-y-4">
            {!detailId ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Select a deed to view details
              </div>
            ) : !detail ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
            ) : (
              <>
                {detail.Status !== 'Cancelled' && (
                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <DeedStepper steps={deedStepStates(detail, deedDetail?.documents, detailContext)} activeTab={activeTab as any} onStepClick={setActiveTab as any} />
                  
                  {(() => {
                    const d = detail;
                    const pendingDocs = deedDetail?.documents?.filter((doc: any) => doc.IsMandatory && doc.Status !== 'Verified') || [];
                    const cancelled = d.BookingStatus === 'Cancelled';
                    type BannerVariant = "error" | "warning" | "info" | "success" | "action";
                    let variant: BannerVariant = "info";
                    let text = "";
                    let subtext = "";
                    let cta: { label: string; onClick: () => void } | null = null;
                    if (cancelled) {
                      variant = "error";
                      text = `Booking is ${d?.BookingStatus || "inactive"} — this deed is locked.`;
                      subtext = "Cancel the deed to formally close it out.";
                    } else if (d?.Status === "Registered") {
                      variant = "success";
                      text = "Deed fully complete — Registered at Sub-Registrar.";
                    } else if (d?.Status === "Executed") {
                      variant = "info";
                      text = "Deed executed.";
                      subtext = "Record the Sub-Registrar Registration No. to mark it Registered.";
                    } else if (!d?.LegalExecutiveId) {
                      variant = "warning";
                      text = "No Legal Executive assigned.";
                      subtext = "Assign someone responsible for preparing the paperwork — required before execution.";
                    } else if (d?.SeniorApprovalStatus !== "Approved") {
                      variant = "warning";
                      text = "Awaiting senior approval.";
                      subtext = "Upload all mandatory docs via Documents tab, then submit for Senior Approval.";
                    } else if (!d?.SentToCustomerAt) {
                      variant = "action";
                      text = "Senior-approved — ready to share with the customer.";
                      cta = { label: "Send to Customer Portal", onClick: handleSendToCustomer };
                    } else if (d?.CustomerApprovalStatus === "RecheckRequested") {
                      variant = "error";
                      text = "Customer requested a recheck.";
                      subtext = d?.CustomerRecheckRemarks ? `"${d.CustomerRecheckRemarks}"` : "Address the issue and resend.";
                      cta = { label: "Resend After Recheck", onClick: handleSendToCustomer };
                    } else if (d?.CustomerApprovalStatus !== "Approved") {
                      variant = "info";
                      text = "Sent to customer — awaiting their review and approval.";
                      subtext = d?.SentToCustomerAt ? `Sent ${String(d.SentToCustomerAt).slice(0, 10)}` : "";
                    } else if (d?.DirectorApprovalStatus && d.DirectorApprovalStatus !== "NotRequired" && d.DirectorApprovalStatus !== "Approved") {
                      variant = "warning";
                      text = "Customer approved — awaiting Director's internal sign-off.";
                    } else if (detailContext?.queryPaymentStatus !== "Confirmed") {
                      variant = "warning";
                      text = "Awaiting Stamp Duty Payment confirmation.";
                      subtext = "The finance team must confirm the receipt of the Stamp Duty payment.";
                    } else if (pendingDocs.length) {
                      variant = "warning";
                      text = `${pendingDocs.length} mandatory document${pendingDocs.length > 1 ? "s" : ""} still need verification.`;
                      subtext = pendingDocs.map((doc: any) => doc.Label || doc.DocumentType).join(", ");
                    } else {
                      variant = "action";
                      text = "All checks passed — ready to mark this deed executed.";
                      cta = { label: "Mark Executed", onClick: () => { setActiveTab('Registration'); setExecEditing(true); } };
                    }
                    type VariantDef = { card: string; text: string; sub: string; icon: React.ReactNode };
                    const variantDef: Record<BannerVariant, VariantDef> = {
                      error:   { card: "border-red-300 bg-red-500/10 dark:border-red-800 dark:bg-red-950/50",     text: "text-red-700 dark:text-red-300",   sub: "text-red-600/80 dark:text-red-400/80",   icon: <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" /> },
                      warning: { card: "border-amber-300 bg-amber-500/10 dark:border-amber-800 dark:bg-amber-950/50", text: "text-amber-800 dark:text-amber-200", sub: "text-amber-700/80 dark:text-amber-400/80", icon: <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" /> },
                      info:    { card: "border-blue-300 bg-blue-500/10 dark:border-blue-800 dark:bg-blue-950/50",   text: "text-blue-800 dark:text-blue-200",   sub: "text-blue-700/80 dark:text-blue-400/80",   icon: <Info size={16} className="text-blue-500 shrink-0 mt-0.5" /> },
                      success: { card: "border-green-300 bg-green-500/10 dark:border-green-800 dark:bg-green-950/50", text: "text-green-800 dark:text-green-200", sub: "text-green-700/80 dark:text-green-400/80", icon: <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" /> },
                      action:  { card: "border-primary/40 bg-primary/10",                                            text: "text-foreground",                   sub: "text-muted-foreground",                   icon: <ArrowRight size={16} className="text-primary shrink-0 mt-0.5" /> },
                    };
                    const vd = variantDef[variant];
                    return (
                      <div className={`flex items-start justify-between gap-3 flex-wrap rounded-xl border px-4 py-3 ${vd.card}`}>
                        <div className="flex items-start gap-2.5">
                          {vd.icon}
                          <div>
                            <p className={`text-sm font-semibold leading-snug ${vd.text}`}>{text}</p>
                            {subtext && <p className={`text-xs mt-0.5 ${vd.sub}`}>{subtext}</p>}
                          </div>
                        </div>
                        {cta && (
                          <button onClick={cta.onClick}
                            className="shrink-0 px-3.5 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 whitespace-nowrap">
                            {cta.label}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  </div>
                )}

                {/* Header — name, status, and every global action */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className={`px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${
                    detail.Status === "Registered" ? "bg-gradient-to-r from-green-500/10 to-green-500/5 border-b border-green-200/60 dark:border-green-900/40"
                    : detail.Status === "Executed" ? "bg-gradient-to-r from-blue-500/10 to-blue-500/5 border-b border-blue-200/60 dark:border-blue-900/40"
                    : detail.Status === "Cancelled" ? "bg-gradient-to-r from-red-500/10 to-red-500/5 border-b border-red-200/60 dark:border-red-900/40"
                    : "bg-muted/20 border-b border-border"
                  }`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-xl shrink-0 ${
                        detail.Status === "Registered" ? "bg-green-100 dark:bg-green-900/40"
                        : detail.Status === "Executed" ? "bg-blue-100 dark:bg-blue-900/40"
                        : detail.Status === "Cancelled" ? "bg-red-100 dark:bg-red-900/40"
                        : "bg-primary/10"}`}>
                        <ScrollText size={16} className={
                          detail.Status === "Registered" ? "text-green-600"
                          : detail.Status === "Executed" ? "text-blue-600"
                          : detail.Status === "Cancelled" ? "text-red-600"
                          : "text-primary"} />
                      </div>
                      <div className="min-w-0">
                        <h2 className="font-bold text-[15px] text-foreground leading-tight truncate">{detail.ApplicantName}</h2>
                        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                          {detail.DeedNo}
                          {detail.VersionNo > 1 && <span className="ml-1.5 text-violet-600">· v{detail.VersionNo}</span>}
                          <span className="ml-1.5 text-muted-foreground">· {detail.BookingNo} · {detail.UnitNo}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2.5 py-1 rounded-lg border font-semibold ${
                        detail.Status === 'Registered' ? "bg-green-50 text-green-700 border-green-200"
                        : detail.Status === 'Executed' ? "bg-blue-50 text-blue-700 border-blue-200"
                        : detail.Status === 'Cancelled' ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}>
                        {detail.Status}
                      </span>
                      {detail.BookingStatus === 'Cancelled' && (
                        <span title={`Booking Cancelled — Edit/Send/Mark actions are locked.`}
                          className="text-xs px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600 font-medium cursor-help">
                          ⚠ Booking Cancelled
                        </span>
                      )}
                      
                      {/* Global Header Actions */}
                      {detail.Status !== 'Cancelled' && (
                        detail.BookingStatus === 'Cancelled' ? (
                          <span title="Booking is cancelled — cannot edit" className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/40 cursor-not-allowed">
                            Edit Details
                          </span>
                        ) : (
                          <button onClick={() => setActiveTab('Overview')}
                            className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted">
                            Edit Details
                          </button>
                        )
                      )}
                      {detail.Status !== 'Registered' && detail.Status !== 'Cancelled' && (
                        <button onClick={() => { if (window.confirm("Cancel this sale deed?")) handleCancelDeed(); }}
                          className="text-xs px-2.5 py-1 border border-red-200 rounded-lg text-red-600 bg-red-50/50 hover:bg-red-100 font-medium">
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Tab bar — same visual pattern as CrmAgreement.tsx */}
                <div className="flex items-center gap-x-1 border-b border-border px-1 -mt-1">
                  {(['Overview', 'Documents', 'Legal & Approval', 'Registration', 'History'] as const).map((t, i) => (
                    <button key={t} onClick={() => setActiveTab(t)}
                      className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                        activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        activeTab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
                      {t}
                    </button>
                  ))}
                </div>

                {/* Tab content renders below */}
                  
                  {activeTab === 'Overview' && (
                    <div className="space-y-4">
                      {/* Read-only overview stats mirroring CrmAgreement */}
                      <div className="rounded-xl border border-border overflow-hidden space-y-0">
                        {/* Key summary row */}
                        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                          <div className="px-4 py-3 bg-muted/10">
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Booking</p>
                            <p className="text-sm font-semibold">{detail.BookingNo}</p>
                            <p className="text-[11px] text-muted-foreground">{detail.UnitNo}</p>
                          </div>
                          <div className="px-4 py-3 bg-muted/10">
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Applicant</p>
                            <p className="text-sm font-semibold truncate">{detail.ApplicantName || "—"}</p>
                          </div>
                          <div className={`px-4 py-3 ${detail.DeedDate ? "bg-green-500/[0.04]" : "bg-muted/10"}`}>
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Deed Date</p>
                            {detail.DeedDate ? (
                              <p className="text-sm font-bold text-green-700 dark:text-green-400">{String(detail.DeedDate).slice(0, 10)}</p>
                            ) : (
                              <p className="text-sm text-muted-foreground/60 italic">Not set</p>
                            )}
                          </div>
                        </div>

                        {/* Financial summary row */}
                        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                          <div className="px-4 py-3">
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Deed Value</p>
                            <p className="text-sm font-bold font-mono">
                              {detail.DeedValue ? `₹${Number(detail.DeedValue).toLocaleString("en-IN")}` : "—"}
                            </p>
                          </div>
                          <div className="px-4 py-3">
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Stamp Duty</p>
                            <p className="text-sm font-semibold font-mono">
                              {detail.StampDuty ? `₹${Number(detail.StampDuty).toLocaleString("en-IN")}` : "—"}
                            </p>
                          </div>
                          <div className="px-4 py-3">
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Registration Fee</p>
                            <p className="text-sm font-semibold font-mono">
                              {detail.RegistrationFee ? `₹${Number(detail.RegistrationFee).toLocaleString("en-IN")}` : "—"}
                            </p>
                          </div>
                        </div>
                        
                        <div className="px-4 py-3">
                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Sub-Registrar Office</p>
                          <p className="text-sm font-medium">{detail.SubRegistrarOffice || "—"}</p>
                        </div>
                      </div>

                      <DeedDetailsSection detail={detail} onSave={handleSaveDeedDetails} saving={deedDetailSaving} />
                    </div>
                  )}

                  {activeTab === 'Legal & Approval' && (
                    <div className="space-y-4">
                      {/* Legal Executive Assignment (identical to Agreement) */}
                      <div className="rounded-xl border border-border overflow-hidden">
                        <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                          <h3 className="text-sm font-semibold flex items-center gap-1.5">
                            <UserCircle2 size={15} className="text-primary" /> Legal Executive
                          </h3>
                          {detail.LegalExecutiveId
                            ? <span className="text-[11px] text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full font-semibold">Assigned</span>
                            : <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">Unassigned</span>
                          }
                        </div>
                        <div className="px-4 py-3 space-y-2">
                          <p className="text-xs text-muted-foreground">The person responsible for preparing this deed's paperwork. Required before execution.</p>
                          {detail.LegalExecutiveId && !progressLocked ? (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-2 flex-1 bg-muted/40 border border-border rounded-lg px-3 py-1.5">
                                <UserCircle2 size={14} className="text-primary shrink-0" />
                                <span className="text-sm font-medium">{detail.LegalExecutiveName}</span>
                                <Lock size={11} className="text-muted-foreground ml-auto shrink-0" />
                              </div>
                              <button
                                onClick={() => setSelectedLegalExec(String(detail.LegalExecutiveId))}
                                className="text-xs px-2.5 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted shrink-0">
                                Change
                              </button>
                            </div>
                          ) : progressLocked ? (
                            <div className="font-medium text-sm">{detail.LegalExecutiveName || <span className="text-amber-600">Unassigned</span>}</div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedLegalExec}
                                disabled={assigningLegal}
                                onChange={(e) => setSelectedLegalExec(e.target.value)}
                                className={`flex-1 text-sm border rounded-lg px-2 py-1.5 bg-background disabled:opacity-40 ${
                                  selectedLegalExec ? "border-border" : "border-amber-300 text-amber-600"}`}>
                                <option value="">— Unassigned —</option>
                                {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                              </select>
                              <button onClick={() => handleAssignLegal(selectedLegalExec)} disabled={!selectedLegalExec || assigningLegal}
                                className="h-[34px] px-3 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
                                {assigningLegal ? "Assigning..." : "Assign"}
                              </button>
                              {selectedLegalExec && detail.LegalExecutiveId && (
                                <button
                                  onClick={() => setSelectedLegalExec("")}
                                  className="text-xs px-2.5 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted shrink-0">
                                  Cancel
                                </button>
                              )}
                            </div>
                          )}
                          {!detail.LegalExecutiveId && !progressLocked && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                              Assign someone now so they receive an immediate notification and can start preparing the paperwork.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Approval Timeline (identical to Agreement) */}
                      <div className="rounded-xl border border-border overflow-hidden">
                        <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                          <h3 className="text-sm font-semibold flex items-center gap-1.5">
                            <ShieldAlert size={15} className="text-primary" /> Approval Timeline
                          </h3>
                        </div>

                        {/* Step 1 — Senior Review */}
                        {(() => {
                          const status = detail.SeniorApprovalStatus;
                          const done = status === 'Approved';
                          const rejected = status === 'Rejected';
                          // A deed that has never been submitted (status is
                          // still NULL) is NOT the same state as one that's
                          // actually awaiting a senior's decision — the two
                          // used to be conflated (both displayed as
                          // "Pending" with live Approve/Reject buttons),
                          // which let an approver click Approve/Reject on a
                          // deed that was never submitted and get a bare
                          // 400 ("Cannot reject from status \"null\"") with
                          // no explanation, because the backend's real state
                          // machine — correctly — requires the explicit
                          // /submit transition first. Only a genuine Pending
                          // counts as submitted; NULL gets its own Submit
                          // control below instead of borrowing Pending's UI.
                          const notSubmitted = status === null || status === undefined;
                          const submitted = status === 'Pending';
                          const pending = submitted;
                          const docs = deedDocumentProgress(deedDetail?.documents);
                          const docsReady = docs.required > 0 && docs.percent === 100;
                          return (
                            <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${done ? "bg-green-500/[0.04]" : rejected ? "bg-red-500/[0.04]" : ""}`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${done ? "bg-green-500 text-white" : rejected ? "bg-red-500 text-white" : pending ? "bg-primary text-primary-foreground" : "border-2 border-border text-muted-foreground"}`}>
                                {done ? <Check size={14} /> : rejected ? <AlertCircle size={13} /> : 1}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-sm font-semibold">Senior Review</span>
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                                    done ? "text-green-600 bg-green-50 border-green-200"
                                    : rejected ? "text-red-600 bg-red-50 border-red-200"
                                    : notSubmitted ? "text-muted-foreground bg-muted border-border"
                                    : "text-amber-600 bg-amber-50 border-amber-200"
                                  }`}>{notSubmitted ? "Not Submitted" : status}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  An admin or super-admin approves this deed before it's shared with the customer.
                                </p>
                                {done && detail.SeniorApprovedAt && (
                                  <p className="text-xs text-green-700 flex items-center gap-1">
                                    <CheckCircle2 size={11} /> Approved {String(detail.SeniorApprovedAt).slice(0,10)}
                                    {detail.SeniorApprovalRemarks && <span className="text-muted-foreground ml-1">· {detail.SeniorApprovalRemarks}</span>}
                                  </p>
                                )}
                                {rejected && detail.SeniorApprovalRemarks && (
                                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                                    <strong>Rejection reason:</strong> {detail.SeniorApprovalRemarks}
                                  </div>
                                )}
                                {notSubmitted && detail.BookingStatus !== 'Cancelled' && (
                                  <div className="pt-0.5">
                                    <button
                                      onClick={handleResubmit}
                                      disabled={!docsReady}
                                      title={!docsReady ? `${docs.uploaded}/${docs.required} mandatory documents verified — all must be Verified first` : undefined}
                                      className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Submit for Senior Approval
                                    </button>
                                    {!docsReady && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        {docs.required === 0 ? "Request a mandatory document from the Documents tab first." : `${docs.uploaded}/${docs.required} mandatory documents verified.`}
                                      </p>
                                    )}
                                  </div>
                                )}
                                {submitted && detail.BookingStatus !== 'Cancelled' && !done && (
                                  <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                    <ApprovalActions
                                      status={status}
                                      recordId={detail.Id}
                                      endpoint={API}
                                      actionPathSuffix=""
                                      approverRoles={["admin", "dba", "super_admin"]}
                                      submitOnly={false}
                                      onSuccess={invalidate}
                                    />
                                  </div>
                                )}
                                {rejected && detail.BookingStatus !== 'Cancelled' && (
                                  <button onClick={handleResubmit} className="mt-2 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90">Resubmit for Approval</button>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Step 2 — Shared with Customer */}
                        {(() => {
                          const sent = !!detail.SentToCustomerAt;
                          const seniorApproved = detail.SeniorApprovalStatus === 'Approved';
                          return (
                            <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${sent ? "bg-blue-500/[0.04]" : ""}`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${sent ? "bg-emerald-500 text-white" : seniorApproved ? "bg-primary text-primary-foreground" : "border-2 border-border text-muted-foreground"}`}>
                                {sent ? <Check size={14} /> : 2}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-sm font-semibold">Shared with Customer</span>
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                                    sent ? "text-blue-600 bg-blue-50 border-blue-200" : "text-muted-foreground bg-muted/30 border-border"
                                  }`}>{sent ? "Sent" : "Not sent"}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  The customer can view this deed in their portal and approve it or request a recheck.
                                </p>
                                {sent && (
                                  <p className="text-xs text-blue-600 flex items-center gap-1">
                                    <Send size={11} /> Sent {String(detail.SentToCustomerAt).slice(0,16).replace("T"," ")}
                                  </p>
                                )}
                                {seniorApproved && detail.BookingStatus !== 'Cancelled' && (
                                  <button onClick={handleSendToCustomer} disabled={sendingToCustomer}
                                    className="mt-0.5 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-50">
                                    {sendingToCustomer ? "Sending..." : (sent ? "Resend to Customer" : "Send to Customer Portal")}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Step 3 — Customer Review */}
                        {(() => {
                          const status = detail.CustomerApprovalStatus;
                          const done = status === 'Approved';
                          const recheck = status === 'RecheckRequested';
                          const sent = !!detail.SentToCustomerAt;
                          return (
                            <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${done ? "bg-green-500/[0.04]" : recheck ? "bg-red-500/[0.04]" : ""}`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${done ? "bg-green-500 text-white" : recheck ? "bg-red-500 text-white" : sent ? "bg-primary text-primary-foreground" : "border-2 border-border text-muted-foreground"}`}>
                                {done ? <Check size={14} /> : recheck ? <AlertCircle size={13} /> : 3}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-sm font-semibold">Customer Review</span>
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                                    done ? "text-green-600 bg-green-50 border-green-200"
                                    : recheck ? "text-red-600 bg-red-50 border-red-200"
                                    : "text-muted-foreground bg-muted/30 border-border"
                                  }`}>{status || "Pending"}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Customer's response from the portal. They can approve or request changes.
                                </p>
                                {done && detail.CustomerApprovedAt && (
                                  <p className="text-xs text-green-700 flex items-center gap-1">
                                    <CheckCircle2 size={11} /> Approved {String(detail.CustomerApprovedAt).slice(0,10)}
                                  </p>
                                )}
                                {recheck && detail.CustomerRecheckRemarks && (
                                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                                    <strong>Recheck reason:</strong> {detail.CustomerRecheckRemarks}
                                  </div>
                                )}
                                {sent && !done && detail.BookingStatus !== 'Cancelled' && (
                                  <div className="flex gap-2 flex-wrap mt-2">
                                    <button onClick={() => setProxyApproveDialog(true)}
                                      className="text-xs px-3 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg font-semibold hover:bg-amber-100 flex items-center gap-1.5">
                                      <UserCircle2 size={11} /> Record Approval (Offline)
                                    </button>
                                    <button onClick={() => setProxyRecheckDialog(true)}
                                      className="text-xs px-3 py-1.5 bg-red-50 border border-red-200 text-red-800 rounded-lg font-semibold hover:bg-red-100 flex items-center gap-1.5">
                                      <UserCircle2 size={11} /> Record Recheck (Offline)
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Step 4 — Director Review */}
                        {(() => {
                          const status = detail.DirectorApprovalStatus;
                          const done = status === 'Approved';
                          const rejected = status === 'Rejected';
                          const custApproved = detail.CustomerApprovalStatus === 'Approved';
                          return (
                            <div className={`px-4 py-4 flex items-start gap-3 ${done ? "bg-green-500/[0.04]" : rejected ? "bg-red-500/[0.04]" : ""}`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${done ? "bg-green-500 text-white" : rejected ? "bg-red-500 text-white" : custApproved ? "bg-primary text-primary-foreground" : "border-2 border-border text-muted-foreground"}`}>
                                {done ? <Check size={14} /> : rejected ? <AlertCircle size={13} /> : 4}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-sm font-semibold">Director Review</span>
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                                    done ? "text-green-600 bg-green-50 border-green-200"
                                    : rejected ? "text-red-600 bg-red-50 border-red-200"
                                    : "text-amber-600 bg-amber-50 border-amber-200"
                                  }`}>{status || "Pending"}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Final internal sign-off by the director before proceeding to execution.
                                </p>
                                {done && detail.DirectorApprovedAt && (
                                  <p className="text-xs text-green-700 flex items-center gap-1">
                                    <CheckCircle2 size={11} /> Approved {String(detail.DirectorApprovedAt).slice(0,10)}
                                  </p>
                                )}
                                {rejected && detail.DirectorApprovalRemarks && (
                                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                                    <strong>Rejection reason:</strong> {detail.DirectorApprovalRemarks}
                                  </div>
                                )}
                                {detail.BookingStatus !== 'Cancelled' && status === 'Pending' && (
                                  <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                    <ApprovalActions
                                      status={status}
                                      recordId={detail.Id}
                                      endpoint={API}
                                      actionPathSuffix="director"
                                      approverRoles={["super_admin"]}
                                      onSuccess={invalidate}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {activeTab === 'Registration' && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-3">Registration & Execution</p>

                      {/* Step 9: Stamp Duty Payment */}
                      {(() => {
                        const qpStatus = detailContext?.queryPaymentStatus;
                        const qpConfirmed = qpStatus === "Confirmed";
                        return (
                          <AutoStep n={9} label="Stamp Duty Payment"
                            done={qpConfirmed}
                            status={qpStatus ? <StatusBadge status={qpStatus} /> : undefined}
                          >
                            {!qpStatus && (
                              <p className="text-xs text-muted-foreground">
                                {detail.DirectorApprovalStatus === CrmStatus.APPROVED
                                  ? "Not started yet."
                                  : "Unlocks once Director Approval (Step 8) is complete."}
                              </p>
                            )}
                            {qpStatus && !qpConfirmed && (
                              <p className="text-xs text-amber-600">Paperwork sent, awaiting confirmation that the customer paid the government.</p>
                            )}
                            {qpConfirmed && detailContext?.queryPaymentConfirmedAmount != null && (
                              <p className="text-xs text-emerald-600">Confirmed — {formatINR(detailContext.queryPaymentConfirmedAmount)}</p>
                            )}
                            <button onClick={() => navigate(`/crm/query-payment?bookingId=${detail.BookingId}`)}
                              className="flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                              Go to Query Payment <ExternalLink size={10} />
                            </button>
                          </AutoStep>
                        );
                      })()}

                      {/* Step 10: SRO Appointment */}
                      {(() => {
                        const regStatus = detailContext?.registryStatus;
                        const regDone = regStatus === "Completed";
                        return (
                          <AutoStep n={10} label="Sub-Registrar Appointment"
                            done={regDone}
                            status={regStatus ? <StatusBadge status={regStatus} cfg={{ Pending: STATUS_CFG.Draft, Scheduled: { text: "text-blue-700", bar: "bg-blue-500" }, Completed: { text: "text-emerald-700", bar: "bg-emerald-500" } }} /> : undefined}
                          >
                            {!regStatus && (
                              <p className="text-xs text-muted-foreground">
                                {detailContext?.queryPaymentStatus === "Confirmed"
                                  ? "Not started yet."
                                  : "Unlocks once Stamp Duty Payment (Step 9) is Confirmed."}
                              </p>
                            )}
                            {regStatus && regStatus !== "Completed" && detailContext?.registryScheduledDate && (
                              <p className="text-xs text-blue-600">Scheduled for {fmtDate(detailContext.registryScheduledDate)}</p>
                            )}
                            <button onClick={() => navigate(`/crm/registry?bookingId=${detail.BookingId}`)}
                              className="flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                              Go to Registry <ExternalLink size={10} />
                            </button>
                          </AutoStep>
                        );
                      })()}

                      {/* Step 11: Execution — gated on the full Senior → Customer →
                          Director approval chain (and, server-side, every mandatory
                          document actually Verified). This used to be reachable the
                          moment staff typed a name into ExecutedBy, regardless of
                          whether any approval had happened — the button now reflects
                          the real prerequisite instead of just "not Registered yet". */}
                      {(() => {
                        const executed = !!detail.ExecutedBy;
                        const readyToExecute = detail.SeniorApprovalStatus === "Approved"
                          && detail.CustomerApprovalStatus === "Approved"
                          && detail.DirectorApprovalStatus === "Approved";
                        const notReadyReason = !readyToExecute
                          ? `Requires Senior, Customer and Director approval first — currently Senior: ${detail.SeniorApprovalStatus || "not requested"}, Customer: ${detail.CustomerApprovalStatus || "not sent"}, Director: ${detail.DirectorApprovalStatus || "not requested"}`
                          : null;
                        return (
                          <AutoStep n={11} label="Deed Execution"
                            done={executed}
                            status={executed ? <span className="text-xs text-emerald-600">Executed</span> : undefined}
                          >
                            {!progressLocked && (
                              <>
                                {!execEditing && !executed && notReadyReason ? (
                                  <p className="text-[11px] text-muted-foreground mt-1">{notReadyReason}</p>
                                ) : !execEditing && !executed ? (
                                  <button onClick={() => setExecEditing(true)}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted font-medium mt-1">
                                    Record Execution
                                  </button>
                                ) : !execEditing && executed ? (
                                  <div className="space-y-0.5 mt-1">
                                    <p className="text-xs text-muted-foreground">Executed by: <span className="font-medium text-foreground">{detail.ExecutedBy}</span></p>
                                    <button onClick={() => setExecEditing(true)} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                                      <Pencil size={10} /> Edit
                                    </button>
                                  </div>
                                ) : null}
                                {execEditing && (
                                  <div className="mt-2 space-y-2 bg-muted/30 rounded-lg px-3 py-3 border border-border">
                                    <p className="text-[11px] text-muted-foreground">Status auto-advances once recorded: ExecutedBy → Executed; RegistrationNo → Registered. All mandatory documents must be Verified (server-checked).</p>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="col-span-2 space-y-1">
                                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Executed By *</label>
                                        <Input className="h-9" value={execForm.ExecutedBy}
                                          onChange={(e) => setExecForm((f) => ({ ...f, ExecutedBy: e.target.value }))} placeholder="Authorised signatory name" />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registration No.</label>
                                        <Input className="h-9 font-mono" value={execForm.RegistrationNo}
                                          onChange={(e) => setExecForm((f) => ({ ...f, RegistrationNo: e.target.value }))} />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registration Date</label>
                                        <Input type="date" className="h-9" value={execForm.RegistrationDate}
                                          onChange={(e) => setExecForm((f) => ({ ...f, RegistrationDate: e.target.value }))} />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Book No.</label>
                                        <Input className="h-9" value={execForm.BookNo}
                                          onChange={(e) => setExecForm((f) => ({ ...f, BookNo: e.target.value }))} />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Part No.</label>
                                        <Input className="h-9" value={execForm.PartNo}
                                          onChange={(e) => setExecForm((f) => ({ ...f, PartNo: e.target.value }))} />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Possession Date</label>
                                        <Input type="date" className="h-9" value={execForm.PossessionDate}
                                          onChange={(e) => setExecForm((f) => ({ ...f, PossessionDate: e.target.value }))} />
                                      </div>
                                    </div>
                                    <div className="flex justify-end gap-2 mt-2">
                                      <button onClick={() => setExecEditing(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted">Cancel</button>
                                      <button onClick={handleSaveExecution} disabled={execSaving}
                                        className="text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 font-medium">
                                        {execSaving ? "Saving…" : "Save"}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                            {progressLocked && executed && (
                              <div className="space-y-0.5 text-xs text-muted-foreground mt-1">
                                <p>By: <span className="text-foreground font-medium">{detail.ExecutedBy}</span></p>
                                {detail.RegistrationNo && <p>RegNo: <span className="font-mono text-foreground">{detail.RegistrationNo}</span> · {fmtDate(detail.RegistrationDate)}</p>}
                                {detail.BookNo && <p>Book/Part: {detail.BookNo}/{detail.PartNo}</p>}
                              </div>
                            )}
                          </AutoStep>
                        );
                      })()}

                      {/* Step 12: Registration & Index II */}
                      <AutoStep n={12} label="Deed Registration"
                        done={!!detail.RegistrationNo}
                        status={detail.RegistrationNo ? <span className="text-xs text-emerald-600 font-mono">{detail.RegistrationNo}</span> : undefined}
                      >
                        {!detail.RegistrationNo && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Automatically marked complete when Registration No. is recorded above after the Sub-Registrar processes the deed.
                            Gate: Registry tracker must be Completed first.
                          </p>
                        )}
                        {detail.RegistrationNo && (
                          <p className="text-xs text-muted-foreground mt-1">Registered {fmtDate(detail.RegistrationDate)} · Book {detail.BookNo || "—"} / Part {detail.PartNo || "—"}</p>
                        )}
                        <div className="mt-4 pt-4 border-t border-border">
                          <DateStep n={13} label="Index II Received" isLast
                            hint="Certified copy of Index II from the Sub-Registrar"
                            value={detail.Index2ReceivedDate}
                            onSave={handleSaveIndex2}
                            saving={stepSaving}
                          />
                        </div>
                      </AutoStep>

                    </div>
                  )}

                  {activeTab === 'Documents' && (() => {
                    const allDocs = deedDetail?.documents || [];
                    const required = allDocs.filter((d: any) => d.IsMandatory);
                    const supporting = allDocs.filter((d: any) => !d.IsMandatory);
                    const verifiedCount = required.filter((d: any) => d.Status === 'Verified').length;

                    const DocRow = ({ doc }: { doc: any }) => (
                      <div className="border border-border rounded-lg p-3 text-sm bg-card">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">{mimeIcon(doc.MimeType)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className="font-medium">{doc.Label || doc.DocumentType}</span>
                              <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", DOC_STATUS_COLOR[doc.Status] || "bg-muted border-border text-muted-foreground")}>{doc.Status}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{docNextStep(doc)}</p>
                            {doc.HasFile && (
                              <p className="text-xs text-muted-foreground/80 truncate mt-0.5">{doc.FileName} · {fmtBytes(doc.FileSize)}</p>
                            )}
                            {doc.Status === 'Rejected' && doc.Remarks && (
                              <p className="text-xs text-red-600 mt-1 bg-red-50 border border-red-200 rounded px-2 py-1">"{doc.Remarks}"</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 pl-7">
                          {doc.HasFile && (doc.MimeType?.startsWith('image/') || doc.MimeType === 'application/pdf') && (
                            <button onClick={() => handlePreviewDoc(doc)} disabled={previewLoading === doc.Id} className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50">
                              {previewLoading === doc.Id ? <Loader2 size={12} className="animate-spin"/> : <Eye size={12}/>} Preview
                            </button>
                          )}
                          {doc.HasFile && (
                            <button onClick={() => handleDownloadDoc(doc)} className="text-xs text-primary hover:underline flex items-center gap-1">
                              <Download size={12}/> Download
                            </button>
                          )}
                          {['Requested', 'Rejected'].includes(doc.Status) && !progressLocked && (
                            <>
                              <input type="file" className="hidden" id={`doc-attach-${doc.Id}`} onChange={e => e.target.files?.[0] && handleAttachDoc(doc.Id, e.target.files[0])} />
                              <button onClick={() => document.getElementById(`doc-attach-${doc.Id}`)?.click()} className="text-xs bg-primary text-primary-foreground px-2.5 py-1 rounded font-medium hover:bg-primary/90">
                                {doc.Status === 'Rejected' ? 'Re-attach File' : 'Attach File'}
                              </button>
                            </>
                          )}
                          {doc.HasFile && doc.Status === 'Uploaded' && !progressLocked && (
                            <>
                              <button onClick={() => handleVerifyDoc(doc.Id)} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded hover:bg-green-100 font-medium">Verify</button>
                              <button onClick={() => handleRejectDoc(doc.Id)} className="text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded hover:bg-red-100 font-medium">Reject</button>
                            </>
                          )}
                        </div>
                      </div>
                    );

                    return (
                    <div className="space-y-5">
                      {/* Required Documents — the ones Senior Approval actually gates on.
                          Separated from supporting docs so "what's blocking approval"
                          is never mixed in with reference material. */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Required for Senior Approval</h4>
                          {required.length > 0 && (
                            <span className={cn("text-[11px] font-semibold", verifiedCount === required.length ? "text-emerald-600" : "text-amber-600")}>
                              {verifiedCount}/{required.length} verified
                            </span>
                          )}
                        </div>
                        {required.length === 0 ? (
                          <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 flex items-center justify-between gap-3">
                            <p className="text-xs text-amber-800">
                              <span className="font-semibold">No mandatory document requested yet.</span> Approval is blocked until one is requested and verified.
                            </p>
                            {!progressLocked && (
                              <button
                                onClick={() => handleRequestDoc('DeedDraft', 'Sale Deed Draft (Physical Legal Document)')}
                                disabled={requestingDoc}
                                className="shrink-0 text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50 font-medium"
                              >
                                {requestingDoc ? "Requesting..." : "Request Deed Draft"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {required.map((doc: any) => <DocRow key={doc.Id} doc={doc} />)}
                          </div>
                        )}
                      </div>

                      {/* Supporting Documents — reference material with no bearing on
                          the approval gate (e.g. a scanned executed copy kept for
                          record). Kept visually distinct from Required above so
                          nobody mistakes one for the other. */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Supporting Documents</h4>
                        {supporting.length > 0 ? (
                          <div className="space-y-2">
                            {supporting.map((doc: any) => <DocRow key={doc.Id} doc={doc} />)}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">None added.</p>
                        )}
                      </div>

                      {!progressLocked && (
                        <div className="border border-dashed border-border rounded-lg p-4 bg-muted/20">
                          <p className="text-xs font-semibold mb-0.5 text-foreground">Add a Supporting Document</p>
                          <p className="text-xs text-muted-foreground mb-2">For reference material only — use "Request Deed Draft" above for anything Senior Approval needs to check.</p>
                          <div className="flex items-end gap-2">
                            <div className="flex-1 space-y-1">
                              <label className="text-[10px] font-medium text-muted-foreground">Type</label>
                              <select value={newDocType} onChange={e => setNewDocType(e.target.value)} className="w-full h-8 text-xs border border-border rounded px-2 bg-background">
                                <option value="ExecutedDeed">Executed Deed Copy</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            <div className="flex-1 space-y-1">
                              <label className="text-[10px] font-medium text-muted-foreground">Label (Optional)</label>
                              <Input className="h-8 text-xs" value={newDocLabel} onChange={e => setNewDocLabel(e.target.value)} placeholder="e.g. Approved copy" />
                            </div>
                            <div className="shrink-0 space-y-1">
                              <label className="text-[10px] font-medium text-transparent">.</label>
                              <input type="file" className="hidden" ref={fileInputRef} onChange={e => e.target.files?.[0] && handleUploadDoc(e.target.files[0], newDocType, newDocLabel)} />
                              <button onClick={() => fileInputRef.current?.click()} disabled={uploadingDoc}
                                className="h-8 px-3 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 flex items-center gap-1.5 font-medium disabled:opacity-50">
                                <Upload size={12}/> {uploadingDoc ? "Uploading..." : "Upload"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })()}

                  {activeTab === 'History' && (
                    <div className="space-y-0">
                      {deedDetail?.approvalLog && deedDetail.approvalLog.length > 0 ? (
                        <div className="relative border-l border-border ml-3 pl-4 space-y-4 py-2">
                          {deedDetail.approvalLog.map((log: any) => {
                            const cfg = LOG_ACTION_CFG[log.Action] || { label: log.Action, color: 'text-foreground' };
                            return (
                              <div key={log.Id} className="relative">
                                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-border ring-4 ring-card" />
                                <div className="text-sm">
                                  <div className="flex items-baseline gap-2">
                                    <span className={cn("font-medium", cfg.color)}>{cfg.label}</span>
                                    <span className="text-xs text-muted-foreground">{fmtDate(log.CreatedAt)}</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName} ({log.ActorType})</div>
                                  {log.Remarks && <div className="text-xs bg-muted/30 border border-border rounded p-2 mt-1.5 text-foreground">{log.Remarks}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-xs text-muted-foreground">No approval actions recorded yet.</div>
                      )}
                    </div>
                  )}
              </>
            )}
          </div>
        </div>

        <Dialog open={!!previewDoc} onOpenChange={(o) => { if (!o) closePreview(); }}>
          <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-4 py-2.5 border-b border-border">
              <DialogTitle className="text-sm truncate">{previewDoc?.name}</DialogTitle>
            </DialogHeader>
            <div className="bg-muted/30 flex items-center justify-center" style={{ height: '75vh' }}>
              {previewDoc?.mime === 'application/pdf' ? (
                <iframe src={previewDoc.url} title={previewDoc.name} className="w-full h-full border-0" />
              ) : previewDoc ? (
                <img src={previewDoc.url} alt={previewDoc.name} className="max-w-full max-h-full object-contain" />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

        {/* Keep the New Deed creation Dialog and Proxy Dialogs below everything */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
          <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Plus size={15} className="text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-sm font-semibold font-heading">New Sale Deed</DialogTitle>
                  <DialogDescription className="text-[11px] mt-0.5">Requires AFS Registered + Loan Cleared</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Booking *</label>
                <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value, DeedValue: "" }))}
                  className="w-full h-10 text-sm border border-border rounded-lg px-3 bg-background">
                  <option value="">Select booking</option>
                  {(eligible as any[]).map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ApplicantName} · {b.UnitNo}</option>
                  ))}
                </select>
                {!(eligible as any[]).length && (
                  <p className="text-xs text-muted-foreground">No eligible bookings — AFS must be Registered first.</p>
                )}
              </div>

              {form.BookingId && (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 space-y-1.5">
                  {contextLoading ? <div className="text-xs text-muted-foreground">Checking eligibility…</div>
                  : !context ? <div className="text-xs text-muted-foreground">Couldn't load booking details.</div>
                  : (
                    <>
                      <p className="text-sm font-semibold">{context.booking?.ApplicantName}</p>
                      <p className="text-xs text-muted-foreground">{context.booking?.BookingNo} · {context.booking?.UnitNo} · {formatINR(context.booking?.GrandTotal)}</p>
                      <div className={cn("flex items-center gap-1.5 text-xs pt-1", agreementRegistered ? "text-emerald-700" : "text-rose-600")}>
                        {agreementRegistered ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        Agreement {context.agreement ? `${context.agreement.AgreementNo} — ${context.agreement.Status}` : "not created yet"}
                      </div>
                      {context?.requiresHandoverBeforeDeed && (
                        <div className={cn("flex items-center gap-1.5 text-xs", handoverCleared ? "text-emerald-700" : "text-rose-600")}>
                          {handoverCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          Handover (under-construction project) — {context.handoverStatus || "not started"}
                          {!handoverCleared && (
                            <button onClick={() => navigate(`/crm/handover?bookingId=${form.BookingId}`)}
                              className="flex items-center gap-1 text-primary hover:underline ml-1">
                              Go to Handover <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      )}
                      {isLoanFinanced && (
                        <div className={cn("flex items-center gap-1.5 text-xs", loanCleared ? "text-emerald-700" : "text-rose-600")}>
                          {loanCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          Loan Processing — {loanCleared ? "Cleared" : context.loanBlockReason}
                          {!loanCleared && (
                            <button onClick={() => navigate(`/crm/loan-details?bookingId=${form.BookingId}`)}
                              className="flex items-center gap-1 text-primary hover:underline ml-1">
                              Go to Loan Tracking <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Deed Value", "DeedValue", "number"],
                  ["Stamp Duty", "StampDuty", "number"],
                  ["Registration Fee", "RegistrationFee", "number"],
                  ["AFS Stamp Duty Credit", "StampDutyCredit", "number"],
                  ["Deed Date", "DeedDate", "date"],
                  ["Registration Deadline (RERA)", "RegistrationDeadline", "date"],
                ].map(([lbl, key, type]) => (
                  <div key={key} className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">{lbl}</label>
                    <Input type={type} className="h-10 font-mono" value={(form as any)[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Sub-Registrar Office</label>
                <Input className="h-10" value={form.SubRegistrarOffice}
                  onChange={(e) => setForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
              </div>
              {context?.agreement?.AfsStampDuty != null && (
                <p className="text-[10px] text-emerald-600">
                  ✓ AFS stamp duty ₹{Number(context.agreement.AfsStampDuty).toLocaleString("en-IN")} pre-filled as credit — verify against Sub-Registrar receipt before saving.
                </p>
              )}
            </div>

            <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20">
              <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !canCreate}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
                {saving ? "Creating…" : "Create"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {proxyApproveDialog && (
        <ProxyActionDialog
          title="Record Customer Approval — Sales Deed"
          description="You are recording that the customer has reviewed and approved the sales deed without using the portal."
          confirmLabel="Record Approval"
          saving={proxySaving}
          onClose={() => setProxyApproveDialog(false)}
          onConfirm={handleProxyApprove}
        />
      )}
      {proxyRecheckDialog && (
        <ProxyActionDialog
          title="Record Customer Recheck Request — Sales Deed"
          description="You are recording that the customer flagged an issue or requested changes to the sales deed without using the portal."
          confirmLabel="Record Recheck Request"
          saving={proxySaving}
          onClose={() => setProxyRecheckDialog(false)}
          onConfirm={handleProxyRecheck}
        />
      )}
    </CrmShell>
    </>
  );
};

export default CrmSalesDeed;
