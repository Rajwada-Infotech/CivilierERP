import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { getLandClearance, saveLandClearance, type ClearanceAction, type LandClearance } from "@/api/legalLandApi";
import { uploadLegalFile } from "@/api/legalMastersApi";

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const today = () => new Date().toISOString().slice(0, 10);
const STAGES = ["Not Applied", "Applied", "Under Processing", "Obtained"] as const;
const TONE: Record<string, string> = { Obtained: "text-emerald-600", Rejected: "text-destructive", Applied: "text-sky-600", "Under Processing": "text-sky-600", "Not Applied": "text-muted-foreground" };
const input = "w-full border border-border bg-background px-1.5 py-1 text-xs";
const btn = "border border-foreground px-2.5 py-1 text-xs font-semibold hover:bg-primary/10 disabled:opacity-40";

/** Stage dots: Not Applied → Applied → Under Processing → Obtained (or Rejected). */
function Tracker({ c }: { c: LandClearance }) {
  const at = c.Status === "Rejected" ? 2 : STAGES.indexOf(c.Status as (typeof STAGES)[number]);
  return (
    <ol className="flex items-center gap-1 text-[0.6875rem]">
      {STAGES.map((s, i) => {
        const label = i === 3 && c.Status === "Rejected" ? "Rejected" : s;
        const on = i <= at;
        const date = i === 1 ? c.AppliedOn : i === 3 && c.Status === "Obtained" ? c.ObtainedOn : null;
        return (
          <li key={s} className="flex items-center gap-1">
            <span className={`flex flex-col items-center px-1.5 py-0.5 ${on ? (label === "Rejected" ? "bg-destructive/10 text-destructive" : i === 3 ? "bg-emerald-500/10 text-emerald-700" : "bg-sky-500/10 text-sky-700") : label === "Rejected" ? "bg-destructive/10 text-destructive" : "text-muted-foreground"}`}>
              <b>{label}</b>{date && <span>{fmt(date)}</span>}
            </span>
            {i < 3 && <span className={`h-px w-4 ${i < at ? "bg-sky-600" : "bg-border"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** One clearance row (LA or ULC). mode "track": Apply / Obtain buttons with dates. mode "certificate": attach the copy. */
function ClearanceRow({ c, landId, canEdit, mode, onSaved }: { c: LandClearance; landId: number; canEdit: boolean; mode: "track" | "certificate"; onSaved: (items?: LandClearance[]) => void }) {
  const [open, setOpen] = useState<ClearanceAction | null>(null);
  const [f, setF] = useState({ date: today(), refNo: "", remarks: "" });
  const [busy, setBusy] = useState(false);
  const run = async (action: ClearanceAction, extra: { fileId?: number } = {}) => {
    setBusy(true);
    try {
      const r = await saveLandClearance(landId, c.Kind, { action, ...f, ...extra });
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
  const begin = (a: ClearanceAction) => { setF({ date: today(), refNo: a === "apply" ? c.ApplicationNo ?? "" : a === "obtain" ? c.CertificateNo ?? "" : "", remarks: "" }); setOpen(a); };
  const applied = ["Applied", "Under Processing"].includes(c.Status);
  return (
    <div className="border-t border-border/60 px-3 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[220px]">
          <b className="text-sm">{c.Label}</b>
          <span className={`ml-2 text-xs font-semibold ${TONE[c.Status] ?? ""}`}>{c.Status}</span>
          <div className="mt-0.5 space-x-3 text-xs text-muted-foreground">
            {c.AppliedOn && <span>Applied {fmt(c.AppliedOn)}{c.ApplicationNo ? ` · No. ${c.ApplicationNo}` : ""}</span>}
            {c.ObtainedOn && <span>Obtained {fmt(c.ObtainedOn)}{c.CertificateNo ? ` · Cert. ${c.CertificateNo}` : ""}</span>}
            {c.Remarks && <span>“{c.Remarks}”</span>}
          </div>
        </div>
        {mode === "track" && <Tracker c={c} />}
        <div className="flex flex-wrap items-center gap-1.5">
          {c.FileId ? <LegalFileLink id={c.FileId} name={c.FileName ?? "Certificate"} /> : null}
          {canEdit && mode === "track" && <>
            {(c.Status === "Not Applied" || c.Status === "Rejected") && <button className={btn} onClick={() => begin("apply")}>{c.Status === "Rejected" ? "Re-apply" : "Apply"}</button>}
            {c.Status === "Applied" && <button className={btn} disabled={busy} onClick={() => run("progress")}>Mark processing</button>}
            {applied && <button className={`${btn} border-emerald-600 text-emerald-700`} onClick={() => begin("obtain")}>Obtain</button>}
            {applied && <button className={`${btn} border-destructive text-destructive`} onClick={() => begin("reject")}>Reject</button>}
          </>}
          {canEdit && mode === "certificate" && (c.Status === "Obtained"
            ? <button className="inline-flex items-center gap-1 text-xs underline disabled:opacity-40" disabled={busy} onClick={attach}><Upload size={11} /> {c.FileId ? "Replace certificate" : "Attach certificate"}</button>
            : <span className="text-xs text-muted-foreground">Attach after it is obtained</span>)}
        </div>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-2 border border-border bg-muted/30 p-2 sm:grid-cols-[150px_1fr_1fr_auto]">
          {open !== "reject" && <input type="date" className={input} value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} />}
          {open !== "reject" && <input className={input} placeholder={open === "apply" ? "Application no." : "Certificate / order no."} value={f.refNo} onChange={(e) => setF({ ...f, refNo: e.target.value })} />}
          <input className={`${input} ${open === "reject" ? "sm:col-span-3" : ""}`} placeholder={open === "reject" ? "Reason (required)" : "Remarks"} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
          <span className="flex gap-1.5">
            <button className="bg-foreground px-2.5 py-1 text-xs font-semibold text-card disabled:opacity-40" disabled={busy} onClick={() => run(open)}>Save</button>
            <button className="px-2 text-xs underline" onClick={() => setOpen(null)}>Cancel</button>
          </span>
        </div>
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
