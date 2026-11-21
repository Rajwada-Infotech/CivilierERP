import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import {
  approveAmendment, getAmendFields, getLandAmendments, getPendingAmendments, rejectAmendment, requestAmendment, withdrawAmendment,
  type AmendCol, type AmendField, type Amendment, type CurrentRows, type SectionKey,
} from "@/api/legalAmendmentApi";
import { uploadLegalFile } from "@/api/legalMastersApi";

const btn = "flex h-9 items-center gap-1.5 border px-4 text-xs font-semibold uppercase tracking-[0.1em] disabled:opacity-40";
const ink = `${btn} border-foreground bg-foreground text-background hover:opacity-90`;
const line = `${btn} border-foreground/40 hover:border-foreground`;
const input = "h-9 w-full border border-foreground/30 bg-background px-2 text-sm";
const lbl = "text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground";
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

const SECTION_TABS: { key: "land" | SectionKey; label: string }[] = [
  { key: "land", label: "Land details" }, { key: "rs", label: "RS records" }, { key: "lr", label: "LR records" }, { key: "owner", label: "Owners" },
  { key: "document", label: "Documents" }, { key: "clearance", label: "Clearance" }, { key: "mutation", label: "Mutation" },
];
const OP_WORD = { add: "Add", edit: "Change", remove: "Remove", file: "New file for" } as const;
type Staged = { section: SectionKey; op: "add" | "edit" | "remove" | "file"; id: number | string | null; to: Record<string, unknown> | null; label: string };

/** A short line for a record (or a changed value) — "Khatian 80 · Dag 140 · Holder Nitai Sarkar". */
export function describe(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v !== "object") return String(v);
  return Object.entries(v as Record<string, unknown>)
    .filter(([k, x]) => x !== null && x !== undefined && x !== "" && !/^(FileId|DocTypeId|id)$/.test(k))
    .map(([k, x]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^Rs /, "RS ").replace(/^Lr /, "LR ")}: ${typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x) ? x.slice(0, 10) : x}`).join(" · ") || "—";
}

/** One record form (add or change): its columns, with file upload and document type picker. */
function RecordForm({ cols, initial, docTypes, onSave, onCancel }: {
  cols: AmendCol[]; initial: Record<string, unknown> | null; docTypes: { id: number; name: string }[];
  onSave: (v: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<Record<string, unknown>>(() => Object.fromEntries(cols.map((c) => {
    const x = initial?.[c.name];
    return [c.name, x == null ? "" : c.kind === "date" ? String(x).slice(0, 10) : String(x)];
  })));
  const [up, setUp] = useState("");
  const set = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x }));
  const missing = cols.filter((c) => c.required && !String(v[c.name] ?? "").trim()).map((c) => c.label);
  return (
    <div className="space-y-2 border border-foreground/40 bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {cols.map((c) => (
          <label key={c.name} className="block"><span className={lbl}>{c.label}{c.required ? " *" : ""}</span>
            {c.kind === "select" ? <select value={String(v[c.name] ?? "")} onChange={(e) => set(c.name, e.target.value)} className={input}><option value="">Choose…</option>{c.options?.map((o) => <option key={o}>{o}</option>)}</select>
              : c.kind === "doctype" ? <select value={String(v[c.name] ?? "")} onChange={(e) => { set(c.name, e.target.value); set("DocTypeName", docTypes.find((d) => String(d.id) === e.target.value)?.name ?? ""); }} className={input}><option value="">Choose…</option>{docTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              : c.kind === "file" ? (
                <span className="flex h-9 items-center gap-2 border border-foreground/30 bg-background px-2 text-xs">
                  <input type="file" className="w-full text-xs" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    setUp("Uploading…");
                    try { const r = await uploadLegalFile(f); set(c.name, String(r.id)); set("FileName", r.fileName); setUp(r.fileName); } catch (err) { setUp(""); toast.error((err as Error).message); }
                  }} />
                  {up && <span className="shrink-0 text-muted-foreground">{up}</span>}
                </span>)
              : <input type={c.kind === "number" ? "number" : c.kind === "date" ? "date" : "text"} maxLength={c.max} value={String(v[c.name] ?? "")} onChange={(e) => set(c.name, e.target.value)} className={input} />}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        {missing.length > 0 && <span className="mr-auto text-xs text-muted-foreground">Needed: {missing.join(", ")}</span>}
        <button onClick={onCancel} className={line}>Cancel</button>
        <button disabled={missing.length > 0} onClick={() => onSave(v)} className={ink}>Add to amendment</button>
      </div>
    </div>
  );
}

/** The form a user fills to ask for a change to a registered land: land fields and any record section. */
function RequestDialog({ landId, current, rows: cur, onClose }: { landId: number; current: Record<string, unknown>; rows: CurrentRows | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["legal-amend-fields"], queryFn: getAmendFields, staleTime: 3600_000 });
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [tab, setTab] = useState<"land" | SectionKey>("land");
  const [rows, setRows] = useState<{ field: string; to: string }[]>([{ field: "", to: "" }]);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [form, setForm] = useState<{ op: "add" | "edit" | "file"; id: number | string | null; initial: Record<string, unknown> | null } | null>(null);
  const fields = data?.fields ?? [];
  const fieldOf = (k: string) => fields.find((f) => f.field === k) as AmendField | undefined;
  const landChanges = rows.filter((r) => r.field);
  const total = landChanges.length + staged.length;
  const send = useMutation({
    mutationFn: () => requestAmendment(landId, { type, reason, referenceNo: ref, changes: [
      ...landChanges.map((r) => ({ section: "land", field: r.field, to: r.to })),
      ...staged.map((x) => ({ section: x.section, op: x.op, id: x.id, to: x.to })),
    ] }),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["legal-amend"] }); qc.invalidateQueries({ queryKey: ["legal-flow"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const spec = tab !== "land" ? data?.sections?.[tab] : undefined;
  const list = tab !== "land" ? cur?.[tab] ?? [] : [];
  const stagedFor = (id: number | string) => staged.find((x) => x.section === tab && String(x.id) === String(id));
  const stage = (x: Omit<Staged, "label">) => {
    const sp = data?.sections?.[x.section];
    const row = x.id != null ? cur?.[x.section]?.find((r) => String(r.id) === String(x.id)) : null;
    const name = describe(Object.fromEntries((sp?.cols ?? []).slice(0, 2).map((c) => [c.name, (x.to ?? row ?? {})[c.name] ?? (row ?? {})[c.name]])));
    setStaged((s) => [...s.filter((y) => !(y.section === x.section && y.id != null && String(y.id) === String(x.id))), { ...x, label: `${OP_WORD[x.op]} ${sp?.title.toLowerCase() ?? ""} — ${x.section === "clearance" ? `${x.id}` : name}` }]);
    setForm(null);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col border-2 border-foreground bg-background" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <p className={lbl}>Registered land</p>
            <h3 className="text-lg font-semibold">Request amendment</h3>
            <p className="mt-1 text-xs text-muted-foreground">Change any part of the registered land — its details, RS / LR records, owners, documents, clearance or mutation. Everything you add goes to the Amendment Approver together; once approved it is applied as a new after-registration version — no re-registration.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block"><span className={lbl}>Amendment type *</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className={input}><option value="">Choose…</option>{data?.types.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="block"><span className={lbl}>Order / deed / report no.</span>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. BLRO order 1452/2026" className={input} /></label>
          </div>

          <div>
            <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
              {SECTION_TABS.map((t) => {
                const n = t.key === "land" ? landChanges.length : staged.filter((x) => x.section === t.key).length;
                return (
                  <button key={t.key} onClick={() => { setTab(t.key); setForm(null); }}
                    className={`h-9 border-b-2 px-3 text-xs font-semibold uppercase tracking-[0.08em] ${tab === t.key ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                    {t.label}{n ? <span className="ml-1 bg-indigo-600 px-1.5 text-[0.625rem] text-white">{n}</span> : null}
                  </button>
                );
              })}
            </div>

            {tab === "land" && (
              <div className="mt-3 space-y-2">
                {rows.map((r, i) => {
                  const f = fieldOf(r.field);
                  const used = new Set(rows.map((x) => x.field));
                  return (
                    <div key={i} className="grid grid-cols-1 gap-2 border border-border p-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                      <label className="block"><span className={lbl}>Field</span>
                        <select value={r.field} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { field: e.target.value, to: "" } : x)))} className={input}>
                          <option value="">Choose…</option>
                          {fields.filter((x) => x.field === r.field || !used.has(x.field)).map((x) => <option key={x.field} value={x.field}>{x.label}</option>)}
                        </select></label>
                      <div><span className={lbl}>Now</span><p className="flex min-h-9 items-center border border-dashed border-border px-2 text-sm text-muted-foreground">{r.field ? show(current[r.field]) : "—"}</p></div>
                      <label className="block"><span className={lbl}>Change to</span>
                        {f?.kind === "select"
                          ? <select value={r.to} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} className={input}><option value="">(empty)</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</select>
                          : <input value={r.to} type={f?.kind === "number" ? "number" : "text"} maxLength={f?.max} disabled={!f} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} className={input} />}
                      </label>
                      <button onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ field: "", to: "" }])} className="h-9 px-2 text-destructive" aria-label="Remove"><Trash2 size={15} /></button>
                    </div>
                  );
                })}
                <button onClick={() => setRows([...rows, { field: "", to: "" }])} className={line}><Plus size={13} /> Another field</button>
              </div>
            )}

            {spec && (
              <div className="mt-3 space-y-2">
                {list.length === 0 && <p className="text-sm text-muted-foreground">No {spec.title.toLowerCase()} on this land yet.</p>}
                {list.map((r) => {
                  const st = stagedFor(r.id);
                  return (
                    <div key={String(r.id)} className={`flex flex-wrap items-center gap-2 border p-2 text-sm ${st ? "border-indigo-500 bg-indigo-500/5" : "border-border"}`}>
                      <span className="min-w-0 flex-1">{tab === "clearance" ? <b>{String(r.Kind)} </b> : null}{describe(Object.fromEntries(spec.cols.filter((c) => c.kind !== "file").map((c) => [c.name, r[c.name]])))}</span>
                      {st ? <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{OP_WORD[st.op]} — in this amendment</span> : (
                        <>
                          {spec.ops.includes("edit") && <button onClick={() => setForm({ op: "edit", id: r.id, initial: r })} className={line}>Change</button>}
                          {spec.ops.includes("file") && <button onClick={() => setForm({ op: "file", id: r.id, initial: null })} className={line}>New file</button>}
                          {spec.ops.includes("remove") && <button onClick={() => stage({ section: tab as SectionKey, op: "remove", id: r.id, to: null })} className={`${line} text-destructive`}>Remove</button>}
                        </>
                      )}
                    </div>
                  );
                })}
                {staged.filter((x) => x.section === tab && x.op === "add").map((x, i) => (
                  <div key={`add-${i}`} className="border border-indigo-500 bg-indigo-500/5 p-2 text-sm"><b className="text-indigo-700 dark:text-indigo-300">New — </b>{describe(x.to)}</div>
                ))}
                {form ? (
                  <RecordForm
                    key={`${form.op}-${form.id}`}
                    cols={form.op === "file" ? spec.cols.filter((c) => c.name === "FileId") : spec.cols}
                    initial={form.initial} docTypes={data?.docTypes ?? []}
                    onCancel={() => setForm(null)}
                    onSave={(v) => stage({ section: tab as SectionKey, op: form.op, id: form.id, to: v })} />
                ) : spec.ops.includes("add") && (
                  <button onClick={() => setForm({ op: "add", id: null, initial: null })} className={line}><Plus size={13} /> Add {spec.title.toLowerCase()}</button>
                )}
              </div>
            )}
          </div>

          {staged.length > 0 && (
            <div className="border border-indigo-500/60 p-3">
              <p className={lbl}>Record changes in this amendment</p>
              <ul className="mt-1 space-y-1 text-sm">
                {staged.map((x, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex-1">{x.label}{x.to && x.op !== "remove" ? <span className="text-xs text-muted-foreground"> → {describe(x.to)}</span> : null}</span>
                    <button onClick={() => setStaged(staged.filter((_, j) => j !== i))} className="text-destructive" aria-label="Take out"><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="block"><span className={lbl}>Reason *</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} placeholder="Why the registered details must change" className="w-full border border-foreground/30 bg-background p-2 text-sm" /></label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <span className="mr-auto text-xs text-muted-foreground">{total} change{total === 1 ? "" : "s"} in this amendment</span>
          <button onClick={onClose} className={line}>Cancel</button>
          <button onClick={() => send.mutate()} disabled={send.isPending || !type || reason.trim().length < 5 || !total} className={ink}>{send.isPending ? "Sending…" : "Send for approval"}</button>
        </div>
      </div>
    </div>
  );
}

/** One amendment waiting for a decision: the changes, and Approve / Reject (with remark) or Withdraw. */
export function AmendmentDecision({ a, canApprove, userId }: { a: Amendment; canApprove: boolean; userId?: number | null }) {
  const qc = useQueryClient();
  const [remark, setRemark] = useState("");
  const done = (m: { message: string }) => { toast.success(m.message); qc.invalidateQueries({ queryKey: ["legal-amend"] }); qc.invalidateQueries({ queryKey: ["legal-flow"] }); };
  const fail = (e: Error) => toast.error(e.message);
  const approve = useMutation({ mutationFn: () => approveAmendment(a.AmendmentId, remark), onSuccess: done, onError: fail });
  const reject = useMutation({ mutationFn: () => rejectAmendment(a.AmendmentId, remark), onSuccess: done, onError: fail });
  const withdraw = useMutation({ mutationFn: () => withdrawAmendment(a.AmendmentId), onSuccess: done, onError: fail });
  const busy = approve.isPending || reject.isPending || withdraw.isPending;
  return (
    <div className="border-2 border-indigo-500 bg-indigo-500/5 p-4">
      <p className="flex flex-wrap items-center gap-2">
        <span className="bg-indigo-600 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-white">After registration</span>
        <b>Amendment {a.AmendmentNo} · {a.AmendType}</b>
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-amber-700 dark:text-amber-400">Waiting for approval</span>
        <span className="ml-auto text-xs text-muted-foreground">{a.LandCode} · asked by {a.RequestedByName ?? "—"} · {when(a.RequestedAt)}</span>
      </p>
      <p className="mt-2 text-sm"><b>Reason:</b> {a.Reason}{a.ReferenceNo ? <span className="text-muted-foreground"> · Ref. {a.ReferenceNo}</span> : null}</p>
      <table className="mt-2 w-full text-xs">
        <thead><tr className="text-left uppercase tracking-[0.08em] text-muted-foreground"><th className="py-1 pr-3 font-semibold">What</th><th className="py-1 pr-3 font-semibold">Registered now</th><th className="py-1 font-semibold">Change to</th></tr></thead>
        <tbody>{a.changes.map((c, i) => (
          <tr key={i} className="border-t border-border/60"><td className="py-1 pr-3 font-medium">{c.label}</td>
            <td className="py-1 pr-3 text-destructive line-through decoration-destructive/40">{describe(c.from)}</td><td className="py-1 text-emerald-700 dark:text-emerald-400">{c.op === "remove" ? "Removed" : describe(c.to)}</td></tr>
        ))}</tbody>
      </table>
      {canApprove && Number(a.RequestedBy) !== Number(userId) && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block flex-1"><span className={lbl}>Remark *</span>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. Checked BLRO order; LR record updated" className={input} /></label>
          <button disabled={busy || remark.trim().length < 3} onClick={() => reject.mutate()} className={`${btn} border-destructive text-destructive hover:bg-destructive hover:text-white`}>Reject</button>
          <button disabled={busy || remark.trim().length < 3} onClick={() => approve.mutate()} className={`${btn} border-emerald-700 bg-emerald-700 text-white hover:opacity-90`}>{a.changes.length ? "Approve & apply" : "Approve — open for editing"}</button>
        </div>
      )}
      {Number(a.RequestedBy) === Number(userId) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Waiting for an Amendment Approver (Setup → Approval Control).</p>
          <button disabled={busy} onClick={() => withdraw.mutate()} className={line}>Withdraw</button>
        </div>
      )}
    </div>
  );
}

/** Loads what the request form needs (the land's values and records), then shows it. */
function RequestLoader({ landId, onClose }: { landId: number; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-amend", "land", landId], queryFn: () => getLandAmendments(landId) });
  if (isLoading || error || !data?.land) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <p className="border border-foreground bg-background px-4 py-3 text-sm">{error ? (error as Error).message : isLoading ? "Loading…" : "Land not found"}</p>
      </div>
    );
  }
  return <AmendRequest landId={landId} onClose={onClose} />;
}

/**
 * Ask for an amendment: type, reason, reference. Once an Amendment Approver approves it, the registered land opens for
 * editing; the edits then go through Land verification and approval and become the next version (no new deed process).
 */
function AmendRequest({ landId, onClose }: { landId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["legal-amend-fields"], queryFn: getAmendFields, staleTime: 3600_000 });
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const send = useMutation({
    mutationFn: () => requestAmendment(landId, { type, reason, referenceNo: ref, changes: [] }),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["legal-amend"] }); qc.invalidateQueries({ queryKey: ["legal-flow"] }); qc.invalidateQueries({ queryKey: ["legal-review"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-background" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border p-4"><h2 className="text-lg font-semibold">Request amendment</h2>
          <p className="mt-1 text-xs text-muted-foreground">After approval the land opens for editing. Make the changes, then send it for verification — it becomes the next version. No new deed process.</p></div>
        <div className="space-y-3 p-4">
          <label className="block"><span className={lbl}>Amendment type *</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-full border border-foreground/30 bg-background px-2 text-sm">
              <option value="">Choose…</option>{(data?.types ?? []).map((t: string) => <option key={t}>{t}</option>)}
            </select></label>
          <label className="block"><span className={lbl}>Reference no. (court order, mutation case…)</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={150} className="h-9 w-full border border-foreground/30 bg-background px-2 text-sm" /></label>
          <label className="block"><span className={lbl}>Reason / what will change *</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={1000} className="w-full border border-foreground/30 bg-background p-2 text-sm" /></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button onClick={onClose} className={line}>Cancel</button>
          <button onClick={() => send.mutate()} disabled={send.isPending || !type || reason.trim().length < 5} className={ink}>{send.isPending ? "Sending…" : "Send for approval"}</button>
        </div>
      </div>
    </div>
  );
}

/** The waiting amendment in a dialog: approvers approve / reject with a remark, the requester can withdraw. */
function ReviewDialog({ a, canApprove, userId, onClose }: { a: Amendment; canApprove: boolean; userId: number | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto bg-background" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end"><button onClick={onClose} aria-label="Close" className="p-2"><X size={18} /></button></div>
        <AmendmentDecision a={a} canApprove={canApprove} userId={userId} />
      </div>
    </div>
  );
}

/**
 * Land & Projects, per land: a registered land gets "Request amendment"; one with an amendment waiting shows it,
 * with Review (approve / reject for Amendment Approvers, withdraw for the requester).
 */
export function AmendmentCell({ landId, registered }: { landId: number; registered: boolean }) {
  const [mode, setMode] = useState<"" | "request" | "review">("");
  const { data } = useQuery({ queryKey: ["legal-amend", "pending"], queryFn: () => getPendingAmendments(), refetchInterval: 60_000 });
  if (!registered) return <span className="text-muted-foreground">—</span>;
  const pending = data?.items.find((a) => a.LandId === landId);
  return (
    <>
      {pending ? (
        <span className="flex flex-col items-start gap-1">
          <span className="bg-indigo-600 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-white">Amendment {pending.AmendmentNo} waiting</span>
          <button onClick={() => setMode("review")} className="border border-indigo-600 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-600 hover:text-white dark:text-indigo-300">
            {data?.canApprove && Number(pending.RequestedBy) !== Number(data.userId) ? "Review & approve" : "View"}
          </button>
        </span>
      ) : (
        <button onClick={() => setMode("request")} className="border border-foreground px-2.5 py-1 text-xs font-semibold hover:bg-foreground hover:text-background">Request amendment</button>
      )}
      {mode === "request" && <RequestLoader landId={landId} onClose={() => setMode("")} />}
      {mode === "review" && pending && <ReviewDialog a={pending} canApprove={!!data?.canApprove} userId={data?.userId ?? null} onClose={() => setMode("")} />}
    </>
  );
}

/** Top of Land & Projects: every amendment waiting for approval (shown to Amendment Approvers). */
export function PendingAmendments() {
  const [open, setOpen] = useState<Amendment | null>(null);
  const { data } = useQuery({ queryKey: ["legal-amend", "pending"], queryFn: () => getPendingAmendments(), refetchInterval: 60_000 });
  if (!data?.canApprove || !data.items.length) return null;
  return (
    <div className="mb-4 border-2 border-indigo-500 bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em]">Amendments waiting for your approval <span className="tabular-nums text-muted-foreground">{data.items.length}</span></p>
      <ul className="mt-2 divide-y divide-border">
        {data.items.map((a) => (
          <li key={a.AmendmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <b className="font-mono">{a.LandCode}</b><span>Amendment {a.AmendmentNo} · {a.AmendType}</span>
            <span className="text-xs text-muted-foreground">{a.changes.length} change{a.changes.length === 1 ? "" : "s"} · {a.RequestedByName} · {when(a.RequestedAt)}</span>
            <button onClick={() => setOpen(a)} className="ml-auto border border-indigo-600 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-600 hover:text-white dark:text-indigo-300">
              {Number(a.RequestedBy) === Number(data.userId) ? "View" : "Review & approve"}
            </button>
          </li>
        ))}
      </ul>
      {open && <ReviewDialog a={open} canApprove={data.canApprove} userId={data.userId} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Land Workspace → Versions & Amendments: the waiting amendment (review / withdraw) or "Request amendment". */
export function LandAmendmentActions({ landId }: { landId: number }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["legal-amend", "land", landId], queryFn: () => getLandAmendments(landId) });
  if (!data?.locked) return null;
  const pending = data.items.find((a) => a.Status === "Pending");
  const openA = data.items.find((a) => a.Status === "Open");
  return (
    <div className="space-y-3">
      {openA ? (
        <div className="border-2 border-indigo-500 bg-indigo-500/5 px-4 py-3 text-sm">
          <b>Amendment {openA.AmendmentNo} approved — the land is open for editing.</b> Make the changes ({openA.AmendType}: {openA.Reason}), then click
          <b> Submit for verification</b>. When the new version is approved the land locks again.
        </div>
      ) : pending ? <AmendmentDecision a={pending} canApprove={data.canApprove} userId={data.userId} /> : (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-indigo-500/60 bg-indigo-500/5 px-4 py-3">
          <p className="text-sm"><b>Need to change this registered land?</b> Request an amendment. Once approved, the land opens for editing; the edits are verified and approved as the next version — no new deed process.</p>
          <button onClick={() => setOpen(true)} className={ink}>Request amendment</button>
        </div>
      )}
      {open && <AmendRequest landId={landId} onClose={() => setOpen(false)} />}
    </div>
  );
}
