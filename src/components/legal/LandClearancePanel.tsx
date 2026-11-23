import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { getLandClearance, saveLandClearance, type ClearanceAction, type LandClearance } from "@/api/legalLandApi";
import { uploadLegalFile } from "@/api/legalMastersApi";

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const today = () => new Date().toISOString().slice(0, 10);
// The clearance path: Application Submitted → Under Review → (Query Raised → Query Replied) → Approved, or Rejected /
// Not Applicable; an approved clearance can Expire and needs a fresh application.
const STAGES = ["Not Applied", "Application Submitted", "Under Review", "Approved"] as const;
const TONE: Record<string, string> = {
  Approved: "text-emerald-600", "Not Applicable": "text-emerald-700", Rejected: "text-destructive", Expired: "text-destructive", "Query Raised": "text-amber-600",
  "Query Replied": "text-sky-600", "Application Submitted": "text-sky-600", "Under Review": "text-sky-600", "Not Applied": "text-muted-foreground",
};
const input = "w-full border border-border bg-background px-1.5 py-1 text-xs";
const btn = "border border-foreground px-2.5 py-1 text-xs font-semibold hover:bg-primary/10 disabled:opacity-40";
const OPEN = ["Application Submitted", "Under Review", "Query Raised", "Query Replied"];

function Tracker({ c }: { c: LandClearance }) {
  const pos = c.Status === "Approved" || c.Status === "Expired" ? 3 : ["Under Review", "Query Raised", "Query Replied"].includes(c.Status) ? 2 : c.Status === "Application Submitted" || c.Status === "Rejected" ? 1 : 0;
  return (
    <ol className="flex items-center gap-1 text-[0.6875rem]">
      {STAGES.map((s, i) => {
        const label = i === 2 && c.Status.startsWith("Query") ? c.Status : i === 3 && ["Rejected", "Expired"].includes(c.Status) ? c.Status : s;
        const on = i <= pos;
        const bad = label === "Rejected" || label === "Expired";
        return (
          <li key={s} className="flex items-center gap-1">
            <span className={`px-1.5 py-0.5 ${bad ? "bg-destructive/10 text-destructive" : on ? (i === 3 ? "bg-emerald-500/10 text-emerald-700" : "bg-sky-500/10 text-sky-700") : "text-muted-foreground"}`}><b>{label}</b></span>
            {i < 3 && <span className={`h-px w-4 ${i < pos ? "bg-sky-600" : "bg-border"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

const FORM: Partial<Record<ClearanceAction, { title: string; date?: string; ref?: string; remarks: string; required?: boolean; expiry?: boolean }>> = {
  apply: { title: "Submit application", date: "Application date", ref: "Application / reference no.", remarks: "Remarks" },
  query: { title: "Query raised by the office", date: "Query date", ref: "Letter / memo no.", remarks: "What was asked (required)", required: true },
  reply: { title: "Reply to the query", date: "Reply date", ref: "Reply ref. no.", remarks: "What was replied (required)", required: true },
  approve: { title: "Clearance approved", date: "Approval date", ref: "Certificate / order no.", remarks: "Remarks", expiry: true },
  reject: { title: "Rejected", date: "Date", remarks: "Reason (required)", required: true },
  na: { title: "Not applicable", remarks: "Why it is not applicable (required)", required: true },
  expire: { title: "Expired", date: "Expired on", remarks: "Remarks" },
};

function ClearanceRow({ c, landId, canEdit, mode, onSaved }: { c: LandClearance; landId: number; canEdit: boolean; mode: "track" | "certificate"; onSaved: (items?: LandClearance[]) => void }) {
  const [open, setOpen] = useState<ClearanceAction | null>(null);
  const [f, setF] = useState({ date: today(), refNo: "", remarks: "", expiryDate: "" });
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState(false);
  const run = async (action: ClearanceAction, extra: { fileId?: number } = {}) => {
    setBusy(true);
    try {
      const r = await saveLandClearance(landId, c.Kind, { action, ...f, expiryDate: f.expiryDate || undefined, ...extra });
      toast.success(r.message); setOpen(null); onSaved(r.items);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  const attach = () => {
    const el = document.createElement("input");
    el.type = "file"; el.accept = "application/pdf,image/*";
    el.onchange = async () => {
      const file = el.files?.[0];
      if (!file) return;
      try { const up = await uploadLegalFile(file); await run("attach", { fileId: up.id }); } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    };
    el.click();
  };
  const begin = (a: ClearanceAction) => { setF({ date: today(), refNo: a === "apply" ? c.ApplicationNo ?? "" : a === "approve" ? c.CertificateNo ?? "" : "", remarks: "", expiryDate: "" }); setOpen(a); };
  const st = c.Status;
  const form = open ? FORM[open] : null;
  const expired = st === "Approved" && c.ExpiryDate && c.ExpiryDate < today();
  return (
    <div className="border-t border-border/60 px-3 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[220px]">
          <b className="text-sm">{c.Label}</b>
          <span className={`ml-2 text-xs font-semibold ${TONE[st] ?? ""}`}>{st}</span>
          {expired && <span className="ml-2 text-xs font-semibold text-destructive">past its expiry — mark expired and re-apply</span>}
          <div className="mt-0.5 space-x-3 text-xs text-muted-foreground">
            {c.AppliedOn && <span>Applied {fmt(c.AppliedOn)}{c.ApplicationNo ? ` · No. ${c.ApplicationNo}` : ""}</span>}
            {c.ObtainedOn && <span>Approved {fmt(c.ObtainedOn)}{c.CertificateNo ? ` · Cert. ${c.CertificateNo}` : ""}</span>}
            {c.ExpiryDate && <span>Valid till {fmt(c.ExpiryDate)}</span>}
            {c.Remarks && <span>“{c.Remarks}”</span>}
          </div>
        </div>
        {mode === "track" && <Tracker c={c} />}
        <div className="flex flex-wrap items-center gap-1.5">
          {c.FileId ? <LegalFileLink id={c.FileId} name={c.FileName ?? "Certificate"} /> : null}
          {canEdit && mode === "track" && <>
            {["Not Applied", "Rejected", "Expired", "Not Applicable"].includes(st) && <button className={btn} onClick={() => begin("apply")}>{st === "Not Applied" ? "Apply" : "Re-apply"}</button>}
            {st === "Not Applied" && <button className={btn} onClick={() => begin("na")}>Not applicable</button>}
            {(st === "Application Submitted" || st === "Query Replied") && <button className={btn} disabled={busy} onClick={() => run("review")}>Under review</button>}
            {["Application Submitted", "Under Review", "Query Replied"].includes(st) && <button className={`${btn} border-amber-600 text-amber-700`} onClick={() => begin("query")}>Query raised</button>}
            {st === "Query Raised" && <button className={btn} onClick={() => begin("reply")}>Reply to query</button>}
            {["Application Submitted", "Under Review", "Query Replied"].includes(st) && <button className={`${btn} border-emerald-600 text-emerald-700`} onClick={() => begin("approve")}>Approved</button>}
            {OPEN.includes(st) && <button className={`${btn} border-destructive text-destructive`} onClick={() => begin("reject")}>Rejected</button>}
            {st === "Approved" && <button className={`${btn} border-destructive text-destructive`} onClick={() => begin("expire")}>Expired</button>}
          </>}
          {canEdit && mode === "certificate" && (st === "Approved"
            ? <button className="inline-flex items-center gap-1 text-xs underline disabled:opacity-40" disabled={busy} onClick={attach}><Upload size={11} /> {c.FileId ? "Replace certificate" : "Attach certificate"}</button>
            : <span className="text-xs text-muted-foreground">Attach after it is approved</span>)}
          {(c.Events?.length ?? 0) > 0 && <button className="text-xs underline" onClick={() => setHist((x) => !x)}>{hist ? "Hide history" : `History (${c.Events!.length})`}</button>}
        </div>
      </div>
      {open && form && (
        <div className="mt-2 border border-border bg-muted/30 p-2">
          <p className="mb-1.5 text-xs font-semibold">{form.title}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_1fr_1fr_auto]">
            {form.date && <label className="text-[0.625rem] uppercase text-muted-foreground">{form.date}<input type="date" className={input} value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>}
            {form.ref && <label className="text-[0.625rem] uppercase text-muted-foreground">{form.ref}<input className={input} value={f.refNo} onChange={(e) => setF({ ...f, refNo: e.target.value })} /></label>}
            <label className={`text-[0.625rem] uppercase text-muted-foreground ${!form.ref ? "sm:col-span-2" : ""}`}>{form.remarks}<input className={input} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
            {form.expiry && <label className="text-[0.625rem] uppercase text-muted-foreground">Valid till (if any)<input type="date" className={input} value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></label>}
            <span className="flex items-end gap-1.5">
              <button className="bg-foreground px-2.5 py-1 text-xs font-semibold text-card disabled:opacity-40" disabled={busy || (form.required && !f.remarks.trim())} onClick={() => run(open)}>Save</button>
              <button className="px-2 text-xs underline" onClick={() => setOpen(null)}>Cancel</button>
            </span>
          </div>
        </div>
      )}
      {hist && (
        <ol className="mt-2 space-y-0.5 border-l-2 border-border pl-3 text-xs">
          {c.Events!.map((e, i) => (
            <li key={i}><b className={TONE[e.Status] ?? ""}>{e.Status}</b>{e.EventDate ? ` · ${fmt(e.EventDate)}` : ""}{e.RefNo ? ` · ${e.RefNo}` : ""}{e.Remarks ? ` — ${e.Remarks}` : ""}
              <span className="text-muted-foreground"> ({e.ByName ?? "—"}, {fmt(e.CreatedAt)})</span>{e.FileId ? <> · <LegalFileLink id={e.FileId} name="file" /></> : null}</li>
          ))}
        </ol>
      )}
      {c.UpdatedAt && <p className="mt-1 text-[0.6875rem] text-muted-foreground">{c.UpdatedByName ?? ""} · {fmt(c.UpdatedAt)}</p>}
    </div>
  );
}

/** LA & ULC clearance for one land. Pass `items` to render from data already loaded (Post-Registration list). */
export function LandClearancePanel({ landId, canEdit, mode = "track", items, onSaved }: { landId: number; canEdit: boolean; mode?: "track" | "certificate"; items?: LandClearance[]; onSaved?: () => void }) {
  const qc = useQueryClient();
  const key = ["legal-land-clearance", landId];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => getLandClearance(landId), enabled: landId > 0 && !items });
  const list = items ?? data?.items ?? [];
  const saved = (next?: LandClearance[]) => { if (next) qc.setQueryData(key, { items: next, statuses: data?.statuses ?? [] }); qc.invalidateQueries({ queryKey: key }); onSaved?.(); };
  if (error) return <p className="text-xs text-destructive">{(error as Error).message}</p>;
  if (!list.length) return null;
  return <div className="border border-border bg-card">{list.map((c) => <ClearanceRow key={`${c.Kind}-${c.UpdatedAt ?? ""}`} c={c} landId={landId} canEdit={canEdit} mode={mode} onSaved={saved} />)}</div>;
}
