import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getLandReview, requestReview, type EntryRecord } from "@/api/legalFlowApi";
import { RecordCard } from "@/components/legal/LandReviewFlow";
import { TickCircle, Clock, MinusCirlce, ArrowRight, ArrowDown2, ArrowUp2, DocumentDownload } from "iconsax-react";
import { describe } from "@/components/legal/LandAmendmentPanel";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { getFlowLand, getVersionFile, type FlowChange, type FlowStage, type FlowVersion, type FlowSnapshot } from "@/api/legalFlowApi";

// Versions of a land (one full cycle ending in approval each) and the land's pipeline stepper — shared by the
// Land Workspace (land profile) and the Legal Flow Chart.

type Row = Record<string, unknown>;

// ── Formatting ───────────────────────────────────────────────────────────────
const isDateKey = (k: string) => /(Date|At|On|From|To)$/.test(k);
export function fmt(v: unknown, key = ""): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && isDateKey(key) && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(+d) ? v : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", ...(v.length > 10 && !v.endsWith("T00:00:00.000Z") ? { hour: "2-digit", minute: "2-digit" } : {}) });
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const label = (k: string) => k.replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bNo\b/, "No.").replace(/^Rs /, "RS ").replace(/^Lr /, "LR ");

// ── Building blocks ──────────────────────────────────────────────────────────
/** A titled box. With `collapsible` it has an Open / Close button and starts closed unless `defaultOpen`. */
export const Section: React.FC<{ title: string; count?: number; collapsible?: boolean; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, count, collapsible, defaultOpen, children }) => {
  const [open, setOpen] = useState(!collapsible || !!defaultOpen);
  return (
    <section className="border border-border bg-card">
      <header className={`flex items-center gap-2 px-4 py-2.5 ${open ? "border-b border-border" : ""}`}>
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em]">{title}</h3>
        {count != null && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
        {collapsible && (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="ml-auto flex h-8 items-center gap-1.5 border border-foreground/40 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] hover:border-foreground hover:bg-foreground hover:text-background">
            {open ? <ArrowUp2 size={12} /> : <ArrowDown2 size={12} />} {open ? "Close" : "Open"}
          </button>
        )}
      </header>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
};

function Fields({ row, keys }: { row: Row; keys: [string, string?][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {keys.filter(([k]) => row[k] !== undefined).map(([k, l]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[0.6875rem] uppercase tracking-[0.1em] text-muted-foreground">{l ?? label(k)}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium">{fmt(row[k], k)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ rows, cols, empty }: { rows: Row[]; cols: [string, string][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[0.6875rem] uppercase tracking-[0.1em] text-muted-foreground">{cols.map(([, l]) => <th key={l} className="py-1.5 pr-4 font-semibold">{l}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border/60 align-top">{cols.map(([k]) => <td key={k} className="py-2 pr-4">{fmt(r[k], k)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const STATE_STYLE: Record<FlowStage["state"], { ring: string; text: string; Icon: React.ElementType; word: string }> = {
  done: { ring: "border-emerald-600 bg-emerald-600 text-white", text: "text-emerald-700 dark:text-emerald-400", Icon: TickCircle, word: "Done" },
  current: { ring: "border-amber-500 bg-amber-500 text-white", text: "text-amber-700 dark:text-amber-400", Icon: Clock, word: "In progress" },
  pending: { ring: "border-border bg-background text-muted-foreground", text: "text-muted-foreground", Icon: Clock, word: "Not yet" },
  skipped: { ring: "border-border bg-muted text-muted-foreground", text: "text-muted-foreground", Icon: MinusCirlce, word: "Not used" },
};

/** Field-by-field difference between the before and after of one change. */
function diff(oldV: unknown, newV: unknown): { key: string; from: unknown; to: unknown }[] {
  const o = oldV && typeof oldV === "object" ? (oldV as Row) : {};
  const n = newV && typeof newV === "object" ? (newV as Row) : {};
  if (typeof oldV !== "object" && typeof newV !== "object") return oldV === newV ? [] : [{ key: "Value", from: oldV, to: newV }];
  return Array.from(new Set([...Object.keys(o), ...Object.keys(n)]))
    .filter((k) => JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null))
    .map((k) => ({ key: k, from: o[k], to: n[k] }));
}

/** Every recorded change, oldest first, numbered as versions of the land. */
function VersionHistory({ items }: { items: FlowChange[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No versions yet. Every New, edit, verification and stage move made from now on is listed here.</p>;
  return (
    <ol className="relative space-y-4 border-l-2 border-border pl-5">
      {items.map((c, i) => {
        const d = diff(c.OldValue, c.NewValue);
        return (
          <li key={c.EventId} className="relative">
            <span className="absolute -left-[1.85rem] top-0.5 flex h-6 min-w-6 items-center justify-center border border-foreground bg-background px-1 text-[0.625rem] font-semibold tabular-nums">{i + 1}</span>
            <div className="border border-border bg-card p-3">
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <b>{c.Action.replace(/_/g, " ")}</b>
                {c.baseline && <span className="border border-foreground/40 px-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em]">Original</span>}
                <span className="text-muted-foreground">· {label(c.EntityType)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{fmt(c.CreatedAt, "At")} · {c.UserName ?? "System"}</span>
              </p>
              {c.Remarks && <p className="mt-1 text-xs text-muted-foreground">{c.Remarks}</p>}
              {d.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left uppercase tracking-[0.08em] text-muted-foreground"><th className="py-1 pr-3 font-semibold">Field</th><th className="py-1 pr-3 font-semibold">Before</th><th className="py-1 font-semibold">After</th></tr></thead>
                    <tbody>{d.slice(0, 40).map((x) => (
                      <tr key={x.key} className="border-t border-border/60 align-top">
                        <td className="py-1 pr-3 font-medium">{label(x.key)}</td>
                        <td className="py-1 pr-3 text-destructive line-through decoration-destructive/40">{fmt(x.from, x.key)}</td>
                        <td className="py-1 text-emerald-700 dark:text-emerald-400">{fmt(x.to, x.key)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Rows of a record list as comparable text, for added / removed between two versions. */
const rowKey = (r: Row) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
const rowText = (r: Row) => Object.entries(r).filter(([k]) => !/Id$/.test(k)).slice(0, 6).map(([k, v]) => `${label(k)}: ${fmt(v, k)}`).join(" · ");

/** What differs between two saved versions of the land: changed fields and added / removed records. */
function VersionDiff({ prev, cur }: { prev: FlowSnapshot; cur: FlowSnapshot }) {
  const fields = diff(prev.land, cur.land);
  const lists: [keyof FlowSnapshot, string][] = [["rsRecords", "RS record"], ["lrRecords", "LR record"], ["owners", "Owner"], ["documents", "Document"], ["clearances", "Clearance"], ["mutations", "Mutation"]];
  const recs = lists.flatMap(([k, name]) => {
    const a = (prev[k] as Row[]) ?? [], b = (cur[k] as Row[]) ?? [];
    const ak = new Set(a.map(rowKey)), bk = new Set(b.map(rowKey));
    return [...b.filter((r) => !ak.has(rowKey(r))).map((r) => ({ kind: "Added", name, r })), ...a.filter((r) => !bk.has(rowKey(r))).map((r) => ({ kind: "Removed", name, r }))];
  });
  if (!fields.length && !recs.length) return <p className="text-sm text-muted-foreground">No difference in the land's details from the previous version.</p>;
  return (
    <div className="space-y-3">
      {fields.length > 0 && (
        <table className="w-full text-xs">
          <thead><tr className="text-left uppercase tracking-[0.08em] text-muted-foreground"><th className="py-1 pr-3 font-semibold">Field</th><th className="py-1 pr-3 font-semibold">Previous version</th><th className="py-1 font-semibold">This version</th></tr></thead>
          <tbody>{fields.map((x) => (
            <tr key={x.key} className="border-t border-border/60 align-top">
              <td className="py-1 pr-3 font-medium">{label(x.key)}</td>
              <td className="py-1 pr-3 text-destructive line-through decoration-destructive/40">{fmt(x.from, x.key)}</td>
              <td className="py-1 text-emerald-700 dark:text-emerald-400">{fmt(x.to, x.key)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {recs.length > 0 && (
        <ul className="space-y-1 text-xs">
          {recs.map((x, i) => <li key={i}><b className={x.kind === "Added" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{x.kind} {x.name}</b> — {rowText(x.r)}</li>)}
        </ul>
      )}
    </div>
  );
}

const tabCls = (on: boolean) => `h-9 border-b-2 px-3 text-xs font-semibold uppercase tracking-[0.1em] ${on ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;

async function downloadVersion(landId: number, no: number, kind: "pdf" | "zip", code: string) {
  const blob = await getVersionFile(landId, no, kind);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${code.replace(/[\\/:*?"<>|]+/g, "-")} - Version ${no}.${kind}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Documents of one version: pending = checklist items still missing or waiting for review. */
const docPending = (v: FlowVersion) => (v.checklist?.items ?? []).filter((i) => i.state === "Missing" || i.state === "Pending" || i.state === "Rejected");
const STATE_CLS: Record<string, string> = {
  Verified: "text-emerald-700 dark:text-emerald-400", Pending: "text-amber-700 dark:text-amber-400", Missing: "text-destructive font-semibold",
  Rejected: "text-destructive font-semibold", "Not Applicable": "text-muted-foreground",
};

function VersionDocuments({ v }: { v: FlowVersion }) {
  const up = v.uploads ?? [];
  const items = v.checklist?.items ?? [];
  const pend = docPending(v);
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Uploaded in version {v.no} <span className="tabular-nums">({up.length})</span></p>
        {up.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-[0.6875rem] uppercase tracking-[0.08em] text-muted-foreground"><th className="py-1 pr-3 font-semibold">Document</th><th className="py-1 pr-3 font-semibold">Type</th><th className="py-1 pr-3 font-semibold">File version</th><th className="py-1 pr-3 font-semibold">Uploaded</th><th className="py-1 font-semibold">Review</th></tr></thead>
            <tbody>{up.map((d) => (
              <tr key={`${d.DocumentCode}-${d.VersionNo}`} className="border-t border-border/60">
                <td className="py-1.5 pr-3"><b className="font-mono text-xs">{d.DocumentCode}</b> {d.Title}
                  {d.FileId ? <span className="mt-1 block"><LegalFileLink id={d.FileId} name={d.FileName ?? d.Title ?? d.DocumentCode} /></span>
                    : d.FileName ? <span className="block text-xs text-muted-foreground">{d.FileName}</span> : null}</td>
                <td className="py-1.5 pr-3">{d.DocTypeName ?? "—"}</td>
                <td className="py-1.5 pr-3 tabular-nums">v{d.VersionNo}{d.VersionNo > 1 ? <span className="text-xs text-muted-foreground"> (new file)</span> : null}</td>
                <td className="py-1.5 pr-3 text-xs">{d.UploadedAt ? fmt(d.UploadedAt, "At") : "—"}{d.UploadedBy ? ` · ${d.UploadedBy}` : ""}</td>
                <td className={`py-1.5 ${STATE_CLS[d.ReviewStatus ?? ""] ?? ""}`}>{d.ReviewStatus ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="text-sm text-muted-foreground">No document was uploaded in this version.</p>}
      </div>
      <div>
        <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Document checklist{v.checklist?.template ? ` · ${v.checklist.template}` : ""} — <span className={pend.length ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}>{pend.length ? `${pend.length} pending` : "nothing pending"}</span>
        </p>
        {v.checklistNow && v.approvedAt && <p className="mb-1.5 text-xs text-amber-700 dark:text-amber-400">Not saved at this version's approval — shown as it is now.</p>}
        {items.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-[0.6875rem] uppercase tracking-[0.08em] text-muted-foreground"><th className="py-1 pr-3 font-semibold">Document</th><th className="py-1 pr-3 font-semibold">Needed</th><th className="py-1 pr-3 font-semibold">Stage</th><th className="py-1 font-semibold">State</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.doc} className="border-t border-border/60">
                <td className="py-1.5 pr-3">{i.doc}</td><td className="py-1.5 pr-3">{i.requirement}</td><td className="py-1.5 pr-3">{i.stage ?? "—"}</td>
                <td className={`py-1.5 ${STATE_CLS[i.state] ?? ""}`}>{i.state === "Pending" ? "Waiting for review" : i.state}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="text-sm text-muted-foreground">No document checklist is set for this land, so nothing is marked pending.</p>}
      </div>
    </div>
  );
}

/** What is still not done in a version: its own steps, pending documents, and — for the latest one — the land's
 *  remaining pipeline stages (LA & ULC, registration, mutation …). */
type Open = { what: string; state: string; note?: string | null };
function incomplete(v: FlowVersion, latest: boolean, stages?: FlowStage[]): Open[] {
  const out: Open[] = [];
  v.flow.filter((f) => f.state === "current" || f.state === "pending").forEach((f) => out.push({ what: f.label, state: f.state === "current" ? "In progress" : "Not started", note: "Step of this version" }));
  docPending(v).forEach((d) => out.push({ what: `Document: ${d.doc}`, state: d.state === "Pending" ? "Waiting for review" : d.state, note: d.requirement }));
  if (latest) (stages ?? []).filter((s) => s.state === "current" || s.state === "pending").forEach((s) => out.push({ what: s.label, state: s.state === "current" ? "In progress" : "Not started", note: s.note ?? "Land pipeline" }));
  return out;
}

function VersionIncomplete({ items }: { items: Open[] }) {
  if (!items.length) return <p className="text-sm text-emerald-700 dark:text-emerald-400">Everything in this version is complete.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="text-left text-[0.6875rem] uppercase tracking-[0.08em] text-muted-foreground"><th className="py-1 pr-3 font-semibold">Not done yet</th><th className="py-1 pr-3 font-semibold">State</th><th className="py-1 font-semibold">Detail</th></tr></thead>
      <tbody>{items.map((o, i) => (
        <tr key={i} className="border-t border-border/60">
          <td className="py-1.5 pr-3 font-medium">{o.what}</td>
          <td className={`py-1.5 pr-3 ${o.state === "In progress" || o.state === "Waiting for review" ? "text-amber-700 dark:text-amber-400" : "font-semibold text-destructive"}`}>{o.state}</td>
          <td className="py-1.5 text-xs text-muted-foreground">{o.note ?? "—"}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

type EntryChange = { section: string; title: string; field: string; from: string | null; to: string | null; kind: "edit" | "new" | "removed" };
/** Field-by-field changes between two versions' entry sections (saved since the Land Flowchart review). */
function entryChanges(prev?: FlowSnapshot | null, cur?: FlowSnapshot | null): EntryChange[] | null {
  if (!prev?.entry || !cur?.entry) return null;
  const out: EntryChange[] = [];
  for (const sec of cur.entry) {
    const before = prev.entry.find((p) => p.key === sec.key)?.records ?? [];
    for (const r of sec.records) {
      const o = before.find((p) => p.master === r.master && p.id === r.id);
      if (!o) { out.push({ section: sec.label, title: r.title, field: "New entry", from: null, to: r.fields.filter((x) => x.v).slice(0, 3).map((x) => x.v).join(" · "), kind: "new" }); continue; }
      for (const fd of r.fields) {
        const was = o.fields.find((x) => x.n === fd.n)?.v ?? null;
        if ((was ?? null) !== (fd.v ?? null)) out.push({ section: sec.label, title: r.title, field: fd.l, from: was, to: fd.v, kind: "edit" });
      }
    }
    for (const o of before) if (!sec.records.some((r) => r.master === o.master && r.id === o.id))
      out.push({ section: sec.label, title: o.title, field: "Entry removed", from: o.fields.filter((x) => x.v).slice(0, 3).map((x) => x.v).join(" · "), to: null, kind: "removed" });
  }
  return out;
}
function EntryDiff({ rows }: { rows: EntryChange[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No entry changed — only the approval was repeated.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr className="text-left uppercase tracking-[0.08em] text-muted-foreground"><th className="py-1 pr-3 font-semibold">Section</th><th className="py-1 pr-3 font-semibold">Entry</th><th className="py-1 pr-3 font-semibold">Field</th><th className="py-1 pr-3 font-semibold">Before</th><th className="py-1 font-semibold">After</th></tr></thead>
      <tbody>{rows.map((c, i) => (
        <tr key={i} className={`border-t border-border/60 ${c.kind === "new" ? "bg-emerald-500/5" : c.kind === "removed" ? "bg-destructive/5" : ""}`}>
          <td className="py-1 pr-3 font-medium">{c.section}</td><td className="py-1 pr-3">{c.title}</td><td className="py-1 pr-3">{c.field}</td>
          <td className="py-1 pr-3 text-destructive line-through decoration-destructive/40">{c.from ?? "—"}</td>
          <td className="py-1 text-emerald-700 dark:text-emerald-400">{c.to ?? "—"}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
const changeCount = (v: FlowVersion, prev?: FlowVersion) => {
  const e = entryChanges(prev?.snapshot, v.snapshot);
  if (e) return e.length;
  return prev?.snapshot && v.snapshot ? diff(prev.snapshot.land, v.snapshot.land).length : null;
};

/** Changes grouped by section: "Land Tax · 1 new entry", "Basic Information · 2 fields". */
function overview(rows: EntryChange[]) {
  const by = new Map<string, { fields: number; added: number; removed: number }>();
  for (const c of rows) {
    const g = by.get(c.section) ?? { fields: 0, added: 0, removed: 0 };
    if (c.kind === "new") g.added++; else if (c.kind === "removed") g.removed++; else g.fields++;
    by.set(c.section, g);
  }
  return [...by.entries()].map(([section, g]) => ({ section, text: [g.added ? `+${g.added} new` : "", g.removed ? `−${g.removed} removed` : "", g.fields ? `${g.fields} field${g.fields === 1 ? "" : "s"} edited` : ""].filter(Boolean).join(" · ") }));
}

/**
 * History across versions as a comparison: one column per version (v1, v2, v3 …); each section is a row, its entries
 * sub-rows and their fields sub-rows under them. A cell is the field's value in that version — amber where it changed
 * from the version before, green where the entry came in, struck out where it was removed.
 */
function EntryHistory({ versions, onOpen }: { versions: FlowVersion[]; onOpen: (no: number) => void }) {
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const vs = versions.filter((v) => v.snapshot?.entry);
  if (!vs.length) return <p className="text-sm text-muted-foreground">No version of this land was saved section by section yet.</p>;
  type Ent = { key: string; title: string; fields: { n: string; l: string }[] };
  const sections: { key: string; label: string; entries: Ent[] }[] = [];
  const val: Record<number, Record<string, Record<string, { v: string | null; file?: number }>>> = {};
  for (const v of vs) {
    val[v.no] = {};
    for (const sec of v.snapshot!.entry!) {
      let S = sections.find((x) => x.key === sec.key);
      if (!S) { S = { key: sec.key, label: sec.label, entries: [] }; sections.push(S); }
      for (const r of sec.records) {
        const k = `${r.master}#${r.id}`;
        let E = S.entries.find((x) => x.key === k);
        if (!E) { E = { key: k, title: r.title, fields: [] }; S.entries.push(E); }
        val[v.no][k] = {};
        for (const f of r.fields as { n: string; l: string; v: string | null; file?: number }[]) {
          if (!E.fields.some((x) => x.n === f.n)) E.fields.push({ n: f.n, l: f.l });
          val[v.no][k][f.n] = { v: f.v ?? null, file: f.file };
        }
      }
    }
  }
  const present = (no: number, k: string) => !!val[no]?.[k];
  const cell = (no: number, k: string, n: string) => val[no]?.[k]?.[n];
  const fieldChanged = (k: string, n: string) => vs.some((v, i) => i > 0 && (present(v.no, k) !== present(vs[i - 1].no, k) || (cell(v.no, k, n)?.v ?? null) !== (cell(vs[i - 1].no, k, n)?.v ?? null)));
  const entryChanged = (E: Ent) => vs.some((v, i) => i > 0 && present(v.no, E.key) !== present(vs[i - 1].no, E.key)) || E.fields.some((f) => fieldChanged(E.key, f.n));
  const cols = vs.length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Only what changed</label>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-emerald-500/30" /> came in</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-amber-500/30" /> changed from the version before</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-destructive/20" /> removed</span>
        <span className="text-muted-foreground">“= same” — unchanged from the version before</span>
      </div>
      <div className="overflow-x-auto border border-border">
        <table className="w-full min-w-max text-xs">
          <thead className="bg-muted/60">
            <tr className="text-left uppercase tracking-[0.06em] text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/90 px-2 py-2 font-semibold">Section / entry / field</th>
              {vs.map((v) => (
                <th key={v.no} className="px-2 py-2 font-semibold">
                  <button onClick={() => onOpen(v.no)} className="border border-foreground/40 px-2 py-0.5 hover:bg-foreground hover:text-background">v{v.no}</button>
                  <span className="ml-1 normal-case tracking-normal">{v.approvedAt ? fmt(v.approvedAt, "At") : "in progress"}</span>
                  {(() => { const i = vs.indexOf(v); if (i === 0) return null;
                    const same = sections.every((S) => S.entries.every((E) => present(v.no, E.key) === present(vs[i - 1].no, E.key) && E.fields.every((f) => (cell(v.no, E.key, f.n)?.v ?? null) === (cell(vs[i - 1].no, E.key, f.n)?.v ?? null))));
                    return same ? <span className="ml-1 normal-case tracking-normal text-muted-foreground">· no change from v{vs[i - 1].no}</span> : null; })()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((S) => {
              const ents = onlyChanges ? S.entries.filter(entryChanged) : S.entries;
              if (onlyChanges && !ents.length) return null;
              const isClosed = closed[S.key];
              return (
                <React.Fragment key={S.key}>
                  <tr className="border-t-2 border-foreground/60 bg-card">
                    <td colSpan={cols + 1} className="sticky left-0 px-2 py-1.5">
                      <button onClick={() => setClosed((c) => ({ ...c, [S.key]: !c[S.key] }))} className="text-sm font-semibold">{isClosed ? "▸" : "▾"} {S.label}</button>
                      <span className="ml-2 text-muted-foreground">{ents.length} entr{ents.length === 1 ? "y" : "ies"}</span>
                    </td>
                  </tr>
                  {!isClosed && ents.map((E) => {
                    const flds = onlyChanges ? E.fields.filter((f) => fieldChanged(E.key, f.n)) : E.fields;
                    return (
                      <React.Fragment key={E.key}>
                        <tr className="border-t border-border bg-muted/30">
                          <td className="sticky left-0 bg-muted/60 py-1 pl-5 pr-2 font-semibold">{E.title}</td>
                          {vs.map((v, i) => {
                            const p = present(v.no, E.key), was = i > 0 && present(vs[i - 1].no, E.key);
                            return <td key={v.no} className={`px-2 py-1 text-[0.6875rem] font-semibold ${p && i > 0 && !was ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300" : !p && was ? "bg-destructive/15 text-destructive" : "text-muted-foreground"}`}>
                              {p ? (i > 0 && !was ? "Added" : i === 0 ? "Present" : "") : was ? "Removed" : "—"}
                            </td>;
                          })}
                        </tr>
                        {flds.map((f) => (
                          <tr key={f.n} className="border-t border-border/50">
                            <td className="sticky left-0 bg-card py-1 pl-9 pr-2 text-muted-foreground">{f.l}</td>
                            {vs.map((v, i) => {
                              const c = cell(v.no, E.key, f.n), p = present(v.no, E.key);
                              const prev = i > 0 ? cell(vs[i - 1].no, E.key, f.n) : undefined, prevP = i > 0 && present(vs[i - 1].no, E.key);
                              const tone = !p ? (prevP ? "bg-destructive/10 text-destructive line-through" : "") : i > 0 && !prevP ? "bg-emerald-500/15" : i > 0 && (prev?.v ?? null) !== (c?.v ?? null) ? "bg-amber-500/20 font-semibold" : "";
                              return (
                                <td key={v.no} className={`max-w-[16rem] px-2 py-1 align-top ${tone}`}>
                                  {!p ? (prevP ? (prev?.v ?? "—") : "")
                                    // Same as the version before: say so instead of repeating the value, so only real changes stand out.
                                    : i > 0 && prevP && (prev?.v ?? null) === (c?.v ?? null) ? <span className="text-muted-foreground/70">= same</span>
                                    : c?.file ? <LegalFileLink id={c.file} name={c.v ?? "File"} /> : c?.v ?? <span className="italic text-muted-foreground">empty</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {onlyChanges && sections.every((S) => !S.entries.some(entryChanged)) && <p className="text-sm text-muted-foreground">Nothing changed between the versions — untick “Only what changed” to see every field.</p>}
    </div>
  );
}

/** One version's sections as tiles: verified by the verifier (green tick), and how complete (blue = every field filled,
 *  amber = some fields empty, grey = nothing entered). */
function SectionTiles({ v }: { v: FlowVersion; onOpen?: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const entry = v.snapshot?.entry;
  if (!entry) return null;
  const openSec = entry.find((x) => x.key === openKey);
  const ticked = new Set(v.verifiedSections ?? []);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground">
        <span><b className="text-emerald-700">✓ Verified</b> by the verifier{v.verifiedBy ? ` (${v.verifiedBy})` : ""} — fields: <b className="text-emerald-700">✓</b> correct · <b className="text-destructive">✗</b> wrong · <b>N/A</b> not needed</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-sky-500 align-middle" />All fields filled</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-amber-500 align-middle" />Some fields empty</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-muted-foreground/40 align-middle" />Nothing entered</span>
      </div>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {entry.map((sec) => {
          const fields = sec.records.flatMap((r) => r.fields);
          const filled = fields.filter((f) => f.v != null && f.v !== "").length;
          const tone = !sec.records.length ? "border-border bg-muted/30 text-muted-foreground" : filled === fields.length ? "border-sky-500 bg-sky-500/10" : "border-amber-500 bg-amber-500/10";
          const ok = ticked.has(sec.key);
          const ds = sec.records.flatMap((r) => r.fields.map((f) => v.fieldDecisions?.[`${r.master}#${r.id}#${f.n}`]));
          const bad = ds.filter((d) => d === "bad").length, good = ds.filter((d) => d === "ok").length, na = ds.filter((d) => d === "na").length;
          return (
            <li key={sec.key}>
              <button onClick={() => setOpenKey(openKey === sec.key ? null : sec.key)} aria-expanded={openKey === sec.key}
                className={`${openKey === sec.key ? "ring-2 ring-foreground " : ""}flex w-full items-start justify-between gap-2 border-l-4 border px-2.5 py-1.5 text-left text-xs ${tone}`}>
                <span className="min-w-0">
                  <span className="block font-semibold">{sec.label}</span>
                  <span className="block opacity-80">{sec.records.length ? `${sec.records.length} entr${sec.records.length === 1 ? "y" : "ies"} · ${filled}/${fields.length} fields` : "Nothing entered"}</span>
                  {(good + bad + na) > 0 && <span className="mt-0.5 block font-semibold"><span className="text-emerald-700">✓ {good}</span> · <span className={bad ? "text-destructive" : "text-muted-foreground"}>✗ {bad}</span> · <span className="text-muted-foreground">N/A {na}</span></span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  {sec.records.length > 0 && filled === fields.length && <span className="font-bold text-sky-700 dark:text-sky-300">✓ Complete</span>}
                  {ok ? <span className={`px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-white ${bad ? "bg-destructive" : "bg-emerald-600"}`}>{bad ? `✗ ${bad} wrong` : "✓ Verified"}</span>
                    : sec.key !== "registration" && <span className="text-[0.625rem] uppercase text-muted-foreground">Not verified</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {openSec && (
        <div className="border-2 border-foreground bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <b className="text-sm">{openSec.label} — version {v.no}</b>
            <button onClick={() => setOpenKey(null)} className="text-xs underline">Close</button>
          </div>
          <div className="space-y-2 p-3">
            {openSec.records.length
              ? openSec.records.map((r) => <RecordCard key={`${r.master}-${r.id}`} r={r as EntryRecord} diff={false} decisions={v.fieldDecisions} />)
              : <p className="text-sm text-muted-foreground">Nothing entered in this section.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Every section of one version, field by field (as saved at its approval; now, for the open version). */
function VersionDetails({ v }: { v: FlowVersion }) {
  const entry = v.snapshot?.entry;
  if (!entry) return <p className="text-sm text-muted-foreground">This version was saved before section-by-section records were kept. See <b>Documents</b> and <b>Steps</b>, or download the PDF.</p>;
  return (
    <div className="space-y-4">
      {entry.map((sec) => (
        <div key={sec.key}>
          <p className="mb-1.5 flex items-baseline justify-between text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <span>{sec.label}</span><span className="normal-case tracking-normal">{sec.records.length} entr{sec.records.length === 1 ? "y" : "ies"}</span>
          </p>
          {sec.records.length
            ? <div className="space-y-2">{sec.records.map((r) => <RecordCard key={`${r.master}-${r.id}`} r={r as EntryRecord} diff={false} decisions={v.fieldDecisions} />)}</div>
            : <p className="border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Nothing entered.</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * Versions of the land: first the cards in order (Version 1 → Version 2 → …) with what changed in each; click a card
 * to open everything in that version.
 */
export function Versions({ versions, landId, code, stages }: { versions: FlowVersion[]; landId: number | null; code: string; stages?: FlowStage[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState<"changes" | "details" | "docs" | "open" | "steps">("changes");
  const openOf = (x: FlowVersion) => incomplete(x, x.no === versions.length, stages);
  const [busy, setBusy] = useState("");
  if (!versions.length) return <p className="text-sm text-muted-foreground">No versions yet.</p>;
  const v = sel ? versions.find((x) => x.no === sel) ?? null : null;
  const prev = v ? versions.find((x) => x.no === v.no - 1) : undefined;
  const changesOf = (x: FlowVersion) => entryChanges(versions.find((p) => p.no === x.no - 1)?.snapshot, x.snapshot);
  const dl = async (no: number, kind: "pdf" | "zip") => {
    if (!landId) return;
    setBusy(`${no}${kind}`);
    try { await downloadVersion(landId, no, kind, code); } catch (e) { alert((e as Error).message); } finally { setBusy(""); }
  };
  const DlBtn = ({ no, kind }: { no: number; kind: "pdf" | "zip" }) => (
    <button onClick={(e) => { e.stopPropagation(); dl(no, kind); }} disabled={!landId || !!busy} title={kind === "pdf" ? "Summary PDF of this version" : "PDF + all documents of this version"}
      className="flex h-7 items-center gap-1 border border-foreground/40 px-2 text-[0.625rem] font-semibold uppercase tracking-[0.08em] hover:border-foreground hover:bg-foreground hover:text-background disabled:opacity-40">
      <DocumentDownload size={12} /> {busy === `${no}${kind}` ? "…" : kind.toUpperCase()}
    </button>
  );
  const open = (no: number, t: typeof tab = "changes") => { setSel(sel === no && t === tab ? null : no); setTab(t); };
  const [view, setView] = useState<"versions" | "history">("versions");

  return (
    <div className="space-y-4">
      <p className="border-l-4 border-foreground bg-muted/40 px-3 py-2 text-sm">
        <b>How a version is made:</b> enter the land's details → click <b>Submit for verification</b> → a <b>Verifier</b> marks every field ✓ / ✗ / N/A in <b>Approvals → Land verification</b> and verifies with remarks → saved as the next version (a new land then goes to the <b>Approver</b> for Deed Process).
        Click a version to see everything in it.
      </p>

      <div className="flex gap-1 border-b border-border" role="tablist">
        <button className={tabCls(view === "versions")} onClick={() => setView("versions")}>Versions ({versions.length})</button>
        <button className={tabCls(view === "history")} onClick={() => setView("history")}>History — entries &amp; files by version</button>
      </div>
      {view === "history" && <EntryHistory versions={versions} onOpen={(no) => { setView("versions"); setSel(no); setTab("details"); }} />}

      {/* Version 1 → Version 2 → …, each with an overview of what changed. */}
      {view === "versions" && <ol className="flex gap-2 overflow-x-auto pb-1">
        {versions.map((x, i) => {
          const ok = !!x.approvedAt, on = x.no === sel;
          const ch = changesOf(x);
          const ov = ch ? overview(ch) : null;
          const filled = x.snapshot?.entry?.filter((sec) => sec.records.length).length;
          return (
            <React.Fragment key={x.no}>
              <li className="w-72 shrink-0">
                <div role="button" tabIndex={0} onClick={() => open(x.no)} onKeyDown={(e) => { if (e.key === "Enter") open(x.no); }}
                  className={`flex h-full cursor-pointer flex-col border-2 p-3 transition-colors ${on ? "border-foreground bg-primary/5" : ok ? "border-emerald-600/50 hover:border-emerald-600" : "border-amber-500/70 border-dashed hover:border-amber-500"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-lg">Version {x.no}</b>
                    <span className={`px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em] ${ok ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"}`}>{ok ? "Approved" : "In progress"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{ok ? `${fmt(x.approvedAt, "At")}${x.approvedBy ? ` · ${x.approvedBy}` : ""}` : x.status}</p>
                  {x.afterRegistration && <p className="mt-1 inline-block self-start bg-indigo-600 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-white">After registration{x.amendment ? ` · Amendment ${x.amendment.no}` : ""}</p>}
                  <div className="mt-2 flex-1 border-t border-border/60 pt-2 text-xs">
                    {x.amendment ? <p><b>{x.amendment.type}</b> · {x.amendment.changes.length} field{x.amendment.changes.length === 1 ? "" : "s"}</p>
                      : x.no === 1 ? <p><b>First version</b>{filled != null ? ` · ${filled} of ${x.snapshot?.entry?.length} sections filled` : ""}</p>
                      : ov ? (ov.length ? <ul className="space-y-0.5">{ov.slice(0, 4).map((o) => <li key={o.section}><b>{o.section}</b> <span className="text-muted-foreground">{o.text}</span></li>)}{ov.length > 4 && <li className="text-muted-foreground">+{ov.length - 4} more sections</li>}</ul> : <p className="text-muted-foreground">No entry changed</p>)
                      : <p className="text-muted-foreground">Changes after version {x.no - 1}</p>}
                  </div>
                  <p className="mt-2 text-xs">Documents <b>{x.uploads?.length ?? 0}</b>{docPending(x).length ? <span className="text-destructive"> · {docPending(x).length} pending</span> : ""}{openOf(x).length ? <span className="text-destructive"> · {openOf(x).length} not done</span> : ""}</p>
                  <div className="mt-2 flex items-center gap-1.5"><DlBtn no={x.no} kind="pdf" /><DlBtn no={x.no} kind="zip" /><span className="ml-auto text-xs underline">{on ? "Close" : "Open"}</span></div>
                </div>
              </li>
              {i < versions.length - 1 && <li className="flex shrink-0 items-center" aria-hidden><ArrowRight size={20} className="text-muted-foreground" /></li>}
            </React.Fragment>
          );
        })}
      </ol>}

      {/* The opened version: everything in it. */}
      {view === "versions" && v && (
        <div className="border-2 border-foreground bg-card">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
            <b className="text-lg">Version {v.no}</b>
            <span className={`text-xs font-semibold uppercase tracking-[0.1em] ${v.approvedAt ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>{v.status}</span>
            <span className="text-xs text-muted-foreground">{v.startedAt ? `Started ${fmt(v.startedAt, "At")}` : ""}{v.approvedAt ? ` · Approved ${fmt(v.approvedAt, "At")}${v.approvedBy ? ` by ${v.approvedBy}` : ""}` : ""}</span>
            <button onClick={() => setSel(null)} className="ml-auto text-xs underline">Close</button>
          </div>
          {v.amendment && (
            <div className="space-y-1 border-b border-indigo-500/40 bg-indigo-500/5 px-4 py-3 text-sm">
              <p><b>Amendment {v.amendment.no} · {v.amendment.type}</b> — applied to the registered land; no re-registration.</p>
              <p><b>Reason:</b> {v.amendment.reason}{v.amendment.referenceNo ? ` · Ref. ${v.amendment.referenceNo}` : ""}{v.amendment.requestedBy ? ` · asked by ${v.amendment.requestedBy}` : ""}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-1 border-b border-border px-2" role="tablist">
            <button className={tabCls(tab === "changes")} onClick={() => setTab("changes")}>{v.no === 1 ? "Overview" : `Changes from version ${v.no - 1}`}</button>
            <button className={tabCls(tab === "details")} onClick={() => setTab("details")}>All details</button>
            <button className={tabCls(tab === "docs")} onClick={() => setTab("docs")}>Documents ({v.uploads?.length ?? 0})</button>
            <button className={tabCls(tab === "open")} onClick={() => setTab("open")}>Not done ({openOf(v).length})</button>
            <button className={tabCls(tab === "steps")} onClick={() => setTab("steps")}>Steps &amp; history</button>
          </div>
          <div className="p-4">
            {tab === "changes" && v.amendment && (
              <table className="w-full text-xs">
                <thead><tr className="text-left uppercase tracking-[0.08em] text-muted-foreground"><th className="py-1 pr-3 font-semibold">What</th><th className="py-1 pr-3 font-semibold">Before</th><th className="py-1 font-semibold">After</th></tr></thead>
                <tbody>{v.amendment.changes.map((c, i) => (
                  <tr key={i} className="border-t border-border/60"><td className="py-1 pr-3 font-medium">{c.label}</td>
                    <td className="py-1 pr-3 text-destructive line-through decoration-destructive/40">{typeof c.from === "object" && c.from ? describe(c.from) : fmt(c.from, c.field)}</td>
                    <td className="py-1 text-emerald-700 dark:text-emerald-400">{(c as { op?: string }).op === "remove" ? "Removed" : typeof c.to === "object" && c.to ? describe(c.to) : fmt(c.to, c.field)}</td></tr>
                ))}</tbody>
              </table>
            )}
            {tab === "changes" && !v.amendment && (v.no === 1 ? (
              <div className="space-y-2 text-sm">
                <p>The <b>first version</b>: everything entered from the enquiry up to its first verification.</p>
                <SectionTiles v={v} onOpen={() => setTab("details")} />
                <button onClick={() => setTab("details")} className="text-xs underline">See all details →</button>
              </div>
            ) : (() => { const e = entryChanges(prev?.snapshot, v.snapshot); return e ? <div className="space-y-4"><SectionTiles v={v} onOpen={() => setTab("details")} /><EntryDiff rows={e} /></div> : prev?.snapshot && v.snapshot ? <VersionDiff prev={prev.snapshot} cur={v.snapshot} /> : <p className="text-sm text-muted-foreground">No saved record to compare with.</p>; })())}
            {tab === "details" && <VersionDetails v={v} />}
            {tab === "docs" && <VersionDocuments v={v} />}
            {tab === "open" && <VersionIncomplete items={openOf(v)} />}
            {tab === "steps" && (
              <div className="space-y-4">
                <ol className="flex flex-wrap items-center gap-2">
                  {v.flow.map((f, i) => {
                    const st = STATE_STYLE[f.state];
                    return (
                      <React.Fragment key={f.label}>
                        <li className={`border px-3 py-2 text-xs ${f.state === "done" ? "border-emerald-600/60" : f.state === "current" ? "border-amber-500" : "border-border"}`}>
                          <span className="flex items-center gap-1 font-semibold"><st.Icon size={12} className={st.text} /> {f.label}</span>
                          {f.date && <span className="block text-muted-foreground">{fmt(f.date, "At")}</span>}
                        </li>
                        {i < v.flow.length - 1 && <ArrowRight size={14} className="text-muted-foreground" />}
                      </React.Fragment>
                    );
                  })}
                </ol>
                <VersionHistory items={v.events} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The land's pipeline as a compact stepper: where it is now. */
export function LandStageStepper({ landId }: { landId: number }) {
  const { data } = useQuery({ queryKey: ["legal-flow", landId, null], queryFn: () => getFlowLand(landId) });
  if (!data?.stages?.length) return null;
  return (
    <ol className="flex flex-wrap items-stretch gap-1.5">
      {data.stages.map((s, i) => {
        const st = STATE_STYLE[s.state];
        return (
          <React.Fragment key={s.key}>
            <li title={s.note ?? undefined}
              className={`flex min-w-0 items-center gap-1.5 border px-2.5 py-1.5 text-xs ${s.state === "current" ? "border-amber-500 bg-amber-500/10 font-semibold" : s.state === "done" ? "border-emerald-600/50" : "border-border text-muted-foreground"}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center border text-[0.625rem] font-semibold ${st.ring}`}>{s.state === "done" ? "✓" : i + 1}</span>
              <span className="truncate">{s.label}</span>
            </li>
            {i < data.stages.length - 1 && <li aria-hidden className="flex items-center"><ArrowRight size={12} className="text-muted-foreground" /></li>}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

/** The Versions panel for one land (cards, changes, full record, steps, PDF / ZIP). */
export function LandVersionsPanel({ landId }: { landId: number }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-flow", landId, null], queryFn: () => getFlowLand(landId) });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading versions…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Could not load versions"}</p>;
  return (
    <div className="space-y-4">
      <NextVersionCard landId={landId} />
      <Versions versions={data.versions ?? []} landId={landId} code={String(data.land?.LandCode ?? "land")} stages={data.stages} />
    </div>
  );
}

/**
 * The land's next version and the one thing to do now:
 *   Draft      entries not yet sent → "Submit for verification" (data entry)
 *   Verifying  with the verifier (Approvals → Land verification)
 *   Submitted  with the Approver (Approvals → Versions)
 *   Up to date nothing new since the last version
 * A registered land is locked: it needs an approved amendment before it can be edited and sent again.
 */
export function NextVersionCard({ landId }: { landId: number }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const { data } = useQuery({ queryKey: ["legal-review", landId], queryFn: () => getLandReview(landId) });
  const send = useMutation({
    mutationFn: () => requestReview(landId, note.trim() || undefined),
    onSuccess: (r) => { toast.success(r.message); setNote(""); ["legal-review", "legal-review-queue", "legal-flow"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!data) return null;
  const changed = data.steps.filter((s) => s.changed);
  const lockedReg = data.registered && data.amendment?.Status !== "Open";
  const tone = data.status === "Up to date" ? "border-emerald-600/60 bg-emerald-500/5" : data.status === "Draft" ? "border-foreground bg-card" : "border-sky-600 bg-sky-500/5";
  const STEP = data.awaitingApproval || (!data.registered && data.status !== "Up to date") ? ["Data entry", "Verification → version", "Approval → Deed Process"] : ["Data entry", "Verification → version"];
  const at = data.status === "Draft" ? 0 : data.status === "Verifying" ? 1 : data.awaitingApproval ? 2 : STEP.length;
  return (
    <div className={`border-2 px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.1em]">
        <span className="text-muted-foreground">Version {data.versionNo}:</span>
        {STEP.map((t, i) => (
          <React.Fragment key={t}>
            <span className={`px-2 py-0.5 ${i < at ? "bg-emerald-600 text-white" : i === at ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}>{i < at ? "✓ " : ""}{t}</span>
            {i < STEP.length - 1 && <ArrowRight size={12} className="text-muted-foreground" />}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {data.awaitingApproval ? `Verified — version ${data.versionNo - 1} saved${data.lastVerifiedByName ? ` by ${data.lastVerifiedByName}` : ""}. Waiting for the Approver to send it to Deed Process.`
              : data.status === "Up to date" ? `Up to date — version ${data.versionNo - 1} is current.${lockedReg ? " Registered and locked." : " New entries or edits will start the next version."}`
              : data.status === "Draft" ? (lockedReg ? "Registered — locked. Request an amendment to change it." : `${changed.length} section${changed.length === 1 ? "" : "s"} entered or changed — not sent for verification yet`)
              : data.status === "Verifying" ? `With the verifier — sent by ${data.review?.EntrySubmittedByName ?? "data entry"}${data.review?.EntrySubmittedAt ? ` on ${fmt(data.review.EntrySubmittedAt, "At")}` : ""}`
              : `Verified by ${data.review?.SubmittedByName ?? "the verifier"} — waiting for the Approver`}
          </p>
          {data.status !== "Up to date" && !lockedReg && <p className="mt-0.5 text-xs text-muted-foreground">{changed.map((s) => s.label).join(" · ")}</p>}
          {data.returned && data.status === "Draft" && <p className="mt-1 text-sm text-destructive">Sent back by {data.returned.DecidedByName ?? "the verifier"}: <b>{data.returned.Remarks}</b> — correct it and submit again.</p>}
          {data.status === "Draft" && (data.toFix?.length ?? 0) > 0 && (
            <div className="mt-2 border border-destructive/50 bg-destructive/5 p-2">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-destructive">Fields marked ✗ by the verifier — {data.toFix!.filter((x) => !x.fixed).length} to correct</p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {data.toFix!.map((x) => (
                  <li key={x.key} className={x.fixed ? "text-emerald-700 dark:text-emerald-400" : ""}>
                    <b className={x.fixed ? "" : "text-destructive"}>{x.fixed ? "✓" : "✗"}</b> {x.section} › {x.entry} › <b>{x.field}</b>
                    <span className="text-muted-foreground"> — was “{x.was ?? "empty"}”{x.fixed ? `, now “${x.now ?? "empty"}”` : ""}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">They are outlined in red in their sections below. Correct them (Edit on the section), then Submit for verification.</p>
            </div>
          )}
          {data.amendment?.Status === "Open" && <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">Amendment {data.amendment.AmendmentNo} open — the version you submit now is the amendment.</p>}
        </div>
        {data.status === "Draft" && !lockedReg && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the verifier (optional)" className="h-9 border border-foreground/30 bg-background px-2 text-sm sm:w-64" />
            <button disabled={send.isPending} onClick={() => send.mutate()} className="h-9 border border-foreground bg-foreground px-4 text-xs font-semibold uppercase tracking-[0.08em] text-background hover:opacity-90 disabled:opacity-40">Submit for verification</button>
          </div>
        )}
      </div>
    </div>
  );
}
