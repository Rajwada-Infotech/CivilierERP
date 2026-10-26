// The deed's step bar, ruled panels and steps, the deed-details block and a document row (shared by the deed's own
// documents and the registry's).
import React, { useState } from "react";
import { Check, Download, Eye, Loader2, Lock, Pencil } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { docStatusColor } from "../agreement/Timeline";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "../customers/config";
import { DeedTab, StepState, docNextStep, fmtBytes, fmtDate, mimeIcon } from "./config";

export function DeedStepper({ steps, activeTab, onStepClick }: { steps: { label: string; state: StepState; tab: DeedTab }[]; activeTab: DeedTab; onStepClick: (t: DeedTab) => void }) {
  return (
    <div className="flex items-center overflow-x-auto thin-scroll pb-1">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <button onClick={() => onStepClick(s.tab)}
            className={`flex items-center gap-1.5 shrink-0 px-2 py-1.5 hover:bg-primary/10 transition-colors ${activeTab === s.tab ? "bg-primary/10" : ""}`}>
            <span className={`w-6 h-6 flex items-center justify-center text-[0.625rem] font-bold shrink-0 border ${
              s.state === "done" ? "bg-foreground text-card border-foreground"
              : s.state === "current" ? "bg-card text-foreground border-foreground border-2"
              : "bg-card text-muted-foreground border-foreground/25"}`}>
              {s.state === "done" ? <Check size={11} /> : <span className="font-heading tabular-nums">{i + 1}</span>}
            </span>
            <span className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.08em] whitespace-nowrap leading-tight ${
              s.state === "upcoming" ? "text-muted-foreground/60" : "text-foreground"}`}>
              {s.label}
            </span>
          </button>
          {i < steps.length - 1 && (
            <div className={`w-4 h-px mx-0.5 shrink-0 ${steps[i + 1].state !== "upcoming" ? "bg-foreground" : "bg-foreground/20"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/** A ruled panel: a lettered head (with whatever sits on its right) over its content. */
export function Panel({ title, icon, right, children, className = "" }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card ${className}`} style={{ border: RULE }}>
      <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: RULE }}>
        <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5">{icon}{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

/** A square step number: filled when done, double-ruled when it's the current one. */
export function StepBox({ n, done, active, stopped }: { n: number; done: boolean; active: boolean; stopped?: boolean }) {
  return (
    <span className={`w-7 h-7 flex items-center justify-center font-heading text-[0.6875rem] font-bold tabular-nums shrink-0 ${
      stopped ? "bg-destructive text-white border border-destructive"
      : done ? "bg-foreground text-card border border-foreground"
      : active ? "bg-card text-foreground border-2 border-foreground"
      : "bg-card text-muted-foreground border border-foreground/25"}`}>
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
        {!isLast && <div className="w-px flex-1 bg-foreground/20 mt-1" />}
      </div>
      <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-5"}`}>
        <div className="flex items-start justify-between gap-2">
          <p className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em] text-foreground pt-1.5">{label}</p>
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
        {!isLast && <div className="w-px flex-1 bg-foreground/20 mt-1" />}
      </div>
      <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-5"}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em] text-foreground pt-1.5">{label}</p>
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
  ["AFS stamp duty credit", "StampDutyCredit", "number"],
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
    <Panel title="Deed details"
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
          <div className="text-sm">
            {[
              ["Deed value", detail.DeedValue ? fmtRupees(detail.DeedValue) : "—"],
              ["Stamp duty", detail.StampDuty ? fmtRupees(detail.StampDuty) : "—"],
              ["Registration fee", detail.RegistrationFee ? fmtRupees(detail.RegistrationFee) : "—"],
              ["AFS credit", detail.StampDutyCredit != null ? "− " + fmtRupees(detail.StampDutyCredit) : "—"],
              ["Deed date", fmtDate(detail.DeedDate)],
              ["Reg. deadline", fmtDate(detail.RegistrationDeadline)],
              ["Sub-Registrar office", detail.SubRegistrarOffice || "—"],
              ["Witness names", detail.WitnessNames || "—"],
            ].map(([lbl, val]) => (
              <div key={lbl} className="flex justify-between gap-3 py-1.5 last:border-0" style={{ borderBottom: RULE_SOFT }}>
                <span className={`${LBL} shrink-0`}>{lbl}</span>
                <span className="text-right text-xs font-heading tabular-nums">{val}</span>
              </div>
            ))}
            {detail.Notes && <p className="text-xs text-muted-foreground pt-2 italic">{detail.Notes}</p>}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Status of a document, as a squared tag. */
export function DocTag({ status }: { status: string }) {
  return (
    <span className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border ${docStatusColor[status] || "text-muted-foreground border-foreground/25"}`}>
      {status}
    </span>
  );
}

/** One document: its name, status, what to do next, and the keys for it. */
export function DocRow({ doc, previewing, onPreview, onDownload, attach, review, extraTag, nextStep }: {
  doc: any; previewing: boolean;
  /** What to do next, when the usual wording doesn't fit. */
  nextStep?: string;
  onPreview: () => void; onDownload: () => void;
  /** Attach / re-attach a file (shown while Requested or Rejected). */
  attach?: { onFile: (f: File) => void; disabled?: boolean; title?: string };
  /** Verify / reject (shown once Uploaded). */
  review?: { onVerify: () => void; onReject: () => void };
  extraTag?: React.ReactNode;
}) {
  const inputId = `deed-doc-${React.useId()}`;
  return (
    <div className="px-3 py-2.5 text-sm" style={{ borderBottom: RULE_SOFT }}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{mimeIcon(doc.MimeType)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="font-medium">{doc.Label || doc.DocumentType}</span>
            <DocTag status={doc.Status} />
            {extraTag}
          </div>
          <p className="text-xs text-muted-foreground">{nextStep ?? docNextStep(doc)}</p>
          {doc.HasFile && <p className="text-xs text-muted-foreground/80 truncate mt-0.5 tabular-nums">{doc.FileName} · {fmtBytes(doc.FileSize)}</p>}
          {doc.Status === "Rejected" && doc.Remarks && (
            <p className="text-xs text-destructive mt-1 px-2 py-1" style={{ border: "1px solid hsl(var(--destructive) / 0.4)" }}>"{doc.Remarks}"</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 pl-7 flex-wrap">
        {doc.HasFile && (doc.MimeType?.startsWith("image/") || doc.MimeType === "application/pdf") && (
          <button data-row-view onClick={onPreview} disabled={previewing} className={`${KEY_LINE} h-7 px-2`}>
            {previewing ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />} Preview
          </button>
        )}
        {doc.HasFile && <button onClick={onDownload} className={`${KEY_LINE} h-7 px-2`}><Download size={11} /> Download</button>}
        {attach && ["Requested", "Rejected"].includes(doc.Status) && (
          <>
            <input type="file" className="hidden" id={inputId} onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.onFile(f); e.target.value = ""; }} />
            <button onClick={() => document.getElementById(inputId)?.click()} disabled={attach.disabled} title={attach.title} className={`${KEY_INK} h-7 px-2`}>
              {doc.Status === "Rejected" ? "Re-attach file" : "Attach file"}
            </button>
          </>
        )}
        {review && doc.HasFile && doc.Status === "Uploaded" && (
          <>
            <button onClick={review.onVerify} className={`${KEY_INK} h-7 px-2`}>Verify</button>
            <button onClick={review.onReject} className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}>Reject</button>
          </>
        )}
      </div>
    </div>
  );
}
