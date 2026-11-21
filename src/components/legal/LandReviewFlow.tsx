import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { askLegal } from "@/components/legal/LegalAsk";
import { clearCourtCase, getDiligence } from "@/api/legalDiligenceApi";
import { checkReviewStep, decideReview, getLandReview, returnReview, submitReview, type EntryField, type EntryRecord, type ReviewStep } from "@/api/legalFlowApi";

const val = (x: unknown) => {
  if (x === null || x === undefined || x === "") return "—";
  const s = String(x);
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(s) ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : s;
};
const btn = "h-9 border px-4 text-xs font-semibold uppercase tracking-[0.08em] disabled:cursor-not-allowed disabled:opacity-40";
const DOC_STATE: Record<string, string> = { Verified: "text-emerald-700 dark:text-emerald-400", Pending: "text-amber-700 dark:text-amber-400", Missing: "font-semibold text-destructive", Rejected: "font-semibold text-destructive" };

/** One field: its value (or "Not filled" / "Required — not filled"), the file link, and the old value when it changed. */
function FieldCell({ f, old, diff }: { f: EntryField; old?: EntryField; diff: boolean }) {
  const changed = diff && old !== undefined && (old?.v ?? null) !== (f.v ?? null);
  const empty = f.v == null;
  return (
    <div className={`px-1.5 py-1 ${changed ? "bg-amber-500/10" : empty ? (f.req ? "bg-destructive/5" : "bg-muted/40") : ""}`}>
      <dt className="text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">{f.l}{f.req && <span className="text-destructive"> *</span>}</dt>
      <dd className="text-sm">
        {empty ? <span className={f.req ? "font-semibold text-destructive" : "italic text-muted-foreground"}>{f.req ? "Required — not filled" : "Not filled"}</span>
          : f.file ? <LegalFileLink id={f.file} name={f.v ?? "File"} /> : <span className="font-medium">{val(f.v)}</span>}
        {changed && <s className="ml-1.5 text-xs text-destructive">{val(old?.v)}</s>}
      </dd>
    </div>
  );
}

export function RecordCard({ r, prev, diff, tag }: { r: EntryRecord; prev?: EntryRecord; diff: boolean; tag?: "new" | "gone" }) {
  const filled = r.fields.filter((f) => f.v != null).length;
  const reqMissing = r.fields.filter((f) => f.req && f.v == null).length;
  return (
    <div className={`border ${tag === "new" ? "border-emerald-600 bg-emerald-500/5" : tag === "gone" ? "border-destructive/50 opacity-70" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs">
        <b>{r.title}</b>
        {tag === "new" && <span className="bg-emerald-600 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-white">New</span>}
        {tag === "gone" && <span className="bg-destructive px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-white">Removed</span>}
        <span className="ml-auto text-muted-foreground">{filled} / {r.fields.length} filled{reqMissing ? <b className="ml-1.5 text-destructive">· {reqMissing} required missing</b> : null}</span>
      </div>
      <dl className={`grid grid-cols-2 gap-1 p-2 sm:grid-cols-3 lg:grid-cols-4 ${tag === "gone" ? "line-through" : ""}`}>
        {r.fields.map((f) => <FieldCell key={f.n} f={f} old={prev?.fields.find((x) => x.n === f.n)} diff={diff && !!prev} />)}
      </dl>
    </div>
  );
}

export function StepBody({ s, first }: { s: ReviewStep; first: boolean }) {
  const diff = !first && s.changed && !!s.previous;
  const prevOf = (r: EntryRecord) => s.previous?.find((p) => p.master === r.master && p.id === r.id);
  const gone = diff ? (s.previous ?? []).filter((p) => !s.records.some((r) => r.master === p.master && r.id === p.id)) : [];
  return (
    <div className="space-y-2">
      {s.records.length ? s.records.map((r) => <RecordCard key={`${r.master}-${r.id}`} r={r} prev={prevOf(r)} diff={diff} tag={diff && !prevOf(r) ? "new" : undefined} />)
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

function StepCard({ n, s, first, canTick, onTick, busy }: { n: number; s: ReviewStep; first: boolean; canTick: boolean; onTick: (v: boolean) => void; busy: boolean }) {
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
          {/* Complete = the verifier has ticked this step. Missing data is shown apart, in red. */}
          <span className={`px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] ${s.checked ? "bg-emerald-600 text-white" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
            {s.checked ? "Complete · verified" : "Not verified yet"}
          </span>
          {incomplete && <span className="text-xs font-semibold text-destructive">{[s.needed && !s.records.length ? "nothing entered" : "", s.missingRequired.length ? `${s.missingRequired.length} required field${s.missingRequired.length === 1 ? "" : "s"} empty` : "", missingDocs ? `${missingDocs} document${missingDocs === 1 ? "" : "s"} missing` : ""].filter(Boolean).join(" · ")}</span>}
          {s.staleTick && <span className="text-xs text-destructive">Changed again after it was ticked — check it again</span>}
          <button onClick={() => setOpen((x) => !x)} className="ml-auto text-xs underline">{open ? "Hide" : "Show"}</button>
          {(canTick || s.checked || s.changed) && (
            <label className={`flex items-center gap-2 border px-3 py-1.5 text-sm font-semibold ${s.checked ? "border-emerald-600 text-emerald-700 dark:text-emerald-400" : "border-foreground/40"} ${canTick ? "cursor-pointer" : "opacity-60"}`}>
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={s.checked} disabled={!canTick || busy} onChange={(e) => onTick(e.target.checked)} />
              Verified
            </label>
          )}
        </header>
        {s.checked && s.checkedBy && <p className="-mt-2 px-4 pb-2 text-xs text-muted-foreground">Ticked by {s.checkedBy}{s.checkedAt ? ` · ${val(s.checkedAt)}` : ""}</p>}
        {open && <div className="border-t border-border px-4 py-3"><StepBody s={s} first={first} /></div>}
      </div>
    </li>
  );
}

/** The land's record, every section row by row, read-only — every field shown, empty ones marked (land page). */
export function LandRecordView({ landId, editor }: { landId: number; editor?: (key: string) => React.ReactNode }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-review", landId], queryFn: () => getLandReview(landId) });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>;
  return (
    <div className="space-y-4">
      {data.steps.map((s, i) => {
        const req = s.missingRequired.length, docs = (s.checklist ?? []).filter((c) => c.state === "Missing").length;
        const empty = !s.records.length;
        return (
          <section key={s.key} className="border border-border bg-card">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
              <span className="flex h-6 w-6 items-center justify-center bg-foreground text-xs font-bold text-background">{i + 1}</span>
              <h3 className="font-semibold">{s.label}</h3>
              <span className="text-xs text-muted-foreground">{s.records.length} entr{s.records.length === 1 ? "y" : "ies"} · {s.filled} / {s.total} fields filled{s.files ? ` · ${s.files} file${s.files === 1 ? "" : "s"}` : ""}</span>
              {(req > 0 || docs > 0 || (empty && s.needed)) && <span className="text-xs font-semibold text-destructive">{[empty && s.needed ? "nothing entered" : "", req ? `${req} required empty` : "", docs ? `${docs} document${docs === 1 ? "" : "s"} missing` : ""].filter(Boolean).join(" · ")}</span>}
              {editor && (
                <button onClick={() => { if (editing === s.key) qc.invalidateQueries({ queryKey: ["legal-review", landId] }); setEditing(editing === s.key ? null : s.key); }}
                  className={`ml-auto h-8 border px-3 text-xs font-semibold uppercase tracking-[0.06em] ${editing === s.key ? "border-foreground bg-foreground text-background" : "border-foreground/50 hover:border-foreground"}`}>
                  {editing === s.key ? "Done" : "Edit"}
                </button>
              )}
            </header>
            <div className="p-3">{editing === s.key && editor ? editor(s.key) : <StepBody s={s} first />}</div>
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

/** Approve / send back a submitted land review (Approvals → Versions). */
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
        <button disabled={decide.isPending} onClick={() => decide.mutate("Approve")} className="h-8 border border-emerald-700 bg-emerald-700 px-3 text-xs font-semibold uppercase tracking-[0.06em] text-white hover:opacity-90 disabled:opacity-40">Approve — version {versionNo}</button>
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
  const tick = useMutation({ mutationFn: ({ k, v }: { k: string; v: boolean }) => checkReviewStep(landId, k, v), onSuccess: () => qc.invalidateQueries({ queryKey: ["legal-review", landId] }), onError: (e: Error) => toast.error(e.message) });
  const submit = useMutation({ mutationFn: () => submitReview(landId, remark.trim() || undefined), onSuccess: (r) => done(r.message), onError: (e: Error) => toast.error(e.message) });
  const sendBack = useMutation({ mutationFn: () => returnReview(landId, remark.trim()), onSuccess: (r) => done(r.message), onError: (e: Error) => toast.error(e.message) });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the flowchart…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>;
  const submitted = data.status === "Submitted";
  const canTick = data.canVerify && data.status === "Verifying";
  const allTicked = data.toCheck > 0 && data.ticked === data.toCheck;
  const pct = data.toCheck ? Math.round((data.ticked / data.toCheck) * 100) : 100;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-2 border-foreground bg-card px-4 py-3">
        <div>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Version {data.versionNo} · {data.first ? "first verification" : "changes since version " + (data.versionNo - 1)}</p>
          <p className="mt-1 text-lg font-semibold">
            {data.status === "Up to date" ? `Up to date — version ${data.versionNo - 1} is current` : data.status === "Draft" ? "Not sent for verification yet" : submitted ? "Verified — waiting for the Approver" : `${data.ticked} of ${data.toCheck} sections verified`}
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
          <StepCard key={s.key} n={i + 1} s={s} first={data.first} canTick={canTick} busy={tick.isPending} onTick={(v) => tick.mutate({ k: s.key, v })} />
        ))}
        <li className="relative pl-12">
          <span className={`absolute left-0 top-3 flex h-8 w-8 items-center justify-center border-2 text-sm font-bold ${submitted ? "border-foreground bg-foreground text-background" : "border-border bg-muted text-muted-foreground"}`}>{data.steps.length + 1}</span>
          <div className="border-2 border-foreground/60 bg-card px-4 py-3">
            <h3 className="text-base font-semibold">{submitted ? "Approval" : "Submit for approval"}</h3>
            {data.status === "Up to date" ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={16} /> Nothing changed since the last version. Any new entry or edit on this land will appear here for verification.</p>
            ) : submitted ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-muted-foreground">Verified by <b className="text-foreground">{data.review?.SubmittedByName ?? "—"}</b>{data.review?.SubmittedAt ? ` on ${val(data.review.SubmittedAt)}` : ""}{data.review?.Remarks ? ` — “${data.review.Remarks}”` : ""}</p>
                <p className="text-sm">The Approver approves it in <b>Approvals → Versions</b>; it then becomes version {data.versionNo}.</p>
                <a href="/legal/approvals?tab=versions" className={`${btn} inline-flex items-center border-foreground bg-foreground text-background hover:opacity-90`}>{data.canApprove ? "Approve in Approvals →" : "Open Approvals →"}</a>
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remarks (needed to send back)" disabled={!canTick} className="h-9 flex-1 border border-foreground/30 bg-background px-2 text-sm" />
                <button disabled={!canTick || !remark.trim() || sendBack.isPending} onClick={() => sendBack.mutate()} title="Send back to data entry to correct"
                  className={`${btn} border-destructive text-destructive hover:bg-destructive hover:text-white`}>Send back</button>
                <button disabled={!canTick || !allTicked || submit.isPending} onClick={() => submit.mutate()} title={allTicked ? undefined : "Tick every step first"}
                  className={`${btn} border-foreground bg-foreground text-background hover:opacity-90`}>Submit for approval</button>
              </div>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}
