import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { askLegal } from "@/components/legal/LegalAsk";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { uploadLegalFile } from "@/api/legalMastersApi";
import { addRecordMap, raiseDiscrepancies, deleteRecordMap, editRecordMap, getEnquiryRecords, type LandRecord, type RecordMap, type RecordType } from "@/api/legalEnquirySearchApi";

/**
 * Record mapping (Land Records Search): links the enquiry's CS, RS and LR record entries that appear to be the same
 * physical land — one-to-one, one-to-many (a Dag split) or many-to-one (Dags merged) — each link with its match status,
 * basis, remarks and evidence. Differences between linked records (holder, area, classification) are shown as alerts
 * to look into; they are never a conclusion, and a matching Dag number alone never proves the same land.
 */
const field = "h-9 w-full border border-border bg-background px-2 text-sm";
const small = "border border-border px-2 py-1 text-xs hover:bg-muted";
const TONE: Record<string, string> = {
  Matched: "bg-emerald-600/15 text-emerald-800", "Partially Matched": "bg-amber-500/15 text-amber-800", "Not Matched": "bg-muted text-muted-foreground",
  Disputed: "bg-destructive/15 text-destructive", "Requires Legal Review": "bg-sky-500/15 text-sky-800",
};
const label = (t: RecordType, r?: LandRecord) => (r ? `${t} Dag ${r.Dag} / Kh ${r.Khatian}` : `${t} record (removed)`);
const PAIRS: [RecordType, RecordType][] = [["CS", "RS"], ["RS", "LR"], ["CS", "LR"]];

export function RecordMapping({ enquiryId, canEdit }: { enquiryId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ["legal-enq-records", enquiryId], queryFn: () => getEnquiryRecords(enquiryId) });
  const [form, setForm] = useState<{ pair: number; from: string; to: string; status: string; basis: string; remarks: string; ev: { id: number; name: string } | null } | null>(null);
  const [edit, setEdit] = useState<{ id: number; status: string; basis: string; remarks: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["legal-enq-records", enquiryId] });
  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="p-4 text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>;
  const rec = (t: RecordType, id: number) => data[t].find((x) => x.Id === id);
  const total = data.CS.length + data.RS.length + data.LR.length;
  const alerts = data.maps.reduce((a, m) => a + m.differences.length, 0);

  const save = async () => {
    if (!form) return;
    const [ft, tt] = PAIRS[form.pair];
    if (!form.from || !form.to) { toast.error(`Pick the ${ft} and the ${tt} record`); return; }
    try {
      toast.success((await addRecordMap(enquiryId, { fromType: ft, fromId: Number(form.from), toType: tt, toId: Number(form.to), matchStatus: form.status,
        matchBasis: form.basis || undefined, remarks: form.remarks || undefined, evidenceFileId: form.ev?.id })).message);
      setForm(null); refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-4 p-4">
      <p className="border-l-2 border-sky-600 bg-sky-500/5 px-3 py-2 text-xs">
        Link the CS, RS and LR entries that appear to be the <b>same physical land</b>. One old Dag may split into several (one-to-many) or several may merge into one (many-to-one).
        A matching Dag number alone does not prove it is the same land — give the basis and evidence. Differences below are <b>alerts to investigate</b>, not conclusions.
      </p>

      {/* The three surveys side by side */}
      <div className="grid gap-3 md:grid-cols-3">
        {(["CS", "RS", "LR"] as RecordType[]).map((t) => (
          <div key={t} className="border border-border">
            <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider">{t} records · {data[t].length}</p>
            {data[t].length ? data[t].map((r) => (
              <div key={r.Id} className="border-b border-border/60 px-3 py-2 text-xs last:border-b-0">
                <b>Dag {r.Dag} / Kh {r.Khatian}</b> <span className="text-muted-foreground">· {r.RecordStatus}</span>
                <span className="block">{r.RecordedHolder ?? "Holder not entered"}{r.Area != null ? ` · ${r.Area} ${r.Unit ?? ""}` : ""}{r.LandClass ? ` · ${r.LandClass}` : ""}</span>
                {r.RecordYear && <span className="block text-muted-foreground">Record {r.RecordYear}{r.SourceMethod ? ` · ${r.SourceMethod}` : ""}</span>}
              </div>
            )) : <p className="px-3 py-2 text-xs text-muted-foreground">None — add them in the {t} Record tab.</p>}
          </div>
        ))}
      </div>

      {/* Links */}
      <div className="border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider">Links · {data.maps.length}{alerts ? <span className="ml-2 text-amber-700">· {alerts} difference{alerts > 1 ? "s" : ""} to check</span> : null}</p>
          {canEdit && total > 1 && !form && <button className={small} onClick={() => setForm({ pair: 1, from: "", to: "", status: "Requires Legal Review", basis: "", remarks: "", ev: null })}>+ Link records</button>}
        </div>
        {form && (() => {
          const [ft, tt] = PAIRS[form.pair];
          return (
            <div className="grid gap-2 border-b border-border bg-muted/20 p-3 sm:grid-cols-3">
              <label className="text-xs text-muted-foreground">Link
                <select className={field} value={form.pair} onChange={(e) => setForm({ ...form, pair: Number(e.target.value), from: "", to: "" })}>
                  {PAIRS.map(([a, b], i) => <option key={i} value={i}>{a} → {b}</option>)}</select></label>
              <label className="text-xs text-muted-foreground">Older ({ft})
                <select className={field} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
                  <option value="">Select…</option>{data[ft].map((r) => <option key={r.Id} value={r.Id}>Dag {r.Dag} / Kh {r.Khatian}{r.RecordedHolder ? ` · ${r.RecordedHolder}` : ""}</option>)}</select></label>
              <label className="text-xs text-muted-foreground">Newer ({tt})
                <select className={field} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
                  <option value="">Select…</option>{data[tt].map((r) => <option key={r.Id} value={r.Id}>Dag {r.Dag} / Kh {r.Khatian}{r.RecordedHolder ? ` · ${r.RecordedHolder}` : ""}</option>)}</select></label>
              <label className="text-xs text-muted-foreground">Match status
                <select className={field} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{data.matchStatuses.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="text-xs text-muted-foreground sm:col-span-2">Matching basis
                <input className={field} value={form.basis} maxLength={500} placeholder="e.g. RS record shows previous CS Dag 120; same boundaries on the map" onChange={(e) => setForm({ ...form, basis: e.target.value })} /></label>
              <label className="text-xs text-muted-foreground sm:col-span-2">Remarks<input className={field} value={form.remarks} maxLength={1000} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
              <label className="text-xs text-muted-foreground">Evidence
                {form.ev ? <span className="flex h-9 items-center gap-2 text-foreground"><span className="truncate">{form.ev.name}</span><button className="underline" onClick={() => setForm({ ...form, ev: null })}>remove</button></span>
                  : <input type="file" accept="application/pdf,image/*" className="block h-9 text-xs" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    try { const up = await uploadLegalFile(f); setForm({ ...form, ev: { id: up.id, name: up.fileName } }); } catch (err) { toast.error((err as Error).message); }
                  }} />}</label>
              <span className="flex items-end gap-2 sm:col-span-3">
                <button className="h-9 bg-foreground px-4 text-xs font-semibold text-card" onClick={save}>Save link</button>
                <button className="h-9 text-xs underline" onClick={() => setForm(null)}>Cancel</button>
              </span>
            </div>
          );
        })()}
        {data.maps.length ? data.maps.map((m: RecordMap) => (
          <div key={m.MapId} className="border-b border-border/60 px-3 py-2 text-xs last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              <b>{label(m.FromType, rec(m.FromType, m.FromId))}</b><span>→</span><b>{label(m.ToType, rec(m.ToType, m.ToId))}</b>
              {m.fromLinks > 1 && <span className="border border-border px-1.5 text-[0.625rem] uppercase">one-to-many · {m.fromLinks}</span>}
              {m.toLinks > 1 && <span className="border border-border px-1.5 text-[0.625rem] uppercase">many-to-one · {m.toLinks}</span>}
              <span className={`px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase ${TONE[m.MatchStatus] ?? ""}`}>{m.MatchStatus}</span>
              {canEdit && edit?.id !== m.MapId && (
                <span className="ml-auto flex gap-1">
                  <button className={small} onClick={() => setEdit({ id: m.MapId, status: m.MatchStatus, basis: m.MatchBasis ?? "", remarks: m.Remarks ?? "" })}>Edit</button>
                  <button className={`${small} text-destructive`} onClick={async () => {
                    if (!(await askLegal({ title: "Remove this link?", message: "It is kept in the history.", confirmText: "Remove", tone: "danger" }))) return;
                    try { toast.success((await deleteRecordMap(m.MapId)).message); refresh(); } catch (e) { toast.error((e as Error).message); }
                  }}>Remove</button>
                </span>
              )}
            </div>
            {edit?.id === m.MapId ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr_1fr_auto]">
                <select className={field} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{data.matchStatuses.map((x) => <option key={x}>{x}</option>)}</select>
                <input className={field} value={edit.basis} placeholder="Matching basis" onChange={(e) => setEdit({ ...edit, basis: e.target.value })} />
                <input className={field} value={edit.remarks} placeholder="Remarks" onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} />
                <span className="flex gap-1">
                  <button className="h-9 bg-foreground px-3 text-xs font-semibold text-card" onClick={async () => {
                    try { toast.success((await editRecordMap(m.MapId, { matchStatus: edit.status, matchBasis: edit.basis, remarks: edit.remarks })).message); setEdit(null); refresh(); } catch (e) { toast.error((e as Error).message); }
                  }}>Save</button>
                  <button className="h-9 px-2 text-xs underline" onClick={() => setEdit(null)}>Cancel</button>
                </span>
              </div>
            ) : (
              <>
                {m.MatchBasis && <p className="mt-1"><span className="text-muted-foreground">Basis:</span> {m.MatchBasis}</p>}
                {m.Remarks && <p className="text-muted-foreground">{m.Remarks}</p>}
              </>
            )}
            {m.differences.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1.5">
                {m.differences.map((d) => <span key={d.kind} className="border border-amber-500/60 bg-amber-500/10 px-1.5 py-0.5 text-amber-900 dark:text-amber-200">⚠ {d.kind}: {d.from} → {d.to}</span>)}
                {canEdit && <button className={small} title="Open these differences as discrepancies to investigate (Discrepancies tab)" onClick={async () => {
                  try { toast.success((await raiseDiscrepancies(m.MapId)).message); qc.invalidateQueries({ queryKey: ["legal-enq-summary", enquiryId] }); } catch (e) { toast.error((e as Error).message); }
                }}>Raise as discrepancy</button>}
              </p>
            )}
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">
              {m.EvidenceFileId ? <LegalFileLink id={m.EvidenceFileId} name={m.EvidenceFileName ?? "Evidence"} /> : "No evidence attached"} · {m.ByName ?? "—"} · {new Date(m.At).toLocaleDateString("en-IN")}
            </p>
          </div>
        )) : <p className="px-3 py-2 text-xs text-muted-foreground">No links yet.</p>}
      </div>

      {data.unlinked.length > 0 && total > 1 && (
        <p className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
          <b>Not linked yet:</b> {data.unlinked.map((u) => `${u.type} Dag ${u.dag} / Kh ${u.khatian}`).join(" · ")} — a missing link does not stop the search; follow it up or record why it cannot be traced.
        </p>
      )}
    </div>
  );
}
