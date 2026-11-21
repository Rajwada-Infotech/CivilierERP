import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addLegalRow, getLegalLookup, getLegalMeta, getLegalRows, updateLegalRow, uploadLegalFile, type LegalFieldMeta } from "@/api/legalMastersApi";

/** Land section → the masters its entries come from (backend landFlow.js ENTRY_SECTIONS). */
export const SECTION_MASTERS: Record<string, string[]> = {
  basic: ["land"], ownership: ["ownership-record", "inheritance", "partition", "property-restriction"], acquisition: ["ownership-event", "land-purchase"],
  records: ["land-rs-record", "land-lr-record"], legal: ["legal-case", "land-legal-record"], loans: ["mortgage"], mutation: ["mutation"],
  payments: ["payment"], tax: ["land-tax"], survey: ["valuation"], photos: ["land-photo"],
};

const input = "h-9 w-full border border-foreground/30 bg-background px-2 text-sm focus:border-foreground focus:outline-none";
const shown = (f: LegalFieldMeta) => !f.system && !f.hidden && !f.auto;

function RefSelect({ f, value, onChange }: { f: LegalFieldMeta; value: string; onChange: (v: string) => void }) {
  const { data } = useQuery({ queryKey: ["legal-lookup", f.ref], queryFn: () => getLegalLookup(f.ref!), staleTime: 300_000, enabled: !!f.ref });
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">Select…</option>
      {(data ?? []).map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

/**
 * Edit one entry of a land (or add a new one) right where it shows: the same grid as the read-only card, each field an
 * input. Save writes through the Legal master API (its rules and the registered-land lock apply).
 */
export function InlineRecordEditor({ master, id, landId, title, onDone }: { master: string; id: number | null; landId: number; title?: string; onDone: () => void }) {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["legal-meta"], queryFn: getLegalMeta, staleTime: 3600_000 });
  const rows = useQuery({ queryKey: ["legal-master", master, landId], queryFn: () => getLegalRows(master, master === "land" ? undefined : landId), enabled: id != null });
  const cfg = meta.data?.find((m) => m.key === master);
  const raw = useMemo(() => (id == null ? null : (rows.data ?? []).find((r) => Number(r[cfg?.pk ?? ""]) === id) ?? null), [rows.data, id, cfg]);
  const [v, setV] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cfg) return;
    const init: Record<string, string | boolean> = {};
    for (const f of cfg.fields) {
      const x = raw ? raw[f.name] : f.default;
      init[f.name] = f.type === "bit" ? (x === undefined ? false : !!x) : x == null ? "" : f.type === "date" ? String(x).slice(0, 10) : String(x);
    }
    if (cfg.parent && id == null) init[cfg.parent] = String(landId);
    setV(init);
  }, [cfg, raw, id, landId]);

  if (meta.isLoading || (id != null && rows.isLoading)) return <p className="p-3 text-xs text-muted-foreground">Loading…</p>;
  if (!cfg) return <p className="p-3 text-xs text-destructive">This entry cannot be edited here.</p>;
  if (id != null && !raw) return <p className="p-3 text-xs text-destructive">Entry not found.</p>;

  const set = (k: string, x: string | boolean) => setV((o) => ({ ...o, [k]: x }));
  const fields = cfg.fields.filter((f) => shown(f) && f.name !== cfg.parent);
  const save = async () => {
    const missing = fields.filter((f) => f.required && f.type !== "bit" && !String(v[f.name] ?? "").trim());
    if (missing.length) { toast.error(`Fill: ${missing.map((f) => f.label).join(", ")}`); return; }
    const payload: Record<string, unknown> = {};
    for (const f of cfg.fields) if (!f.system && !f.auto) payload[f.name] = f.type === "bit" ? !!v[f.name] : v[f.name] === "" ? null : v[f.name];
    if (cfg.parent) payload[cfg.parent] = landId;
    setBusy(true);
    try {
      const r = id == null ? await addLegalRow(master, payload) : await updateLegalRow(master, id, payload);
      toast.success(r.message || "Saved");
      ["legal-review", "legal-master", "legal-land-profile", "legal-flow"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries();
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="border-2 border-foreground bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <b>{id == null ? `New ${cfg.title}` : `Editing · ${title ?? cfg.title}`}</b>
        <span className="text-muted-foreground">Fields marked <span className="text-destructive">*</span> are required</span>
        <span className="ml-auto flex gap-2">
          <button onClick={onDone} className="h-8 border border-foreground/40 px-3 font-semibold uppercase tracking-[0.06em]">Cancel</button>
          <button disabled={busy} onClick={save} className="h-8 border border-foreground bg-foreground px-4 font-semibold uppercase tracking-[0.06em] text-background disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((f) => (
          <label key={f.name} className={`block px-1.5 py-1 ${f.type === "textarea" ? "sm:col-span-2" : ""}`}>
            <span className="mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">{f.label}{f.required && <span className="text-destructive"> *</span>}</span>
            {f.type === "ref" ? <RefSelect f={f} value={String(v[f.name] ?? "")} onChange={(x) => set(f.name, x)} />
              : f.type === "select" ? (
                <select value={String(v[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)} className={input}>
                  <option value="">Select…</option>{(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : f.type === "bit" ? <input type="checkbox" checked={!!v[f.name]} onChange={(e) => set(f.name, e.target.checked)} className="h-4 w-4" />
              : f.type === "textarea" ? <textarea value={String(v[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)} rows={2} maxLength={f.max} className="w-full border border-foreground/30 bg-background p-2 text-sm" />
              : f.type === "file" ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="truncate">{v[f.name] ? (String(raw?.[`${f.name}__label`] ?? "") || `File #${v[f.name]}`) : "No file"}</span>
                  <input type="file" accept="application/pdf,image/*" className="text-xs" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try { const up = await uploadLegalFile(file); set(f.name, String(up.id)); toast.success(`${up.fileName} uploaded`); } catch (er) { toast.error((er as Error).message); }
                  }} />
                </span>
              ) : (
                <input value={String(v[f.name] ?? "")} onChange={(e) => set(f.name, f.upper ? e.target.value.toUpperCase() : e.target.value)} maxLength={f.max}
                  type={f.type === "date" ? "date" : f.type === "int" || f.type === "decimal" ? "number" : "text"} step={f.type === "decimal" ? "any" : undefined} className={input} />
              )}
          </label>
        ))}
      </div>
    </div>
  );
}
