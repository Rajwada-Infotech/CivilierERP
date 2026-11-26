import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { DueBadge } from "@/components/legal/DueBadge";
import { OwnershipFlowchart } from "@/components/legal/OwnershipFlowchart";
import { askLegal } from "@/components/legal/LegalAsk";
import { uploadLegalFile } from "@/api/legalMastersApi";
import {
  addActivityEntry, getActivityEntries, getEntryConfig, removeActivityEntry, updateActivityEntry,
  type ActivityEntry, type EntryConfig, type EntryField,
} from "@/api/legalVerificationApi";

const input = "h-9 w-full border border-foreground/30 bg-background px-2 text-sm focus:border-foreground focus:outline-none";
const lbl = "mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground";
const fmtDate = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const BAD = ["Unmatched", "Partly matched", "Disputed", "Mismatch", "Missing Owner", "Additional Owner", "Unable to Verify", "Partial Match", "Missing Link",
  "Discrepancy Found", "Additional Document Required", "No", "Damaged", "Case Found", "Further Investigation Required", "Missing Document", "Gap", "Not Cleared",
  "Incomplete", "Records Not Available", "Search Incomplete", "Not Available", "Issue Found"];
// "Not found in sources searched" is neutral: a negative search never proves that nothing exists.
const GOOD = ["Found", "Matched", "Exact Match", "Verified", "Report Received", "Received", "Yes", "Cleared", "Continuous", "Identified"];
const SUMMARY_KEYS = ["verification", "result", "status", "match", "continuity", "available"];

export const useEntryConfig = () => useQuery({ queryKey: ["legal-entry-config"], queryFn: getEntryConfig, staleTime: 3600_000 });

/** Label of an entry (for "previous deed" pickers and links). */
const entryName = (cfg: EntryConfig, e: ActivityEntry) => cfg.columns.slice(0, 2).map((k) => e.data[k]).filter((x) => x != null && x !== "").join(" · ") || `#${e.EntryId}`;

function Cell({ f, e, cfg, all }: { f: EntryField; e: ActivityEntry; cfg: EntryConfig; all: ActivityEntry[] }) {
  const v = e.data[f.key];
  if (v == null || v === "") return <span className="text-muted-foreground">—</span>;
  if (f.type === "file") return <LegalFileLink id={v} name={e.files[f.key] ?? f.label} />;
  // Deadlines inside entries (expected report / receipt, hearing) are highlighted until the entry is finished.
  if (f.type === "date" && /expected|hearing|due/i.test(f.key)) {
    const st = String(e.data.status ?? e.data.result ?? "");
    const done = ["Report Received", "Verified", "Received", "Cleared", "Not Cleared", "Completed", "Approved", "Rejected"].includes(st);
    return <DueBadge date={String(v)} done={done} kind={/hearing/i.test(f.key) ? "hearing" : "due"} compact />;
  }
  if (f.type === "date") return <>{fmtDate(v)}</>;
  if (f.type === "entry") { const p = all.find((x) => x.EntryId === Number(v)); return <>{p ? entryName(cfg, p) : `#${v}`}</>; }
  if (f.type === "select") return <span className={BAD.includes(String(v)) ? "font-semibold text-destructive" : GOOD.includes(String(v)) ? "font-semibold text-emerald-700" : ""}>{String(v)}</span>;
  return <>{String(v)}</>;
}

/** Form for one entry (new or existing). */
type Period = { from?: number | null; to?: number | null; years?: number | null };
function EntryForm({ cfg, entry, all, period, onCancel, onSave }: { cfg: EntryConfig; entry: ActivityEntry | null; all: ActivityEntry[]; period?: Period; onCancel: () => void; onSave: (d: Record<string, unknown>) => Promise<void> }) {
  // A new search starts with the activity's configured period (e.g. 2009–2026, or the last 30 years for courts).
  const thisYear = new Date().getFullYear();
  const defFrom = period?.from ?? (period?.years ? thisYear - period.years : null);
  const defTo = period?.to ?? (period?.years ? thisYear : null);
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(cfg.fields.map((f) => [f.key, entry?.data[f.key] != null ? String(entry.data[f.key])
    : !entry && f.key === "fromYear" && defFrom ? String(defFrom) : !entry && f.key === "toYear" && defTo ? String(defTo) : ""])));
  const [names, setNames] = useState<Record<string, string | null>>(entry?.files ?? {});
  const [busy, setBusy] = useState(false);
  const need = (f: EntryField) => !!f.required || (!!f.requireWhen && f.requireWhen.values.includes(v[f.requireWhen.field]));
  const upload = (key: string) => {
    const el = document.createElement("input");
    el.type = "file"; el.accept = "application/pdf,image/*";
    el.onchange = async () => {
      const file = el.files?.[0];
      if (!file) return;
      try { const up = await uploadLegalFile(file); setV((o) => ({ ...o, [key]: String(up.id) })); setNames((o) => ({ ...o, [key]: up.fileName })); toast.success(`${up.fileName} uploaded`); }
      catch (e) { toast.error((e as Error).message); }
    };
    el.click();
  };
  const submit = async () => {
    const missing = cfg.fields.filter((f) => !f.derived && need(f) && !v[f.key]?.trim());
    if (missing.length) { toast.error(`Fill: ${missing.map((f) => f.label).join(", ")}`); return; }
    setBusy(true);
    try { await onSave(Object.fromEntries(cfg.fields.filter((f) => !f.derived).map((f) => [f.key, v[f.key] === "" ? null : v[f.key]]))); } finally { setBusy(false); }
  };
  const others = all.filter((x) => x.EntryId !== entry?.EntryId);
  return (
    <div className="border-2 border-foreground bg-background p-3">
      <p className="mb-2 text-xs font-semibold">{entry ? `Edit ${cfg.entry.toLowerCase()}` : `New ${cfg.entry.toLowerCase()}`} <span className="font-normal text-muted-foreground">· fields marked <span className="text-destructive">*</span> are required</span></p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cfg.fields.map((f) => (
          <label key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            <span className={lbl}>{f.label}{need(f) && <span className="text-destructive"> *</span>}</span>
            {f.type === "select" ? (
              <select className={input} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}><option value="">Select…</option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
            ) : f.type === "entry" ? (
              <select className={input} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}><option value="">None (oldest / unknown)</option>{others.map((o) => <option key={o.EntryId} value={o.EntryId}>{entryName(cfg, o)}</option>)}</select>
            ) : f.derived ? (
              <span className="flex h-9 items-center border border-dashed border-foreground/30 px-2 text-sm text-muted-foreground">
                {v.areaBefore && v.area ? (Number(v.areaBefore) - Number(v.area)).toFixed(4).replace(/\.?0+$/, "") : "calculated on save"}</span>
            ) : f.type === "textarea" ? (
              <textarea rows={2} maxLength={f.max} className="w-full border border-foreground/30 bg-background p-2 text-sm" value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            ) : f.type === "file" ? (
              <span className="flex h-9 items-center gap-2 text-xs">
                {v[f.key] ? <LegalFileLink id={v[f.key]} name={names[f.key] ?? f.label} /> : <span className="text-muted-foreground">No file</span>}
                <button type="button" onClick={() => upload(f.key)} className="inline-flex items-center gap-1 underline"><Upload size={11} /> {v[f.key] ? "Replace" : "Upload"}</button>
                {v[f.key] && <button type="button" onClick={() => setV({ ...v, [f.key]: "" })} className="underline">Clear</button>}
              </span>
            ) : (
              <input className={input} value={v[f.key]} maxLength={f.max} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                type={f.type === "date" ? "date" : f.type === "int" || f.type === "decimal" ? "number" : "text"} step={f.type === "decimal" ? "any" : undefined} min={f.min} max={f.type === "int" ? f.max : undefined} />
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="h-8 border border-foreground/40 px-3 text-xs font-semibold uppercase">Cancel</button>
        <button disabled={busy} onClick={submit} className="h-8 bg-foreground px-4 text-xs font-semibold uppercase text-background disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

/** A one-line summary per activity kind: counts of the main result, and the checks that matter. */
function Summary({ code, cfg, rows }: { code: string; cfg: EntryConfig; rows: ActivityEntry[] }) {
  const key = SUMMARY_KEYS.find((k) => cfg.fields.some((f) => f.key === k && f.type === "select")) ?? cfg.fields.find((f) => f.type === "select" && f.required)?.key;
  const counts = key ? rows.reduce<Record<string, number>>((m, r) => { const k = String(r.data[key] ?? "—"); m[k] = (m[k] ?? 0) + 1; return m; }, {}) : {};
  const extra: string[] = [];
  if (code === "DEED-CHAIN" && rows.length > 1) {
    const gaps = rows.filter((r) => !r.data.previousEntryId).length - 1;
    if (gaps > 0) extra.push(`${gaps} gap${gaps === 1 ? "" : "s"} in the chain (deeds with no previous deed besides the oldest)`);
  }
  if (code === "MOUZA-MAP") {
    const has = (t: string) => rows.some((r) => r.data.sheetType === t);
    if (!has("Updated Dag Sketch")) extra.push("No updated Dag sketch yet — keep the activity On Hold until it is available");
    if (!has("Marked Map")) extra.push("Marked map not uploaded yet");
  }
  if (code === "LAND-SURVEY") {
    const off = rows.filter((r) => r.data.requiredArea != null && r.data.measuredArea != null && Number(r.data.requiredArea) !== Number(r.data.measuredArea));
    if (off.length) extra.push(`Measured area differs from required on ${off.map((r) => `Dag ${r.data.dag} (${(Number(r.data.measuredArea) - Number(r.data.requiredArea)).toFixed(3)})`).join(", ")}`);
  }
  if (code === "BANGLA-BHUMI") {
    const rsDags = new Set(rows.map((r) => r.data.rsDag));
    extra.push(`${rsDags.size} RS Dag${rsDags.size === 1 ? "" : "s"} → ${rows.filter((r) => r.data.lrDag).length} LR mapping${rows.filter((r) => r.data.lrDag).length === 1 ? "" : "s"}`);
  }
  if (!rows.length) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <b>{rows.length} {rows.length === 1 ? cfg.entry.toLowerCase() : cfg.plural.toLowerCase()}</b>
      {Object.entries(counts).map(([k, n]) => <span key={k} className={BAD.includes(k) ? "font-semibold text-destructive" : GOOD.includes(k) ? "text-emerald-700" : ""}>{k}: {n}</span>)}
      {extra.map((t) => <span key={t} className="text-amber-700">{t}</span>)}
    </div>
  );
}

/** The detail entries of one verification activity (searches, applications, mappings, deeds, maps, receipts, surveys). */
export function ActivityEntriesPanel({ activityId, code, canEdit, onChanged, title = "", period }: { activityId: number; code: string; canEdit: boolean; onChanged: () => void; title?: string; period?: Period }) {
  const qc = useQueryClient();
  const conf = useEntryConfig();
  const list = useQuery({ queryKey: ["legal-activity-entries", activityId], queryFn: () => getActivityEntries(activityId) });
  const [editing, setEditing] = useState<ActivityEntry | "new" | null>(null);
  const cfg = conf.data?.[code];
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-activity-entries", activityId] }); qc.invalidateQueries({ queryKey: ["legal-activity-history", activityId] }); onChanged(); };
  if (conf.isLoading || list.isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!cfg) return <p className="text-xs text-muted-foreground">This activity has no detail entries yet.</p>;
  if (list.error) return <p className="text-xs text-destructive">{(list.error as Error).message}</p>;
  const cols = cfg.columns.map((k) => cfg.fields.find((f) => f.key === k)!).filter(Boolean);
  const save = async (d: Record<string, unknown>) => {
    try {
      const r = editing === "new" ? await addActivityEntry(activityId, d) : await updateActivityEntry((editing as ActivityEntry).EntryId, d, (editing as ActivityEntry).UpdatedAt);
      toast.success(r.message); setEditing(null); refresh();
    } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (e: ActivityEntry) => {
    const reason = await askLegal({ title: `Remove ${cfg.entry.toLowerCase()}?`, message: "It is kept in the activity history.", input: { label: "Reason", required: true }, confirmText: "Remove" });
    if (!reason) return;
    try { toast.success((await removeActivityEntry(e.EntryId, reason, e.UpdatedAt)).message); refresh(); } catch (er) { toast.error((er as Error).message); }
  };
  return (
    <div>
      {cfg.note && <p className="mb-2 text-xs text-muted-foreground">{cfg.note}</p>}
      {code === "OWNERSHIP-FLOW" && <OwnershipFlowchart activityId={activityId} entries={rows} canEdit={canEdit} title={title || "Historical ownership flowchart"} onChanged={refresh} />}
      <Summary code={code} cfg={cfg} rows={rows} />
      {rows.length ? (
        <div className="mb-2 overflow-x-auto border border-border">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
              <tr>{cols.map((f) => <th key={f.key} className="px-2 py-1.5">{f.label}</th>)}{code === "LAND-SURVEY" && <th className="px-2 py-1.5">Difference</th>}<th className="px-2 py-1.5">By</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.EntryId} className="border-t border-border/60 align-top">
                  {cols.map((f) => <td key={f.key} className="px-2 py-1.5"><Cell f={f} e={e} cfg={cfg} all={rows} /></td>)}
                  {code === "LAND-SURVEY" && <td className="px-2 py-1.5 tabular-nums">{e.data.requiredArea != null && e.data.measuredArea != null ? (Number(e.data.measuredArea) - Number(e.data.requiredArea)).toFixed(3) : "—"}</td>}
                  <td className="px-2 py-1.5 text-muted-foreground">{e.UpdatedByName ?? e.CreatedByName ?? ""}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <button onClick={() => setEditing(e)} className="underline">{canEdit ? "Edit" : "View"}</button>
                    {canEdit && <button onClick={() => remove(e)} className="ml-2 text-destructive underline">Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="mb-2 text-xs text-muted-foreground">No {cfg.plural.toLowerCase()} yet.</p>}
      {editing ? <EntryForm key={editing === "new" ? "new" : editing.EntryId} cfg={cfg} entry={editing === "new" ? null : editing} all={rows} period={period} onCancel={() => setEditing(null)} onSave={canEdit ? save : async () => setEditing(null)} />
        : canEdit && <button onClick={() => setEditing("new")} className="h-8 border border-foreground px-3 text-xs font-semibold uppercase">+ {cfg.entry}</button>}
    </div>
  );
}
