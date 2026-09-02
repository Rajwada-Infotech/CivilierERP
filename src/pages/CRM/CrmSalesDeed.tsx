import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/sales-deed";

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
function DeedDetailsSection({ detail, onSave, saving, canEdit }: {
  detail: any;
  onSave: (fields: Record<string, string>) => void;
  saving: boolean;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
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
    <div className="border border-border rounded-lg overflow-hidden">
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
              {canEdit && !locked && (
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

const CrmSalesDeed: React.FC = () => {
  const rights = usePageRights("crm-sales-deed");
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
  // Same context endpoint, keyed off the OPEN deed's booking — used to
  // cross-link Query Payment (Step 6) and Registry (Step 7) status into the
  // stepper without duplicating that data onto CrmSalesDeed itself.
  const { data: detailContext } = useQuery({
    queryKey: ["crm-sales-deed-context", detailId != null ? String((deeds as any[]).find((d: any) => d.Id === detailId)?.BookingId ?? "") : ""],
    queryFn: () => fetchBookingContext(String((deeds as any[]).find((d: any) => d.Id === detailId)?.BookingId ?? "")),
    enabled: detailId != null,
  });

  // Agreement for Sale, registered at the Sub-Registrar (AFS), is mandatory
  // for every Sale Deed — no project-type exception. Must mirror the
  // backend gate in crmSalesDeed.js POST / exactly, or this dialog can
  // enable Create for a booking the server then rejects.
  const agreementRegistered = context?.agreement?.Status === "Registered";
  const isLoanFinanced = context?.booking?.FinancingType === "LoanFinanced";
  const loanCleared = !context?.loanBlockReason;
  // The only thing that legitimately varies by project state: whether
  // Handover must finish before the deed is drafted. Only a project still
  // explicitly Under-Construction (and not yet Completed) needs this —
  // see the matching backend gate in crmSalesDeed.js POST /.
  const handoverCleared = !context?.requiresHandoverBeforeDeed || context?.handoverStatus === "Completed";
  const canCreate = !!form.BookingId && agreementRegistered && loanCleared && handoverCleared && !contextLoading;

  const detail = detailId != null ? (deeds as any[]).find((d: any) => d.Id === detailId) : null;
  const registered = detail?.Status === CrmStatus.REGISTERED;
  const cancelled = detail?.Status === CrmStatus.CANCELLED;
  const progressLocked = registered || cancelled;

  // Deep-link: open new deed dialog for a booking
  useEffect(() => {
    if (!rights.canCreate || !deepLinkBookingId || dialogOpen) return;
    if ((deeds as any[]).some((d: any) => String(d.BookingId) === deepLinkBookingId)) return;
    if ((eligible as any[]).some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, deeds.length, eligible.length]);

  // Deep-link: open deed detail by deedId
  useEffect(() => {
    if (!deedIdFilter || deedDeepLinkOpened || !(deeds as any[]).length) return;
    const match = (deeds as any[]).find((d: any) => String(d.Id) === deedIdFilter);
    if (match) { setDeedDeepLinkOpened(true); openDetail(match); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deedIdFilter, deedDeepLinkOpened, deeds]);

  // Auto-fill AFS stamp duty credit from context
  useEffect(() => {
    if (!context?.agreement) return;
    const credit = Number(context.agreement.AfsStampDuty ?? 0) || 0;
    if (credit > 0) setForm((f) => ({ ...f, StampDutyCredit: f.StampDutyCredit === "" ? String(credit) : f.StampDutyCredit }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.agreement?.AfsStampDuty]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
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

  const openDetail = (d: any) => {
    setExecForm({
      ExecutedBy: d.ExecutedBy || "", RegistrationNo: d.RegistrationNo || "",
      BookNo: d.BookNo || "", PartNo: d.PartNo || "",
      RegistrationDate: d.RegistrationDate ? String(d.RegistrationDate).slice(0, 10) : "",
      PossessionDate: d.PossessionDate ? String(d.PossessionDate).slice(0, 10) : "",
    });
    setExecEditing(false);
    setDetailId(d.Id);
    setSp((p) => { p.set("deedId", String(d.Id)); return p; }, { replace: true });
  };

  const closeDetail = () => {
    setDetailId(null);
    setSp((p) => { p.delete("deedId"); return p; }, { replace: true });
  };

  // Generic save for any deed fields
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

  // Manual step save (DocCollection / DeedDrafting / InternalApproval)
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

  const deedColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "DeedNo", header: "Deed No", size: 110,
      cell: (i) => (
        <button onClick={() => openDetail(i.row.original)} className="font-mono text-xs font-semibold text-primary hover:underline">
          {i.getValue() as string}
        </button>
      ) },
    { accessorKey: "ApplicantName", header: "Customer", size: 160,
      cell: (i) => (
        <button onClick={() => openDetail(i.row.original)} className="text-left hover:underline">
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </button>
      ) },
    { accessorKey: "DeedValue", header: "Deed Value", size: 120,
      cell: (i) => <span className="font-mono text-xs">{i.row.original.DeedValue ? formatINR(i.row.original.DeedValue) : "—"}</span> },
    { accessorKey: "RegistrationNo", header: "Registration No", size: 130,
      cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "Status", header: "Status", size: 110,
      cell: (i) => <StatusBadge status={i.row.original.Status} /> },
    { id: "customerApproval", header: "Customer", size: 120,
      cell: (i) => {
        const d = i.row.original;
        return d.CustomerApprovalStatus ? <StatusBadge status={d.CustomerApprovalStatus} cfg={APPROVAL_CFG} /> : <span className="text-xs text-muted-foreground">—</span>;
      } },
    { id: "directorApproval", header: "Director", size: 120,
      cell: (i) => {
        const d = i.row.original;
        return d.DirectorApprovalStatus && d.DirectorApprovalStatus !== "NotRequired"
          ? <StatusBadge status={d.DirectorApprovalStatus} cfg={APPROVAL_CFG} />
          : <span className="text-xs text-muted-foreground">—</span>;
      } },
    { id: "open", header: "", size: 60,
      cell: (i) => (
        <button onClick={() => openDetail(i.row.original)} className="text-xs text-primary hover:underline">Open</button>
      ) },
  ];

  return (
    <CrmShell
      title="Sale Deed"
      subtitle="Conveyance deed that transfers legal ownership from developer to buyer (s.54 TPA 1882) — must be registered with the Sub-Registrar to be legally valid"
      action={
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <button onClick={() => refetch()} disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
              <RotateCcw size={12} className={isFetching ? "animate-spin" : ""} /> {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {rights.canCreate && (
            <button onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> New Deed
            </button>
          )}
        </div>
      }
    >
      <DataTable
        data={deeds as any[]}
        columns={deedColumns}
        loading={isLoading}
        emptyMessage="No sale deeds yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* ── New Sale Deed ─────────────────────────────────────────────────── */}
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

      {/* ── Deed detail / stepper ─────────────────────────────────────────── */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) closeDetail(); }}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          {detail && (
            <>
              <DialogHeader className="px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ScrollText size={15} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-sm font-semibold font-heading font-mono">{detail.DeedNo}</DialogTitle>
                    <DialogDescription className="text-[11px] mt-0.5">
                      {detail.ApplicantName} · {detail.BookingNo} · {detail.UnitNo}
                    </DialogDescription>
                  </div>
                  <div className="ml-auto">
                    <StatusBadge status={detail.Status} />
                  </div>
                </div>
              </DialogHeader>

              <div className="px-6 py-5 space-y-4 max-h-[78vh] overflow-y-auto">
                {/* Deed Details collapsible */}
                <DeedDetailsSection detail={detail} onSave={handleSaveDeedDetails} saving={deedDetailSaving} canEdit={rights.canEdit} />

                {/* ── Workflow Stepper ──────────────────────────────────── */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-3">Sale Deed Workflow</p>

                  {/* Step 1: Document Collection */}
                  <ManualStep n={1} label="Document Collection"
                    hint="Gather title chain, encumbrance certificate, property card, AFS copy, OC/CC"
                    done={!!detail.DocCollectionDone}
                    date={detail.DocCollectionDate}
                    notes={detail.DocCollectionNotes}
                    onSave={(done, date, notes) => handleManualStep("DocCollection", done, date, notes)}
                    saving={stepSaving}
                  />

                  {/* Step 2: Deed Drafting */}
                  <ManualStep n={2} label="Deed Drafting"
                    hint="Legal team prepares the Sale Deed incorporating property and consideration details"
                    done={!!detail.DeedDraftingDone}
                    date={detail.DeedDraftingDate}
                    notes={detail.DeedDraftingNotes}
                    onSave={(done, date, notes) => handleManualStep("DeedDrafting", done, date, notes)}
                    saving={stepSaving}
                  />

                  {/* Step 3: Internal Approval */}
                  <ManualStep n={3} label="Internal Approval"
                    hint="Company's legal head / authorized signatory reviews and clears the draft"
                    done={!!detail.InternalApprovalDone}
                    date={detail.InternalApprovalDate}
                    notes={detail.InternalApprovalNotes}
                    onSave={(done, date, notes) => handleManualStep("InternalApproval", done, date, notes)}
                    saving={stepSaving}
                  />

                  {/* Step 4: Customer Review */}
                  {(() => {
                    const sent = !!detail.SentToCustomerAt;
                    const custStatus = detail.CustomerApprovalStatus;
                    const approved = custStatus === CrmStatus.APPROVED;
                    return (
                      <AutoStep n={4} label="Customer Review"
                        done={approved}
                        status={sent ? <StatusBadge status={custStatus || "Pending"} cfg={APPROVAL_CFG} /> : undefined}
                      >
                        {!sent && !progressLocked && (
                          <div className="space-y-1">
                            {!detail.InternalApprovalDone && (
                              <p className="text-xs text-amber-600 flex items-center gap-1">
                                <AlertTriangle size={11} /> Complete Internal Approval (Step 3) before sending to customer.
                              </p>
                            )}
                            <button onClick={handleSendToCustomer} disabled={sendingToCustomer || !detail.InternalApprovalDone}
                              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition-colors font-medium">
                              {sendingToCustomer ? "Sending…" : "Send Draft to Customer"}
                            </button>
                          </div>
                        )}
                        {sent && !approved && !progressLocked && (
                          <div className="space-y-1.5">
                            <p className="text-[11px] text-muted-foreground">Sent {fmtDate(detail.SentToCustomerAt)}</p>
                            {detail.CustomerRecheckRemarks && (
                              <p className="text-xs text-rose-600">Recheck: {detail.CustomerRecheckRemarks}</p>
                            )}
                            <div className="flex gap-2 flex-wrap">
                              <button onClick={() => setProxyApproveDialog(true)}
                                className="text-xs px-3 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg font-semibold hover:bg-amber-100 flex items-center gap-1.5">
                                <UserCircle2 size={11} /> Record Approval (Offline)
                              </button>
                              <button onClick={() => setProxyRecheckDialog(true)}
                                className="text-xs px-3 py-1.5 bg-red-50 border border-red-200 text-red-800 rounded-lg font-semibold hover:bg-red-100 flex items-center gap-1.5">
                                <UserCircle2 size={11} /> Record Recheck (Offline)
                              </button>
                            </div>
                          </div>
                        )}
                        {approved && (
                          <p className="text-xs text-emerald-600">Approved {fmtDate(detail.CustomerApprovedAt)}</p>
                        )}
                      </AutoStep>
                    );
                  })()}

                  {/* Step 5: Director Approval */}
                  {(() => {
                    const dirStatus = detail.DirectorApprovalStatus;
                    const dirApproved = dirStatus === CrmStatus.APPROVED;
                    return (
                      <AutoStep n={5} label="Director Approval"
                        done={dirApproved}
                        status={dirStatus && dirStatus !== "NotRequired" ? <StatusBadge status={dirStatus} cfg={APPROVAL_CFG} /> : undefined}
                      >
                        {dirStatus === CrmStatus.PENDING && (
                          <ApprovalActions
                            status={dirStatus}
                            recordId={detail.Id}
                            endpoint={API}
                            actionPathSuffix="director"
                            approverRoles={["super_admin"]}
                            onSuccess={() => { invalidate(); }}
                          />
                        )}
                        {dirApproved && (
                          <p className="text-xs text-emerald-600">Approved {fmtDate(detail.DirectorApprovedAt)}</p>
                        )}
                        {dirStatus === CrmStatus.REJECTED && (
                          <p className="text-xs text-rose-600">Rejected — {detail.DirectorApprovalRemarks}</p>
                        )}
                      </AutoStep>
                    );
                  })()}

                  {/* Step 6: Stamp Duty Payment — read-only cross-link to Query
                      Payment. The amount, sending paperwork, and confirming the
                      customer paid the government all happen on that page —
                      this is a status mirror, not a duplicate workflow. */}
                  {(() => {
                    const qpStatus = detailContext?.queryPaymentStatus;
                    const qpConfirmed = qpStatus === "Confirmed";
                    return (
                      <AutoStep n={6} label="Stamp Duty Payment"
                        done={qpConfirmed}
                        status={qpStatus ? <StatusBadge status={qpStatus} /> : undefined}
                      >
                        {!qpStatus && (
                          <p className="text-xs text-muted-foreground">
                            {detail.DirectorApprovalStatus === CrmStatus.APPROVED
                              ? "Not started yet."
                              : "Unlocks once Director Approval (Step 5) is complete."}
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

                  {/* Step 7: SRO Appointment — read-only cross-link to Registry.
                      The appointment date lives only on CrmRegistry.ScheduledDate;
                      it is never duplicated onto the deed. */}
                  {(() => {
                    const regStatus = detailContext?.registryStatus;
                    const regDone = regStatus === "Completed";
                    return (
                      <AutoStep n={7} label="Sub-Registrar Appointment"
                        done={regDone}
                        status={regStatus ? <StatusBadge status={regStatus} cfg={{ Pending: STATUS_CFG.Draft, Scheduled: { text: "text-blue-700", bar: "bg-blue-500" }, Completed: { text: "text-emerald-700", bar: "bg-emerald-500" } }} /> : undefined}
                      >
                        {!regStatus && (
                          <p className="text-xs text-muted-foreground">
                            {detailContext?.queryPaymentStatus === "Confirmed"
                              ? "Not started yet."
                              : "Unlocks once Stamp Duty Payment (Step 6) is Confirmed."}
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

                  {/* Step 8: Execution */}
                  {(() => {
                    const executed = !!detail.ExecutedBy;
                    return (
                      <AutoStep n={8} label="Deed Execution"
                        done={executed}
                        status={executed ? <span className="text-xs text-emerald-600">Executed</span> : undefined}
                      >
                        {!progressLocked && (
                          <>
                            {!execEditing && !executed ? (
                              <button onClick={() => setExecEditing(true)}
                                className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted font-medium">
                                Record Execution
                              </button>
                            ) : !execEditing && executed ? (
                              <div className="space-y-0.5">
                                <p className="text-xs text-muted-foreground">Executed by: <span className="font-medium text-foreground">{detail.ExecutedBy}</span></p>
                                <button onClick={() => setExecEditing(true)} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                                  <Pencil size={10} /> Edit
                                </button>
                              </div>
                            ) : null}
                            {execEditing && (
                              <div className="mt-2 space-y-2 bg-muted/30 rounded-lg px-3 py-3 border border-border">
                                <p className="text-[11px] text-muted-foreground">Status auto-advances: ExecutedBy set → Executed; RegistrationNo set → Registered</p>
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
                                <div className="flex justify-end gap-2">
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
                          <div className="space-y-0.5 text-xs text-muted-foreground">
                            <p>By: <span className="text-foreground font-medium">{detail.ExecutedBy}</span></p>
                            {detail.RegistrationNo && <p>RegNo: <span className="font-mono text-foreground">{detail.RegistrationNo}</span> · {fmtDate(detail.RegistrationDate)}</p>}
                            {detail.BookNo && <p>Book/Part: {detail.BookNo}/{detail.PartNo}</p>}
                          </div>
                        )}
                      </AutoStep>
                    );
                  })()}

                  {/* Step 9: Registration (auto from RegistrationNo) */}
                  <AutoStep n={9} label="Deed Registration"
                    done={!!detail.RegistrationNo}
                    status={detail.RegistrationNo ? <span className="text-xs text-emerald-600 font-mono">{detail.RegistrationNo}</span> : undefined}
                  >
                    {!detail.RegistrationNo && (
                      <p className="text-xs text-muted-foreground">
                        Automatically marked complete when Registration No. is recorded above after the Sub-Registrar processes the deed.
                        Gate: Registry tracker must be Completed first.
                      </p>
                    )}
                    {detail.RegistrationNo && (
                      <p className="text-xs text-muted-foreground">Registered {fmtDate(detail.RegistrationDate)} · Book {detail.BookNo || "—"} / Part {detail.PartNo || "—"}</p>
                    )}
                  </AutoStep>

                  {/* Step 10: Index II Received */}
                  <DateStep n={10} label="Index II Received" isLast
                    hint="Certified copy of Index II from the Sub-Registrar (contains buyer name, property description, consideration amount)"
                    value={detail.Index2ReceivedDate}
                    onSave={handleSaveIndex2}
                    saving={stepSaving}
                  />
                </div>
              </div>

              <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20">
                <button onClick={closeDetail} className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Close</button>
              </DialogFooter>
            </>
          )}
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
  );
};

export default CrmSalesDeed;
