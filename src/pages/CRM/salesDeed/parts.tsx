// The deed's step bar, ruled panels and steps, the deed-details block and a document row (shared by the deed's own
// documents and the registry's).
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, FolderOpen, Loader2, Lock, Pencil, ScanLine, ScrollText, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import { GRID_BTN, GRID_BTN_BRAND, GRID_INPUT, GRID_LABEL, GridProgress, GridStatusPill } from "@/components/crm/CrmDataTable";
import { DateInput } from "@/components/ui/date-input";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { docStatusColor } from "../agreement/Timeline";
import { GRID_SHEET_KEYS } from "@/components/crm/CrmDataTable";
// Drawn with the CRM record kit; the keys, labels, inputs and rules it uses map onto it.
const { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } = GRID_SHEET_KEYS;
import { DeedTab, StepState, docNextStep, downloadFile, fetchFileBlob, fmtBytes, fmtDate, mimeIcon } from "./config";

/** A ruled panel: a lettered head (with whatever sits on its right) over its content. */
export function Panel({ title, icon, right, children, className = "" }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-lg border border-border shadow-[0_2px_3px_0_hsl(var(--foreground)/0.07)] overflow-hidden ${className}`}>
      <div className="px-4 h-11 flex items-center justify-between gap-3 flex-wrap border-b border-border">
        <h3 className="text-[0.8125rem] font-bold text-foreground flex items-center gap-2">{icon && <span className="w-6 h-6 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">{icon}</span>}{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

/** A square step number: filled when done, double-ruled when it's the current one. */
export function StepBox({ n, done, active, stopped }: { n: number; done: boolean; active: boolean; stopped?: boolean }) {
  return (
    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.6875rem] font-bold tabular-nums shrink-0 ${
      stopped ? "bg-destructive text-white border border-destructive"
      : done ? "bg-emerald-600 text-white border border-emerald-600"
      : active ? "bg-card text-primary border-2 border-primary"
      : "bg-card text-muted-foreground border border-border"}`}>
      {done ? <Check size={13} /> : n}
    </span>
  );
}

export function AutoStep({ n, label, done, status, children, isLast = false }: {
  n: number; label: string; done: boolean; status?: React.ReactNode; children?: React.ReactNode; isLast?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepBox n={n} done={done} active={!done} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-5"}`}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[0.8125rem] font-semibold text-foreground pt-1.5">{label}</p>
          {status}
        </div>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

export function DateStep({ n, label, hint, value, onSave, saving, canEdit, isLast = false }: {
  n: number; label: string; hint?: string; value: string | null; onSave: (date: string) => void; saving: boolean; canEdit: boolean; isLast?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [formDate, setFormDate] = useState(() => value ? String(value).slice(0, 10) : "");
  const done = !!value;
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepBox n={n} done={done} active={!done} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-5"}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[0.8125rem] font-semibold text-foreground pt-1.5">{label}</p>
            {done && !editing ? <p className="text-xs text-foreground mt-0.5 tabular-nums">{fmtDate(value)}</p>
              : hint ? <p className="text-xs text-muted-foreground mt-0.5">{hint}</p> : null}
          </div>
          {canEdit && done && !editing && (
            <button onClick={() => { setFormDate(String(value).slice(0, 10)); setEditing(true); }} className={`${KEY_LINE} h-7 px-2 shrink-0`}>
              <Pencil size={10} /> Edit
            </button>
          )}
        </div>
        {canEdit && (!done || editing) && (
          <div className="mt-2 flex items-center gap-2">
            <DateInput value={formDate} onChange={(e) => setFormDate(e.target.value)} className={`${INP} max-w-[11rem]`} />
            <button onClick={() => { onSave(formDate); setEditing(false); }} disabled={saving || !formDate} className={`${KEY_INK} h-9 px-3`}>
              {saving ? "Saving…" : "Save"}
            </button>
            {editing && <button onClick={() => setEditing(false)} className={`${KEY_LINE} h-9 px-3`}>Cancel</button>}
          </div>
        )}
      </div>
    </div>
  );
}

const DETAIL_FIELDS: [string, string, string][] = [
  ["Deed value", "DeedValue", "number"],
  ["Stamp duty", "StampDuty", "number"],
  ["Registration fee", "RegistrationFee", "number"],
  ["Agreement stamp duty credit", "StampDutyCredit", "number"],
  ["Deed date", "DeedDate", "date"],
  ["Registration deadline", "RegistrationDeadline", "date"],
];

export function DeedDetailsSection({ detail, onSave, saving, canEdit }: {
  detail: any; onSave: (fields: Record<string, string>) => void; saving: boolean; canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const locked = !!detail.SentToCustomerAt;
  const initial = () => ({
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
  const [form, setForm] = useState(initial);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Panel title="Deed Details" icon={<ScrollText size={13} />}
      right={canEdit && !locked && !editing ? <button onClick={() => { setForm(initial()); setEditing(true); }} className={`${KEY_LINE} h-7 px-2`}><Pencil size={10} /> Edit</button> : undefined}>
      <div className="px-4 py-3 space-y-3">
        {locked && (
          <p className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground px-3 py-1.5" style={{ border: RULE_SOFT }}>
            <Lock size={11} /> Locked — sent to the customer for approval on {fmtDate(detail.SentToCustomerAt)}.
          </p>
        )}
        {editing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {DETAIL_FIELDS.map(([lbl, key, type]) => (
                <div key={key} className="space-y-1">
                  <label className={`block ${LBL}`}>{lbl}</label>
                  {type === "date"
                    ? <DateInput className={INP} value={(form as any)[key]} onChange={(e) => set(key, e.target.value)} />
                    : <input type="number" className={`${INP} tabular-nums`} value={(form as any)[key]} onChange={(e) => set(key, e.target.value)} />}
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <label className={`block ${LBL}`}>Sub-Registrar office</label>
              <input className={INP} value={form.SubRegistrarOffice} onChange={(e) => set("SubRegistrarOffice", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className={`block ${LBL}`}>Witness names</label>
              <input className={INP} value={form.WitnessNames} onChange={(e) => set("WitnessNames", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className={`block ${LBL}`}>Notes</label>
              <textarea rows={2} className={TEXTAREA} value={form.Notes} onChange={(e) => set("Notes", e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(false)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
              <button onClick={() => { onSave(form); setEditing(false); }} disabled={saving} className={`${KEY_INK} h-8 px-3`}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
              {([
                ["Deed value", detail.DeedValue ? fmtRupees(detail.DeedValue) : null],
                ["Stamp duty", detail.StampDuty ? fmtRupees(detail.StampDuty) : null],
                ["Registration fee", detail.RegistrationFee ? fmtRupees(detail.RegistrationFee) : null],
                ["Agreement stamp duty credit", detail.StampDutyCredit != null ? "− " + fmtRupees(detail.StampDutyCredit) : null],
                ["Deed date", detail.DeedDate ? fmtDate(detail.DeedDate) : null],
                ["Registration deadline", detail.RegistrationDeadline ? fmtDate(detail.RegistrationDeadline) : null],
                ["Sub-Registrar office", detail.SubRegistrarOffice || null],
                ["Witness names", detail.WitnessNames || null],
              ] as [string, string | null][]).map(([lbl, val]) => (
                <div key={lbl} className="min-w-0">
                  <dt className={LBL}>{lbl}</dt>
                  <dd className={cn("mt-0.5 text-[0.8125rem] tabular-nums break-words", val ? "font-medium" : "text-muted-foreground italic")}>{val ?? "Not set"}</dd>
                </div>
              ))}
            </dl>
            {detail.Notes && <p className="text-xs text-muted-foreground pt-1"><span className="font-medium text-foreground">Notes:</span> {detail.Notes}</p>}
          </>
        )}
      </div>
    </Panel>
  );
}

/** Status of a document, as a squared tag. */
export function DocTag({ status }: { status: string }) {
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 border ${docStatusColor[status] || "text-muted-foreground border-border"}`}>
      {status}
    </span>
  );
}

// ══ Document centre ═══════════════════════════════════════════════════════════
// One way to upload, check and review a record's papers on every legal page (Agreement, Sale Deed, Mutation, …):
// required and supporting lists with what each needs next, drag-and-drop (several files, or one straight onto a
// requested paper), reject with the reason typed in place, and a side-by-side reviewer that walks through what is waiting.
// A paper is verified only in the reviewer, with its file in view: verifying is the legal check that the paper is right,
// so it can't be done from a list without looking. Each page passes its own server calls; who may attach or review is the
// page's rule, as before.
export interface DocCentreUpload {
  types: { value: string; label: string }[];
  run: (files: File[], type: string, label: string) => Promise<void>;
  /** Whether the page's upload takes a label (default yes). */
  withLabel?: boolean;
}
/** A page's audit rows (CrmAuditLog: Field, OldValue, NewValue, ChangedAt, ChangedByName) as the reviewer's history. */
export const auditToHistory = (rows: any[]) => (rows || []).map((r) => ({
  at: r.ChangedAt, by: r.ChangedByName ?? null,
  text: r.Field === "Status" ? `${r.OldValue || "—"} → ${r.NewValue || "—"}` : `${r.Field}: ${r.OldValue || "—"} → ${r.NewValue || "—"}`,
}));
export interface DocCentreProps {
  documents: any[];
  /** Whether a paper has its file (the pages name it differently). */
  hasFile: (d: any) => boolean;
  fileUrl: (d: any) => string;
  review: (d: any, verify: boolean, remarks?: string) => Promise<void>;
  /** Attach a file to a requested or rejected paper; leave out where staff can't. */
  attach?: (d: any, file: File) => Promise<void>;
  /** Add supporting papers (several at once). */
  upload?: DocCentreUpload;
  canAttach?: { ok: boolean; reason?: string };
  canReview?: { ok: boolean; reason?: string };
  /** The paper's change history for the reviewer, when the page keeps one. */
  history?: (d: any) => Promise<{ at: string; text: string; by?: string | null }[]>;
  /** What to do next, when the usual wording doesn't fit (e.g. "Awaiting the customer's upload"). */
  nextStep?: (d: any) => string | undefined;
  extraTag?: (d: any) => React.ReactNode;
  /** Page-specific keys for one paper, shown in the reviewer. */
  extraActions?: (d: any) => React.ReactNode;
  /** Page-specific keys on a paper's row (e.g. upload on the customer's behalf). */
  rowActions?: (d: any) => React.ReactNode;
  /** Shown when nothing mandatory has been asked for yet (e.g. a Request key). */
  emptyRequired?: React.ReactNode;
  /** Keys in the header (e.g. Request from customer). */
  headerActions?: React.ReactNode;
  requiredTitle?: string;
  onChanged: () => void;
}

const docName = (d: any) => d.Label || String(d.DocumentType || "Document").replace(/([a-z])([A-Z])/g, "$1 $2");
const canPreview = (d: any) => d.MimeType?.startsWith("image/") || d.MimeType === "application/pdf";

export function DocumentCentre(p: DocCentreProps) {
  const { documents, hasFile, review, attach, upload, canAttach = { ok: true }, canReview = { ok: true } } = p;
  const required = documents.filter((d) => d.IsMandatory);
  const supporting = documents.filter((d) => !d.IsMandatory);
  const waiting = documents.filter((d) => hasFile(d) && (d.Status === "Uploaded" || d.Status === "Submitted"));
  const uploadedReq = required.filter(hasFile).length;
  const verifiedReq = required.filter((d) => d.Status === "Verified").length;
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [dropOn, setDropOn] = useState<number | "new" | null>(null);
  const [upType, setUpType] = useState(upload?.types[0]?.value ?? "");
  const [upLabel, setUpLabel] = useState("");
  const [uploading, setUploading] = useState(false);

  const run = async (key: number, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); p.onChanged(); } catch (e: any) { toast.error(translateError(e.message)); } finally { setBusy(null); }
  };
  const verifyOne = (d: any) => run(d.Id, async () => { await review(d, true); toast.success(`${docName(d)} verified`); });
  const rejectOne = (d: any) => {
    if (!reason.trim()) { toast.error("Say what is wrong, so the uploader can fix it."); return; }
    return run(d.Id, async () => { await review(d, false, reason.trim()); toast.success(`${docName(d)} rejected`); setRejecting(null); setReason(""); });
  };
  const attachTo = (d: any, file: File) => attach && run(d.Id, async () => { await attach(d, file); toast.success(`File attached to ${docName(d)}`); });
  const uploadNew = async (files: File[]) => {
    if (!upload || !files.length) return;
    setUploading(true);
    try { await upload.run(files, upType, upLabel.trim()); toast.success(`${files.length} file${files.length === 1 ? "" : "s"} uploaded`); setUpLabel(""); p.onChanged(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setUploading(false); }
  };
  const dropProps = (target: number | "new", onFiles: (files: File[]) => void, enabled: boolean) => enabled ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDropOn(target); },
    onDragLeave: () => setDropOn((cur) => (cur === target ? null : cur)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDropOn(null); const files = Array.from(e.dataTransfer.files || []); if (files.length) onFiles(files); },
  } : {};

  const row = (d: any) => {
    const file = hasFile(d);
    const needsFile = !file || d.Status === "Rejected";
    const canDropHere = !!attach && canAttach.ok && needsFile;
    const waitingReview = file && (d.Status === "Uploaded" || d.Status === "Submitted");
    return (
      <li key={d.Id} {...dropProps(d.Id, (files) => attachTo(d, files[0]), canDropHere)}
        className={cn("px-4 py-3 border-b border-border/70 last:border-0 transition-colors",
          dropOn === d.Id && "bg-primary/10 ring-2 ring-inset ring-primary/40",
          d.Status === "Verified" && "bg-emerald-500/[0.03]", d.Status === "Rejected" && "bg-rose-500/[0.04]")}>
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => file && setReviewId(d.Id)} disabled={!file} title={file ? "Open in the reviewer" : undefined}
            className="mt-0.5 w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0 enabled:hover:ring-2 enabled:hover:ring-primary/40">
            {mimeIcon(d.MimeType)}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => file && setReviewId(d.Id)} disabled={!file} className="font-semibold text-sm text-left enabled:hover:text-primary">{docName(d)}</button>
              <GridStatusPill status={d.Status} />
              {d.VersionNo > 1 && <span className="text-[0.6875rem] text-muted-foreground">v{d.VersionNo}</span>}
              {p.extraTag?.(d)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{p.nextStep?.(d) ?? docNextStep(d)}</p>
            {file && d.FileName && <p className="text-xs text-muted-foreground/80 truncate mt-0.5 tabular-nums">{d.FileName}{d.FileSize ? ` · ${fmtBytes(d.FileSize)}` : ""}</p>}
            {d.ReviewedByName && (d.Status === "Verified" || d.Status === "Rejected") && (
              <p className={cn("text-xs mt-0.5", d.Status === "Verified" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>
                {d.Status} by {d.ReviewedByName}{d.ReviewedAt ? ` · ${fmtDate(d.ReviewedAt)}` : ""}
              </p>
            )}
            {d.Status === "Rejected" && d.Remarks && (
              <p className="text-xs text-destructive mt-1.5 rounded-md px-2 py-1.5 bg-destructive/5 border border-destructive/30">"{d.Remarks}"</p>
            )}
            {rejecting === d.Id && (
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") rejectOne(d); if (e.key === "Escape") setRejecting(null); }}
                  placeholder="What is wrong? The uploader sees this." aria-label="Reason for rejecting"
                  className="flex-1 h-9 px-2.5 text-sm rounded-md border border-destructive/40 bg-card outline-none focus:ring-2 focus:ring-destructive/20" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => rejectOne(d)} disabled={busy === d.Id || !reason.trim()} className={cn(GRID_BTN_BRAND, "bg-destructive border-destructive hover:bg-destructive/90")}>{busy === d.Id ? "Rejecting…" : "Reject"}</button>
                  <button type="button" onClick={() => { setRejecting(null); setReason(""); }} className={GRID_BTN}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
            {file && <button type="button" onClick={() => setReviewId(d.Id)} className={cn(waitingReview && canReview.ok ? GRID_BTN_BRAND : GRID_BTN, "h-7 px-2.5")}>
              <Eye size={12} /> {waitingReview && canReview.ok ? "Review & verify" : "Open"}
            </button>}
            {file && <button type="button" onClick={() => downloadFile(p.fileUrl(d), d.FileName || d.DocumentType || "document").catch((e) => toast.error(translateError(e.message)))}
              className={cn(GRID_BTN, "h-7 w-7 px-0")} aria-label="Download" title="Download"><Download size={12} /></button>}
            {canDropHere && (
              <FilePicker onFiles={(files) => attachTo(d, files[0])} busy={busy === d.Id} label={d.Status === "Rejected" ? "Re-attach" : "Attach"}
                className={cn(GRID_BTN_BRAND, "h-7 px-2.5")} />
            )}
            {p.rowActions?.(d)}
            {!!attach && needsFile && !canAttach.ok && <span className="text-[0.6875rem] text-muted-foreground max-w-[12rem] text-right">{canAttach.reason}</span>}
            {waitingReview && canReview.ok && rejecting !== d.Id && (
              <button type="button" onClick={() => { setRejecting(d.Id); setReason(""); }} className={cn(GRID_BTN, "h-7 px-2.5 text-destructive hover:bg-destructive/5")}>Reject</button>
            )}
          </div>
        </div>
        {canDropHere && dropOn === d.Id && <p className="mt-2 text-center text-xs font-semibold text-primary">Drop to attach to {docName(d)}</p>}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {/* Where the papers stand, and the keys that move many at once. */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-3">
          <GridProgress done={uploadedReq} total={required.length} empty="None asked yet" title={`${uploadedReq} of ${required.length} required papers uploaded`} />
          <span className="text-xs text-muted-foreground">uploaded</span>
        </div>
        <div className="flex items-center gap-3">
          <GridProgress done={verifiedReq} total={required.length} empty="—" title={`${verifiedReq} of ${required.length} required papers verified`} />
          <span className="text-xs text-muted-foreground">verified</span>
        </div>
        <span className={cn("text-xs font-semibold", waiting.length ? "text-primary" : "text-muted-foreground")}>{waiting.length} waiting for review</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {p.headerActions}
          {waiting.length > 0 && (
            <button type="button" onClick={() => setReviewId(waiting[0].Id)} className={GRID_BTN_BRAND}>
              <Eye size={13} /> {waiting.length > 1 ? `Review all waiting (${waiting.length})` : "Review waiting paper"}
            </button>
          )}
        </div>
        {!canReview.ok && waiting.length > 0 && <p className="w-full text-[0.6875rem] text-muted-foreground">{canReview.reason}</p>}
      </div>

      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <header className="px-4 h-11 flex items-center justify-between border-b border-border">
          <h3 className="text-[0.8125rem] font-bold">{p.requiredTitle ?? "Required papers"}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">{verifiedReq}/{required.length} verified</span>
        </header>
        {required.length === 0 ? <div className="px-4 py-4">{p.emptyRequired ?? <p className="text-xs text-muted-foreground">No required paper asked for yet.</p>}</div> : <ul>{required.map(row)}</ul>}
      </section>

      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <header className="px-4 h-11 flex items-center justify-between border-b border-border">
          <h3 className="text-[0.8125rem] font-bold">Supporting papers</h3>
          <span className="text-xs text-muted-foreground tabular-nums">{supporting.length}</span>
        </header>
        {supporting.length > 0 && <ul>{supporting.map(row)}</ul>}
        {upload && (
          <div {...dropProps("new", uploadNew, canAttach.ok)}
            className={cn("m-3 rounded-lg border-2 border-dashed px-4 py-4 transition-colors", dropOn === "new" ? "border-primary bg-primary/5" : "border-border")}>
            {!canAttach.ok ? <p className="text-xs text-muted-foreground text-center">{canAttach.reason}</p> : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-[14rem]">
                  <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><Upload size={18} /></span>
                  <div>
                    <p className="text-sm font-semibold">Drop files here, or add them from the device or camera</p>
                    <p className="text-xs text-muted-foreground">Several at once. Reference only: what approval checks goes through the required list.</p>
                  </div>
                </div>
                <label className="space-y-1">
                  <span className={cn("block", GRID_LABEL)}>Type</span>
                  <select value={upType} onChange={(e) => setUpType(e.target.value)} className={cn(GRID_INPUT, "w-44")}>
                    {upload.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                {upload.withLabel !== false && (
                  <label className="space-y-1">
                    <span className={cn("block", GRID_LABEL)}>Label (optional)</span>
                    <input value={upLabel} onChange={(e) => setUpLabel(e.target.value)} placeholder="e.g. Approved copy" className={cn(GRID_INPUT, "w-48")} />
                  </label>
                )}
                <FilePicker multiple onFiles={uploadNew} busy={uploading} label={uploading ? "Uploading…" : "Add papers"} />
              </div>
            )}
          </div>
        )}
      </section>

      {reviewId != null && (
        <DocReviewer {...p} startId={reviewId} onClose={() => setReviewId(null)}
          verify={(d) => verifyOne(d)} reject={async (d, why) => { await run(d.Id, async () => { await review(d, false, why); toast.success(`${docName(d)} rejected`); }); }} busyId={busy} />
      )}
    </div>
  );
}

/** The side-by-side reviewer: the paper on the left, its details, history and Verify / Reject on the right, and the
 *  list of papers to walk through. ← / → move between papers with a file; V verifies; R starts a rejection. */
function DocReviewer(p: DocCentreProps & { startId: number; onClose: () => void; verify: (d: any) => Promise<void> | void; reject: (d: any, why: string) => Promise<void>; busyId: number | null }) {
  const withFile = p.documents.filter(p.hasFile);
  const [id, setId] = useState(p.startId);
  const doc = withFile.find((d) => d.Id === id) ?? withFile[0];
  const idx = doc ? withFile.indexOf(doc) : -1;
  const [blob, setBlob] = useState<{ url: string; failed?: string } | null>(null);
  const [why, setWhy] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [hist, setHist] = useState<{ at: string; text: string; by?: string | null }[] | null>(null);
  // Verifying needs the paper's file to have been in front of the reviewer: shown here, or downloaded when its type
  // can't be shown.
  const [seen, setSeen] = useState(false);
  const reasonRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!doc) return;
    let stop = false; let made: string | null = null;
    setBlob(null); setRejecting(false); setWhy(""); setHist(null); setSeen(false);
    if (canPreview(doc)) {
      fetchFileBlob(p.fileUrl(doc)).then((b) => { if (stop) return; made = URL.createObjectURL(b); setBlob({ url: made }); setSeen(true); })
        .catch((e) => !stop && setBlob({ url: "", failed: translateError(e.message) }));
    }
    p.history?.(doc).then((h) => !stop && setHist(h)).catch(() => !stop && setHist([]));
    return () => { stop = true; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.Id, doc?.VersionNo, doc?.Status]);

  const go = (by: -1 | 1) => { const n = withFile[idx + by]; if (n) setId(n.Id); };
  const nextWaiting = () => withFile.find((d, i) => i > idx && (d.Status === "Uploaded" || d.Status === "Submitted"))
    ?? withFile.find((d) => d.Id !== doc?.Id && (d.Status === "Uploaded" || d.Status === "Submitted"));
  const waitingReview = doc && (doc.Status === "Uploaded" || doc.Status === "Submitted");
  const canAct = waitingReview && (p.canReview?.ok ?? true);
  const doVerify = async () => { if (!doc || !canAct || !seen) return; await p.verify(doc); const n = nextWaiting(); if (n) setId(n.Id); };
  const doReject = async () => { if (!doc || !why.trim()) return; await p.reject(doc, why.trim()); setRejecting(false); const n = nextWaiting(); if (n) setId(n.Id); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key.toLowerCase() === "v" && canAct) doVerify();
      else if (e.key.toLowerCase() === "r" && canAct) { setRejecting(true); setTimeout(() => reasonRef.current?.focus(), 0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) p.onClose(); }}>
      <DialogContent className="max-w-6xl w-[96vw] h-[88vh] p-0 gap-0 overflow-hidden grid grid-rows-[auto_1fr]">
        <DialogHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between gap-3 space-y-0">
          <DialogTitle className="text-sm truncate">{doc ? docName(doc) : "No paper to review"}</DialogTitle>
          <div className="flex items-center gap-2 pr-8 text-xs text-muted-foreground">
            <span className="tabular-nums">{idx + 1} of {withFile.length}</span>
            <button type="button" onClick={() => go(-1)} disabled={idx <= 0} className={cn(GRID_BTN, "h-7 w-7 px-0")} aria-label="Previous paper"><ChevronLeft size={14} /></button>
            <button type="button" onClick={() => go(1)} disabled={idx >= withFile.length - 1} className={cn(GRID_BTN, "h-7 w-7 px-0")} aria-label="Next paper"><ChevronRight size={14} /></button>
          </div>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_22rem] min-h-0">
          <div className="bg-muted/40 flex items-center justify-center min-h-0 overflow-hidden">
            {!doc ? null : !canPreview(doc) ? (
              <div className="text-center text-sm text-muted-foreground space-y-2 p-6">
                <div className="mx-auto w-12 h-12 rounded-full bg-card flex items-center justify-center">{mimeIcon(doc.MimeType)}</div>
                <p>This file type can't be shown here.</p>
                <button type="button" className={GRID_BTN} onClick={() => downloadFile(p.fileUrl(doc), doc.FileName || "document").then(() => setSeen(true)).catch((e) => toast.error(translateError(e.message)))}><Download size={13} /> Download to check it</button>
              </div>
            ) : !blob ? <Loader2 className="animate-spin text-muted-foreground" />
              : blob.failed ? <p className="text-sm text-destructive p-6">{blob.failed}</p>
              : doc.MimeType === "application/pdf" ? <iframe src={blob.url} title={docName(doc)} className="w-full h-full border-0" />
              : <img src={blob.url} alt={docName(doc)} className="max-w-full max-h-full object-contain" />}
          </div>

          <aside className="border-l border-border flex flex-col min-h-0">
            {doc && (
              <div className="p-4 space-y-3 border-b border-border">
                <div className="flex items-center gap-2 flex-wrap">
                  <GridStatusPill status={doc.Status} />
                  {doc.IsMandatory && <span className="text-[0.6875rem] font-semibold text-primary">Required</span>}
                  {doc.VersionNo > 1 && <span className="text-[0.6875rem] text-muted-foreground">Version {doc.VersionNo}</span>}
                  {p.extraTag?.(doc)}
                </div>
                <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">File</dt><dd className="truncate">{doc.FileName || "—"}{doc.FileSize ? ` · ${fmtBytes(doc.FileSize)}` : ""}</dd>
                  {doc.ReviewedByName && <><dt className="text-muted-foreground">{doc.Status === "Rejected" ? "Rejected" : "Verified"}</dt><dd>{doc.ReviewedByName}{doc.ReviewedAt ? ` · ${fmtDate(doc.ReviewedAt)}` : ""}</dd></>}

                  {doc.UploadedAt && <><dt className="text-muted-foreground">Uploaded</dt><dd className="tabular-nums">{fmtDate(doc.UploadedAt)}{doc.UploadedByType ? ` · ${doc.UploadedByType}` : ""}</dd></>}
                  {doc.IssuedBy && <><dt className="text-muted-foreground">Issued by</dt><dd>{doc.IssuedBy}</dd></>}
                </dl>
                {doc.Status === "Rejected" && doc.Remarks && <p className="text-xs text-destructive rounded-md px-2 py-1.5 bg-destructive/5 border border-destructive/30">"{doc.Remarks}"</p>}
                {canAct ? (rejecting ? (
                  <div className="space-y-2">
                    <input ref={reasonRef} value={why} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doReject(); if (e.key === "Escape") setRejecting(false); }}
                      placeholder="What is wrong? The uploader sees this." aria-label="Reason for rejecting"
                      className="w-full h-9 px-2.5 text-sm rounded-md border border-destructive/40 bg-card outline-none focus:ring-2 focus:ring-destructive/20" />
                    <div className="flex gap-2">
                      <button type="button" onClick={doReject} disabled={!why.trim() || p.busyId === doc.Id} className={cn(GRID_BTN_BRAND, "flex-1 bg-destructive border-destructive hover:bg-destructive/90")}>Reject</button>
                      <button type="button" onClick={() => setRejecting(false)} className={GRID_BTN}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" onClick={doVerify} disabled={p.busyId === doc.Id || !seen}
                      title={!seen ? (canPreview(doc) ? "The file is still loading" : "Download the file and check it first") : undefined}
                      className={cn(GRID_BTN_BRAND, "flex-1")}><Check size={13} /> Verify <kbd className="ml-1 text-[0.625rem] opacity-70">V</kbd></button>
                    <button type="button" onClick={() => { setRejecting(true); setTimeout(() => reasonRef.current?.focus(), 0); }} className={cn(GRID_BTN, "flex-1 text-destructive hover:bg-destructive/5")}>Reject <kbd className="ml-1 text-[0.625rem] opacity-70">R</kbd></button>
                  </div>
                )) : waitingReview ? <p className="text-xs text-muted-foreground">{p.canReview?.reason}</p>
                  : <p className="text-xs text-muted-foreground">{doc.Status === "Verified" ? "Verified: nothing to do." : p.nextStep?.(doc) ?? docNextStep(doc)}</p>}
                {p.extraActions?.(doc)}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <p className="px-4 pt-3 pb-1 text-[0.6875rem] font-semibold text-muted-foreground">Papers</p>
              <ul className="pb-2">
                {p.documents.map((d) => {
                  const f = p.hasFile(d);
                  return (
                    <li key={d.Id}>
                      <button type="button" disabled={!f} onClick={() => setId(d.Id)}
                        className={cn("w-full px-4 py-2 flex items-center justify-between gap-2 text-left text-xs enabled:hover:bg-muted/50 disabled:opacity-60", d.Id === doc?.Id && "bg-primary/10")}>
                        <span className="truncate">{docName(d)}{d.IsMandatory && <span className="text-primary"> *</span>}</span>
                        <GridStatusPill status={d.Status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {p.history && doc && (
                <div className="px-4 pb-4">
                  <p className="pt-2 pb-1 text-[0.6875rem] font-semibold text-muted-foreground">History of this paper</p>
                  {hist == null ? <div className="h-8 rounded bg-muted animate-pulse" /> : hist.length === 0 ? <p className="text-xs text-muted-foreground">No changes recorded.</p> : (
                    <ol className="relative ml-1 border-l border-border space-y-2">
                      {hist.map((h, k) => (
                        <li key={k} className="pl-3 relative">
                          <span className="absolute -left-[4px] top-1.5 w-2 h-2 rounded-full bg-primary" />
                          <div className="text-xs">{h.text}</div>
                          <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{fmtDate(h.at)}{h.by ? ` · ${h.by}` : ""}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
              <p className="px-4 pb-3 text-[0.6875rem] text-muted-foreground">Keys: ← → move · V verify · R reject</p>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══ File picker: device, camera, or a scan of several pages ══════════════════
// Every upload key offers the three ways papers arrive: a file from the device, a photo from the camera, or several
// pages photographed and joined into one PDF. The camera opens live in the page (any device with one); where the
// browser can't, it falls back to the phone's own camera app.
type PickMode = "photo" | "scan";
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/** The pages as one A4 PDF, each photo fitted to its page. */
async function photosToPdf(photos: Blob[], name: string): Promise<File> {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), m = 18;
  for (let i = 0; i < photos.length; i++) {
    const url = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(photos[i]); });
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const el = new Image(); el.onload = () => ok(el); el.onerror = bad; el.src = url; });
    const k = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
    const w = img.width * k, h = img.height * k;
    if (i > 0) pdf.addPage();
    pdf.addImage(url, "JPEG", (pw - w) / 2, (ph - h) / 2, w, h);
  }
  return new File([pdf.output("blob")], name, { type: "application/pdf" });
}

function CameraDialog({ mode, onClose, onDone }: { mode: PickMode; onClose: () => void; onDone: (files: File[]) => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<{ blob: Blob; url: string }[]>([]);
  const [making, setMaking] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (stop) { st.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = st;
        if (videoRef.current) { videoRef.current.srcObject = st; await videoRef.current.play().catch(() => undefined); }
        setError(null);
      } catch (e: any) {
        setError(e?.name === "NotAllowedError" ? "The camera is blocked. Allow it in the browser's site settings, or choose a file instead." : "No camera could be opened on this device.");
      }
    })();
    return () => { stop = true; };
  }, [facing]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); shots.forEach((s) => URL.revokeObjectURL(s.url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => { if (b) setShots((cur) => (mode === "photo" ? [{ blob: b, url: URL.createObjectURL(b) }] : [...cur, { blob: b, url: URL.createObjectURL(b) }])); }, "image/jpeg", 0.9);
  };
  const finish = async () => {
    if (!shots.length) return;
    setMaking(true);
    try {
      const files = mode === "scan"
        ? [await photosToPdf(shots.map((s) => s.blob), `scan-${stamp()}.pdf`)]
        : [new File([shots[0].blob], `photo-${stamp()}.jpg`, { type: "image/jpeg" })];
      onDone(files);
    } catch (e: any) { toast.error(translateError(e.message || "Could not make the file")); }
    finally { setMaking(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[96vw] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm">{mode === "scan" ? "Scan pages into one PDF" : "Take a photo"}</DialogTitle>
        </DialogHeader>
        <div className="relative bg-black aspect-video flex items-center justify-center">
          {error ? <p className="text-sm text-white/80 px-6 text-center">{error}</p>
            : mode === "photo" && shots[0] ? <img src={shots[0].url} alt="The photo taken" className="max-h-full max-w-full object-contain" />
            : <video ref={videoRef} playsInline muted className="max-h-full max-w-full" />}
          {!error && !(mode === "photo" && shots[0]) && (
            <button type="button" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
              className="absolute top-3 right-3 h-9 px-3 rounded-full bg-black/50 text-white text-xs hover:bg-black/70" title="Switch between the back and front camera">
              Switch camera
            </button>
          )}
        </div>
        {mode === "scan" && shots.length > 0 && (
          <div className="px-4 py-2 border-t border-border flex gap-2 overflow-x-auto">
            {shots.map((sh, i) => (
              <div key={sh.url} className="relative shrink-0">
                <img src={sh.url} alt={`Page ${i + 1}`} className="h-16 w-12 object-cover rounded border border-border" />
                <span className="absolute bottom-0.5 left-0.5 text-[0.625rem] bg-black/60 text-white px-1 rounded">{i + 1}</span>
                <button type="button" onClick={() => setShots((cur) => cur.filter((x) => x !== sh))} aria-label={`Remove page ${i + 1}`}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-card border border-border text-[0.625rem] leading-none">×</button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter className="px-4 py-3 border-t border-border gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground self-center">
            {mode === "scan" ? `${shots.length} page${shots.length === 1 ? "" : "s"} · they become one PDF` : shots[0] ? "Use this photo, or take it again." : "Hold the paper flat and in frame."}
          </span>
          <div className="flex gap-2">
            {mode === "photo" && shots[0] ? (
              <button type="button" onClick={() => setShots([])} className={GRID_BTN}>Retake</button>
            ) : (
              <button type="button" onClick={snap} disabled={!!error} className={GRID_BTN}><Camera size={13} /> {mode === "scan" ? "Add page" : "Take photo"}</button>
            )}
            <button type="button" onClick={finish} disabled={!shots.length || making} className={GRID_BTN_BRAND}>
              {making ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {mode === "scan" ? `Make PDF (${shots.length})` : "Use photo"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hands files to a page's own file input as if the user had picked them there, so its existing upload runs unchanged. */
function feedInput(input: HTMLInputElement, files: File[]) {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** An upload key that asks how: from the device, a camera photo, or a scan of several pages into one PDF. Give it
 *  `onFiles`, or `target` (a page's existing file input: the device choice opens it, and camera or scan results are
 *  handed to it, so that page's own upload code runs as before). */
export function FilePicker({ onFiles, target, multiple = false, disabled, busy, label, className, accept, icon = true }: {
  onFiles?: (files: File[]) => void; target?: React.RefObject<HTMLInputElement>; multiple?: boolean; disabled?: boolean; busy?: boolean;
  label: React.ReactNode; className?: string; accept?: string; icon?: boolean;
}) {
  // The menu sits on its own layer, fixed beside the key, so no card's overflow can clip it; it opens upward when
  // there isn't room below, and closes on an outside click, Escape, scroll or resize.
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const open = !!pos;
  const MENU_H = 160;
  const setOpen = (v: boolean | ((cur: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(open) : v;
    if (!next) { setPos(null); return; }
    const r = btnRef.current!.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    setPos(r.bottom + MENU_H + 8 > window.innerHeight ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  };
  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (e.type === "mousedown" && (menuRef.current?.contains(t) || btnRef.current?.contains(t))) return;
      setPos(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", esc);
    };
  }, [pos]);
  const deviceRef = React.useRef<HTMLInputElement>(null);
  const nativeCamRef = React.useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<PickMode | null>(null);
  const liveCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const deliver = (files: File[]) => {
    const list = multiple || target?.current?.multiple ? files : files.slice(0, 1);
    if (target?.current) feedInput(target.current, list); else onFiles?.(list);
  };
  const pick = (m: "device" | PickMode) => {
    setOpen(false);
    if (m === "device") (target?.current ?? deviceRef.current)?.click();
    else if (liveCamera) setCamera(m);
    else nativeCamRef.current?.click();
  };
  const take = (list: FileList | null) => { const files = Array.from(list || []); if (files.length) deliver(files); };
  return (
    <div className="relative inline-block">
      <input ref={deviceRef} type="file" className="hidden" multiple={multiple} accept={accept} onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <input ref={nativeCamRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <button ref={btnRef} type="button" onClick={() => setOpen((v) => !v)} disabled={disabled || busy} aria-haspopup="menu" aria-expanded={open} className={className ?? GRID_BTN_BRAND}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : icon ? <Upload size={12} /> : null} {label} <ChevronDown size={11} className="opacity-70" />
      </button>
      {pos && createPortal(
        <div ref={menuRef} role="menu" style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
          className="fixed z-[80] w-60 bg-card border border-border rounded-lg shadow-lg py-1 text-left">
          <button type="button" role="menuitem" onClick={() => pick("device")} className="w-full px-3 py-2 flex items-start gap-2.5 hover:bg-muted text-left">
            <FolderOpen size={15} className="mt-0.5 text-primary shrink-0" /><span><span className="block text-xs font-semibold">Choose from device</span><span className="block text-[0.6875rem] text-muted-foreground">{multiple ? "One file or several" : "A file already on this device"}</span></span>
          </button>
          <button type="button" role="menuitem" onClick={() => pick("photo")} className="w-full px-3 py-2 flex items-start gap-2.5 hover:bg-muted text-left">
            <Camera size={15} className="mt-0.5 text-primary shrink-0" /><span><span className="block text-xs font-semibold">Take a photo</span><span className="block text-[0.6875rem] text-muted-foreground">With this device's camera</span></span>
          </button>
          <button type="button" role="menuitem" onClick={() => pick("scan")} className="w-full px-3 py-2 flex items-start gap-2.5 hover:bg-muted text-left">
            <ScanLine size={15} className="mt-0.5 text-primary shrink-0" /><span><span className="block text-xs font-semibold">Scan pages into one PDF</span><span className="block text-[0.6875rem] text-muted-foreground">Photograph each page; they join into one file</span></span>
          </button>
        </div>,
        document.body,
      )}
      {camera && <CameraDialog mode={camera} onClose={() => setCamera(null)} onDone={(files) => { setCamera(null); deliver(files); }} />}
    </div>
  );
}
