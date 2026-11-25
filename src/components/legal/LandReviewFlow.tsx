import React, { useRef, useState } from "react";
import { LandVerificationCard } from "@/components/legal/LandVerificationCard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { askLegal } from "@/components/legal/LegalAsk";
import { InlineRecordEditor, SECTION_MASTERS } from "@/components/legal/InlineRecordEditor";
import { clearCourtCase, getDiligence } from "@/api/legalDiligenceApi";
import { checkReviewStep, decideReview, getLandReview, getSectionRights, returnReview, submitReview, type EntryField, type EntryRecord, type LandReview, type ReviewStep } from "@/api/legalFlowApi";

const val = (x: unknown) => {
  if (x === null || x === undefined || x === "") return "—";
  const s = String(x);
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(s) ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : s;
};
const btn = "h-9 border px-4 text-xs font-semibold uppercase tracking-[0.08em] disabled:cursor-not-allowed disabled:opacity-40";
const DOC_STATE: Record<string, string> = { Verified: "text-emerald-700 dark:text-emerald-400", Pending: "text-amber-700 dark:text-amber-400", Missing: "font-semibold text-destructive", Rejected: "font-semibold text-destructive" };

/** One field: its value (or "Not filled" / "Required — not filled"), the file link, and the old value when it changed. */
type Dec = "ok" | "bad" | "na";
type Decide = { decisions?: Record<string, Dec>; remarks?: Record<string, string>; onDecide?: (fieldKey: string, d: Dec | null) => void };
function FieldCell({ f, old, diff, fk, decisions, remarks, onDecide }: { f: EntryField; old?: EntryField; diff: boolean; fk?: string } & Decide) {
  const rm = fk ? remarks?.[fk] : undefined;
  const d = fk ? decisions?.[fk] : undefined;
  const changed = diff && old !== undefined && (old?.v ?? null) !== (f.v ?? null);
  const empty = f.v == null;
  return (
    <div className={`relative border-l-2 px-1.5 py-1 ${d === "bad" ? "outline outline-2 -outline-offset-2 outline-destructive" : d === "ok" ? "outline outline-1 -outline-offset-1 outline-emerald-600" : d === "na" ? "opacity-60" : ""} ${changed ? "border-amber-500 bg-amber-500/10" : empty ? (f.req ? "border-destructive bg-destructive/5" : "border-border bg-muted/40") : "border-sky-500 bg-sky-500/5"}`}>
      <dt className="flex flex-wrap items-start justify-between gap-1 text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">
        <span>{f.l}{f.req && <span className="text-destructive"> *</span>}</span>
        {f.info ? (
          <span className="shrink-0 text-[0.5625rem] normal-case text-muted-foreground" title="Not entered data — nothing to verify">info</span>
        ) : fk && onDecide ? (
          <span className="flex shrink-0 gap-0.5 normal-case">
            <button type="button" title="Correct" onClick={() => onDecide(fk, d === "ok" ? null : "ok")}
              className={`h-8 w-8 border text-sm font-bold leading-none sm:h-5 sm:w-5 sm:text-[0.6875rem] ${d === "ok" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-600/50 text-emerald-700 hover:bg-emerald-600/10"}`}>✓</button>
            <button type="button" title="Wrong" onClick={() => onDecide(fk, d === "bad" ? null : "bad")}
              className={`h-8 w-8 border text-sm font-bold leading-none sm:h-5 sm:w-5 sm:text-[0.6875rem] ${d === "bad" ? "border-destructive bg-destructive text-white" : "border-destructive/50 text-destructive hover:bg-destructive/10"}`}>✗</button>
            <button type="button" title="Not needed / not required" onClick={() => onDecide(fk, d === "na" ? null : "na")}
              className={`h-8 border px-1.5 text-xs font-bold leading-none sm:h-5 sm:px-1 sm:text-[0.5625rem] ${d === "na" ? "border-foreground bg-foreground text-background" : "border-foreground/30 text-muted-foreground hover:bg-muted"}`}>N/A</button>
          </span>
        ) : d ? <span className={`text-xs font-bold ${d === "ok" ? "text-emerald-700" : d === "bad" ? "text-destructive" : "text-muted-foreground"}`}>{d === "ok" ? "✓" : d === "bad" ? "✗" : "N/A"}</span> : null}
      </dt>
      <dd className="text-sm">
        {empty ? <span className={f.req ? "font-semibold text-destructive" : "italic text-muted-foreground"}>{f.req ? "Required — not filled" : "Not filled"}</span>
          : f.file ? <LegalFileLink id={f.file} name={f.v ?? "File"} /> : <span className="font-medium">{val(f.v)}</span>}
        {changed && <s className="ml-1.5 text-xs text-destructive">{val(old?.v)}</s>}
        {d === "bad" && rm && <span className="mt-0.5 block text-xs font-semibold text-destructive">✗ {rm}</span>}
      </dd>
    </div>
  );
}

export function RecordCard({ r, prev, diff, tag, decisions, remarks, onDecide, onEdit }: { r: EntryRecord; prev?: EntryRecord; diff: boolean; tag?: "new" | "gone"; onEdit?: () => void } & Decide) {
  const filled = r.fields.filter((f) => f.v != null).length;
  const reqMissing = r.fields.filter((f) => f.req && f.v == null).length;
  return (
    <div className={`border ${tag === "new" ? "border-emerald-600 bg-emerald-500/5" : tag === "gone" ? "border-destructive/50 opacity-70" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs">
        <b>{r.title}</b>
        {tag === "new" && <span className="bg-emerald-600 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-white">New</span>}
        {tag === "gone" && <span className="bg-destructive px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-white">Removed</span>}
        {onEdit && <button onClick={onEdit} className="ml-auto h-7 border border-foreground/50 px-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] hover:border-foreground hover:bg-foreground hover:text-background">Edit</button>}
        <span className={`${onEdit ? "" : "ml-auto "}text-muted-foreground`}>{filled} / {r.fields.length} filled{reqMissing ? <b className="ml-1.5 text-destructive">· {reqMissing} required missing</b> : null}</span>
      </div>
      <dl className={`grid grid-cols-1 gap-1 p-2 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${tag === "gone" ? "line-through" : ""}`}>
        {r.fields.map((f) => <FieldCell key={f.n} f={f} old={prev?.fields.find((x) => x.n === f.n)} diff={diff && !!prev}
          fk={tag === "gone" ? undefined : `${r.master}#${r.id}#${f.n}`} decisions={decisions} remarks={remarks} onDecide={onDecide} />)}
      </dl>
    </div>
  );
}

export function StepBody({ s, first, onDecide, renderRecord }: { s: ReviewStep; first: boolean; onDecide?: Decide["onDecide"]; renderRecord?: (r: EntryRecord, card: React.ReactNode) => React.ReactNode }) {
  const diff = !first && s.changed && !!s.previous;
  const prevOf = (r: EntryRecord) => s.previous?.find((p) => p.master === r.master && p.id === r.id);
  const gone = diff ? (s.previous ?? []).filter((p) => !s.records.some((r) => r.master === p.master && r.id === p.id)) : [];
  return (
    <div className="space-y-2">
      {s.records.length ? s.records.map((r) => {
        const card = <RecordCard key={`${r.master}-${r.id}`} r={r} prev={prevOf(r)} diff={diff} tag={diff && !prevOf(r) ? "new" : undefined} decisions={s.decisions} remarks={s.remarks} onDecide={onDecide} />;
        return renderRecord ? <React.Fragment key={`${r.master}-${r.id}`}>{renderRecord(r, card)}</React.Fragment> : card;
      })
        : (
          <div className={`border border-dashed px-3 py-2 ${s.needed ? "border-destructive/60 bg-destructive/5" : "border-border"}`}>
            <p className={`text-sm ${s.needed ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{s.needed ? "Nothing entered — this section is needed." : "Nothing entered (optional)."}</p>
            {s.template?.map((t) => (
              <p key={t.title} className="mt-1 text-xs text-muted-foreground"><b>{t.title}:</b> {t.fields.map((f) => f.l + (f.req ? " *" : "")).join(" · ")}</p>
            ))}
          </div>
        )}
      {gone.map((r) => <RecordCard key={`gone-${r.master}-${r.id}`} r={r} diff={false} tag="gone" />)}
      {s.checklist && s.checklist.length > 0 && (
        <div className="border border-border p-2">
          <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Document checklist</p>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
            {s.checklist.map((c, i) => <li key={i} className="flex justify-between gap-2"><span>{c.doc} <span className="text-muted-foreground">({c.requirement})</span></span><span className={DOC_STATE[c.state] ?? "text-muted-foreground"}>{c.state === "Pending" ? "Waiting for review" : c.state}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function StepCard({ n, s, first, canTick, onAll, onDecide, busy }: { n: number; s: ReviewStep; first: boolean; canTick: boolean; onAll: (a: "ok" | "clear") => void; onDecide: Decide["onDecide"]; busy: boolean }) {
  const [open, setOpen] = useState(s.changed);
  const tone = !s.changed ? "border-border" : s.checked ? "border-emerald-600" : "border-amber-500";
  const missingDocs = (s.checklist ?? []).filter((c) => c.state === "Missing").length;
  const incomplete = s.missingRequired.length > 0 || (s.needed && !s.records.length) || missingDocs > 0;
  return (
    <li className="relative pl-12">
      <span className={`absolute left-0 top-3 flex h-8 w-8 items-center justify-center border-2 text-sm font-bold ${s.checked ? "border-emerald-600 bg-emerald-600 text-white" : s.changed ? "border-amber-500 bg-card" : "border-border bg-muted text-muted-foreground"}`}>
        {s.checked ? "✓" : n}
      </span>
      <div className={`border-2 bg-card ${tone}`}>
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <button onClick={() => setOpen((x) => !x)} className="text-left"><h3 className="text-base font-semibold">{s.label}</h3></button>
          <span className={`px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] ${!s.changed ? "bg-muted text-muted-foreground" : first ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
            {!s.changed ? "No change" : first ? "To verify" : "Changed"}
          </span>
          <span className="text-xs text-muted-foreground">
            {s.records.length} entr{s.records.length === 1 ? "y" : "ies"} · {s.filled} / {s.total} fields filled{s.files ? ` · ${s.files} file${s.files === 1 ? "" : "s"}` : ""}
          </span>
          {/* Verified = every field has ✓ or ✗ (section shows ✗ count in red). Missing data is shown apart, in red. */}
          <span className={`px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] ${s.checked ? (s.crosses ? "bg-destructive text-white" : "bg-emerald-600 text-white") : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
            {s.checked ? (s.crosses ? `Verified · ${s.crosses} ✗ wrong` : "Verified") : `Pending · ${s.decided ?? 0}/${s.fieldTotal ?? 0} fields`}
          </span>
          {incomplete && <span className="text-xs font-semibold text-destructive">{[s.needed && !s.records.length ? "nothing entered" : "", s.missingRequired.length ? `${s.missingRequired.length} required field${s.missingRequired.length === 1 ? "" : "s"} empty` : "", missingDocs ? `${missingDocs} document${missingDocs === 1 ? "" : "s"} missing` : ""].filter(Boolean).join(" · ")}</span>}
          {s.staleTick && <span className="text-xs text-destructive">Changed again after it was ticked — check it again</span>}
          <button onClick={() => setOpen((x) => !x)} className="ml-auto text-xs underline">{open ? "Hide" : "Show"}</button>
          {canTick && (
            <span className="flex gap-1">
              <button disabled={busy} onClick={() => onAll("ok")} title={s.records.length ? "✓ on filled fields and N/A on empty ones, for every field not yet marked" : "Nothing to enter — mark verified"}
                className="h-8 border border-emerald-700 px-3 text-xs font-semibold uppercase tracking-[0.06em] text-emerald-700 hover:bg-emerald-700 hover:text-white disabled:opacity-40">✓ {s.records.length ? "All" : "Verified"}</button>
              <button disabled={busy || !(s.decided || s.checked)} onClick={() => onAll("clear")} className="h-8 border border-foreground/40 px-2 text-xs disabled:opacity-40">Clear</button>
            </span>
          )}
        </header>
        {s.checked && s.checkedBy && <p className="-mt-2 px-4 pb-2 text-xs text-muted-foreground">Last marked by {s.checkedBy}{s.checkedAt ? ` · ${val(s.checkedAt)}` : ""}</p>}
        {open && <div className="border-t border-border px-4 py-3"><StepBody s={s} first={first} onDecide={canTick ? onDecide : undefined} /></div>}
      </div>
    </li>
  );
}

const NEW_LABEL: Record<string, string> = {
  "ownership-record": "owner", inheritance: "inheritance", partition: "partition", "property-restriction": "restriction",
  "ownership-event": "transfer", "land-purchase": "purchase", "land-rs-record": "RS record", "land-lr-record": "LR record",
  "legal-case": "court case", "land-legal-record": "legal record",
};

/** The land's record, every section row by row, read-only — every field shown, empty ones marked (land page). */
export function LandRecordView({ landId, editor }: { landId: number; editor?: (key: string) => React.ReactNode }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  // Inline editing: "<master>#<id>" for an entry, "new:<section>:<master>" for a new one.
  const [inline, setInline] = useState<string | null>(null);
  // Per-section rights: a section without create / edit right shows no + New / Edit.
  const rightsQ = useQuery({ queryKey: ["legal-section-rights"], queryFn: getSectionRights, staleTime: 300_000 });
  const can = (sec: string, a: "create" | "edit") => rightsQ.data ? !!rightsQ.data[sec]?.[a] : true;
  const done = () => { setInline(null); qc.invalidateQueries({ queryKey: ["legal-review", landId] }); };
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-review", landId], queryFn: () => getLandReview(landId) });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>;
  return (
    <div className="space-y-4">
      {data.steps.map((s, i) => {
        const req = s.missingRequired.length, docs = (s.checklist ?? []).filter((c) => c.state === "Missing").length;
        const wrong = Object.values(s.decisions ?? {}).filter((d) => d === "bad").length;
        const empty = !s.records.length;
        return (
          <section key={s.key} className={`border bg-card ${wrong ? "border-2 border-destructive" : "border-border"}`}>
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
              <span className="flex h-6 w-6 items-center justify-center bg-foreground text-xs font-bold text-background">{i + 1}</span>
              <h3 className="font-semibold">{s.label}</h3>
              <span className="text-xs text-muted-foreground">{s.records.length} entr{s.records.length === 1 ? "y" : "ies"} · {s.filled} / {s.total} fields filled{s.files ? ` · ${s.files} file${s.files === 1 ? "" : "s"}` : ""}</span>
              {wrong > 0 && <span className="bg-destructive px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-white">✗ {wrong} field{wrong === 1 ? "" : "s"} to correct</span>}
              {(req > 0 || docs > 0 || (empty && s.needed)) && <span className="text-xs font-semibold text-destructive">{[empty && s.needed ? "nothing entered" : "", req ? `${req} required empty` : "", docs ? `${docs} document${docs === 1 ? "" : "s"} missing` : ""].filter(Boolean).join(" · ")}</span>}
              {editor && SECTION_MASTERS[s.key] && s.key !== "basic" && can(s.key, "create") && (
                <span className="ml-auto flex flex-wrap justify-end gap-1">
                  {SECTION_MASTERS[s.key].map((m) => (
                    <button key={m} onClick={() => setInline(`new:${s.key}:${m}`)}
                      className="h-8 border border-foreground bg-foreground px-3 text-xs font-semibold uppercase tracking-[0.06em] text-background hover:opacity-90">
                      + New{SECTION_MASTERS[s.key].length > 1 ? ` ${NEW_LABEL[m] ?? ""}` : ""}
                    </button>
                  ))}
                </span>
              )}
              {/* Documents keep their own editor (upload, file versions). */}
              {editor && !SECTION_MASTERS[s.key] && s.key !== "registration" && can(s.key, "edit") && (
                <button onClick={() => { if (editing === s.key) qc.invalidateQueries({ queryKey: ["legal-review", landId] }); setEditing(editing === s.key ? null : s.key); }}
                  className={`ml-auto h-8 border px-3 text-xs font-semibold uppercase tracking-[0.06em] ${editing === s.key ? "border-foreground bg-foreground text-background" : "border-foreground/50 hover:border-foreground"}`}>
                  {editing === s.key ? "Done" : "Edit"}
                </button>
              )}
            </header>
            <div className="space-y-2 p-3">
              {inline?.startsWith(`new:${s.key}:`) && <InlineRecordEditor master={inline.split(":")[2]} id={null} landId={landId} onDone={done} />}
              {editing === s.key && editor ? editor(s.key) : (
                <StepBody s={s} first renderRecord={editor && SECTION_MASTERS[s.key] && can(s.key, "edit") ? (rec, card) => inline === `${rec.master}#${rec.id}`
                  ? <InlineRecordEditor master={rec.master} id={rec.id} landId={landId} title={rec.title} onDone={done} />
                  : React.cloneElement(card as React.ReactElement, { onEdit: () => setInline(`${rec.master}#${rec.id}`) }) : undefined} />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Open court cases / stay orders on the land: a Legal Reviewer clears them here (they block Deed approval until cleared). */
function CourtClearance({ landId }: { landId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["legal-diligence", landId], queryFn: () => getDiligence(landId) });
  const open = (data?.cases ?? []).filter((c) => !c.ClearedAt);
  if (!open.length) return null;
  const canClear = !!(data as { can?: { clear?: boolean } } | undefined)?.can?.clear;
  const clear = async (id: number, no: string) => {
    const r = await askLegal({ title: `Clear case ${no}?`, message: "Only after reviewing the supporting evidence (order, settlement, withdrawal…).", input: { label: "Reason / evidence reviewed", required: true, multiline: true }, confirmText: "Clear case" });
    if (!r) return;
    try { await clearCourtCase(landId, id, r); toast.success(`Case ${no} cleared`); qc.invalidateQueries({ queryKey: ["legal-diligence", landId] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="border-2 border-destructive/60 bg-destructive/5 px-4 py-3">
      <p className="text-sm font-semibold text-destructive">Court cases not cleared ({open.length}) — the deed cannot be approved until a Legal Reviewer clears them</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {open.map((c) => (
          <li key={c.CaseId} className="flex flex-wrap items-center gap-2">
            <b>{c.CaseNumber}</b><span className="text-muted-foreground">{c.CourtName ?? ""}{c.StayType && c.StayType !== "None" ? ` · ${c.StayType}` : ""} · {c.CaseStatus}</span>
            {canClear ? <button onClick={() => clear(c.CaseId, c.CaseNumber)} className="ml-auto h-8 border border-foreground px-3 text-xs font-semibold uppercase tracking-[0.06em] hover:bg-foreground hover:text-background">Clear case</button>
              : <span className="ml-auto text-xs text-amber-700">Waiting for a Legal Reviewer</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Approver: a fully verified land goes to Deed Process, or back to data entry (Approvals → Land approval). */
export function ReviewDecision({ landId, versionNo }: { landId: number; versionNo: number }) {
  const qc = useQueryClient();
  const [remark, setRemark] = useState("");
  const decide = useMutation({
    mutationFn: (a: "Approve" | "Return") => decideReview(landId, a, remark.trim() || undefined),
    onSuccess: (r) => { toast.success(r.message); setRemark(""); ["legal-review", "legal-flow", "legal-review-queue"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ["legal-review-queue"] }); },
  });
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remarks (needed to send back)" className="h-8 flex-1 border border-foreground/30 bg-background px-2 text-sm" />
      <div className="flex gap-2">
        <button disabled={decide.isPending || !remark.trim()} onClick={() => decide.mutate("Return")} className="h-8 border border-destructive px-3 text-xs font-semibold uppercase tracking-[0.06em] text-destructive hover:bg-destructive hover:text-white disabled:opacity-40">Send back</button>
        <button disabled={decide.isPending} onClick={() => decide.mutate("Approve")} className="h-8 border border-emerald-700 bg-emerald-700 px-3 text-xs font-semibold uppercase tracking-[0.06em] text-white hover:opacity-90 disabled:opacity-40">Approve — send to Deed Process</button>
      </div>
    </div>
  );
}

/**
 * Land Flowchart — the review of a land's next version, step by step. The verifier opens each step, checks it and ticks
 * Verified; when every step to check is ticked, Submit sends it to the Approver. Approve saves the land as the next
 * version. Later versions only ask for the steps that changed.
 */
export function LandReviewFlow({ landId }: { landId: number }) {
  const qc = useQueryClient();
  const [remark, setRemark] = useState("");
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-review", landId], queryFn: () => getLandReview(landId) });
  const done = (m: string) => { toast.success(m); setRemark(""); qc.invalidateQueries({ queryKey: ["legal-review"] }); qc.invalidateQueries({ queryKey: ["legal-flow"] }); qc.invalidateQueries({ queryKey: ["legal-review-queue"] }); };
  // Marks update the screen at once (optimistic); saves go one after another in the background, and the page re-syncs
  // with the server a moment after the last click.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const resync = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyLocal = (stepKey: string, change: (d: Record<string, "ok" | "bad" | "na">, s: ReviewStep) => void) => {
    qc.setQueryData<LandReview>(["legal-review", landId], (old) => {
      if (!old) return old;
      const steps = old.steps.map((st) => {
        if (st.key !== stepKey) return st;
        const d = { ...(st.decisions ?? {}) };
        change(d, st);
        const keys = st.records.flatMap((rec) => rec.fields.filter((f) => !f.info).map((f) => `${rec.master}#${rec.id}#${f.n}`));
        const decided = keys.filter((k) => d[k]).length;
        const checked = st.records.length ? decided === keys.length && keys.length > 0 : Object.keys(d).length > 0 || st.checked;
        return { ...st, decisions: d, decided, fieldTotal: keys.length, crosses: keys.filter((k) => d[k] === "bad").length, checked };
      });
      return { ...old, steps, ticked: steps.filter((x) => x.checked).length };
    });
  };
  const send = (body: Parameters<typeof checkReviewStep>[1] & { values: Record<string, string | null> }) => {
    pending.current++;
    if (resync.current) clearTimeout(resync.current);
    queue.current = queue.current.then(() => checkReviewStep(landId, body)).catch((e: Error) => { toast.error(e.message); }).finally(() => {
      if (--pending.current === 0) resync.current = setTimeout(() => qc.invalidateQueries({ queryKey: ["legal-review", landId] }), 1200);
    });
  };
  const valuesOf = (st: ReviewStep) => Object.fromEntries(st.records.flatMap((rec) => rec.fields.filter((f) => !f.info).map((f) => [`${rec.master}#${rec.id}#${f.n}`, f.v ?? null])));
  const decide = async (st: ReviewStep, field: string, decision: "ok" | "bad" | "na" | null) => {
    // ✗ asks what is wrong (optional) — shown to data entry on the field after a send-back.
    let remark: string | undefined;
    if (decision === "bad") {
      const x = await askLegal({ title: "What is wrong in this field?", message: "Optional — data entry sees it on the field.", input: { label: "Remark" }, confirmText: "Mark ✗" });
      if (x === null) return;
      remark = x || undefined;
    }
    applyLocal(st.key, (d) => { if (decision) d[field] = decision; else delete d[field]; });
    if (remark) qc.setQueryData<LandReview>(["legal-review", landId], (old) => old && { ...old, steps: old.steps.map((x) => (x.key === st.key ? { ...x, remarks: { ...(x.remarks ?? {}), [field]: remark! } } : x)) });
    send({ step: st.key, field, decision, remark, values: { [field]: valuesOf(st)[field] ?? null } });
  };
  const markAll = (st: ReviewStep, a: "ok" | "clear") => {
    const vals = valuesOf(st);
    applyLocal(st.key, (d, s2) => {
      if (a === "clear") { for (const k of Object.keys(d)) delete d[k]; return; }
      for (const [k, v] of Object.entries(vals)) if (v != null && v !== "" && !d[k]) d[k] = "ok";
      void s2;
    });
    if (!st.records.length) qc.setQueryData<LandReview>(["legal-review", landId], (old) => {
      if (!old) return old;
      const steps = old.steps.map((x) => (x.key === st.key ? { ...x, checked: a === "ok" } : x));
      return { ...old, steps, ticked: steps.filter((x) => x.checked).length };
    });
    send({ step: st.key, all: a, values: vals });
  };
  const tick = { isPending: false };
  const submit = useMutation({ mutationFn: () => submitReview(landId, remark.trim() || undefined), onSuccess: (r) => done(r.message), onError: (e: Error) => toast.error(e.message) });
  const sendBack = useMutation({ mutationFn: () => returnReview(landId, remark.trim() || autoReason()), onSuccess: (r) => done(r.message), onError: (e: Error) => toast.error(e.message) });

  // Send back without a remark: the reason is the list of fields marked ✗.
  const autoReason = () => {
    const out: string[] = [];
    for (const st of data?.steps ?? []) for (const rec of st.records) for (const f of rec.fields) if (st.decisions?.[`${rec.master}#${rec.id}#${f.n}`] === "bad") out.push(`${st.label} › ${f.l}`);
    return out.length ? `Correct the fields marked ✗: ${out.join("; ")}`.slice(0, 1000) : "";
  };
  const crossCount = (data?.steps ?? []).reduce((n, st) => n + (st.crosses ?? 0), 0);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the flowchart…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>;
  const submitted = false;
  const canTick = data.canVerify && data.status === "Verifying";
  const allTicked = data.toCheck > 0 && data.ticked === data.toCheck;
  const pct = data.toCheck ? Math.round((data.ticked / data.toCheck) * 100) : 100;

  return (
    <section className="space-y-4">
      <LandVerificationCard landId={landId} />
      <div className="flex flex-wrap items-end justify-between gap-3 border-2 border-foreground bg-card px-4 py-3">
        <div>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Version {data.versionNo} · {data.first ? "first verification" : "changes since version " + (data.versionNo - 1)}</p>
          <p className="mt-1 text-lg font-semibold">
            {data.status === "Up to date" ? (data.awaitingApproval ? `Verified — version ${data.versionNo - 1} saved, waiting for the Approver` : `Up to date — version ${data.versionNo - 1} is current`) : data.status === "Draft" ? "Not sent for verification yet" : `${data.ticked} of ${data.toCheck} sections verified`}
          </p>
        </div>
        {data.status !== "Up to date" && (
          <div className="w-full sm:w-64">
            <div className="h-2 bg-muted"><div className="h-2 bg-emerald-600 transition-all" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
      </div>

      {data.status === "Verifying" && data.review?.EntrySubmittedByName && (
        <p className="text-sm text-muted-foreground">Sent for verification by <b className="text-foreground">{data.review.EntrySubmittedByName}</b>{data.review.EntrySubmittedAt ? ` on ${val(data.review.EntrySubmittedAt)}` : ""}{data.review.Remarks ? ` — “${data.review.Remarks}”` : ""}</p>
      )}
      {data.status === "Draft" && <p className="border border-amber-500/60 bg-amber-500/5 px-3 py-2 text-sm">Data entry has not sent this land for verification yet. It appears in <b>Land verification</b> once they click <b>Submit for verification</b> on the land.</p>}
      {!data.canVerify && data.status === "Verifying" && <p className="text-xs text-muted-foreground">Only a Verifier (Setup → Approval Control) can tick the steps.</p>}

      <CourtClearance landId={landId} />

      {/* The flowchart: one step after another, joined by a line. */}
      <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-4 before:top-4 before:w-0.5 before:bg-border">
        {data.steps.map((s, i) => (
          <StepCard key={s.key} n={i + 1} s={s} first={data.first} canTick={canTick} busy={tick.isPending}
            onAll={(a) => markAll(s, a)} onDecide={(field, decision) => decide(s, field, decision)} />
        ))}
        <li className="relative pl-12">
          <span className={`absolute left-0 top-3 flex h-8 w-8 items-center justify-center border-2 text-sm font-bold ${allTicked ? "border-foreground bg-foreground text-background" : "border-border bg-muted text-muted-foreground"}`}>{data.steps.length + 1}</span>
          <div className="border-2 border-foreground/60 bg-card px-4 py-3">
            <h3 className="text-base font-semibold">Verify &amp; save version {data.versionNo}</h3>
            {data.status === "Up to date" ? (
              data.awaitingApproval
                ? <p className="mt-1 text-sm">Verified by <b>{data.lastVerifiedByName ?? "the verifier"}</b>{data.lastVerifiedRemarks ? ` — “${data.lastVerifiedRemarks}”` : ""}. Version {data.versionNo - 1} is saved; it now waits for the <b>Approver</b> (Approvals → Land approval) to go to Deed Process.</p>
                : <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={16} /> Nothing changed since the last version. New entries or edits come back here once data entry sends them.</p>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">Mark every field ✓, ✗ or N/A. With nothing ✗, write your remarks and verify — the land is saved as version {data.versionNo}. With fields ✗, send it back.</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={crossCount ? `Remarks (optional — the ${crossCount} field(s) marked ✗ are sent back)` : "Verification remarks (needed)"} disabled={!canTick} className="h-9 flex-1 border border-foreground/30 bg-background px-2 text-sm" />
                  <button disabled={!canTick || (!remark.trim() && !crossCount) || sendBack.isPending} onClick={() => sendBack.mutate()} title="Send back to data entry to correct"
                    className={`${btn} border-destructive text-destructive hover:bg-destructive hover:text-white`}>Send back</button>
                  <button disabled={!canTick || !allTicked || crossCount > 0 || remark.trim().length < 3 || submit.isPending} onClick={() => submit.mutate()}
                    title={!allTicked ? "Mark every field first" : crossCount ? "Fields are marked ✗ — send it back" : remark.trim().length < 3 ? "Write the remarks" : undefined}
                    className={`${btn} border-emerald-700 bg-emerald-700 text-white hover:opacity-90`}>Verify &amp; save version {data.versionNo}</button>
                </div>
              </div>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}
