import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { askLegal } from "@/components/legal/LegalAsk";
import { getReviews, reopenVerification, submitReview, type CheckStatus, type Workspace } from "@/api/legalVerificationApi";

const fmtTime = (d: string) => new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const lbl = "mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground";
const TONE: Record<string, string> = { Verified: "text-emerald-700", Reopened: "text-sky-700", Rejected: "text-destructive" };
/** "Verified" is stored; the reviewer sees it as Approve. */
const decisionLabel = (d: string) => (d === "Verified" ? "Approved" : d);

/**
 * The Final Legal Review (V2.1): a Legal Reviewer checks the 12 points, records the legal risks and approves, returns
 * or rejects. Land Approval waits for "Approved". Every decision is a numbered, fingerprinted version.
 */
export function VerificationReviewPanel({ w, onSaved }: { w: Workspace; onSaved: () => void }) {
  const q = useQuery({ queryKey: ["legal-verification-reviews", w.VerificationId], queryFn: () => getReviews(w.VerificationId) });
  const [checks, setChecks] = useState<Record<string, { status: CheckStatus; note: string }>>({});
  const [decision, setDecision] = useState("");
  const [remarks, setRemarks] = useState("");
  const [risks, setRisks] = useState("");
  const [busy, setBusy] = useState(false);
  const data = q.data;
  const open = w.Total - w.Completed - w.NotApplicable - (w.Rejected ?? 0);
  const reviewable = data?.canReview && !["Verified", "Closed", "Rejected"].includes(w.Status);
  const submit = async () => {
    if (!decision) { toast.error("Choose a decision"); return; }
    setBusy(true);
    try {
      const r = await submitReview(w.VerificationId, { decision, remarks, risks, checklist: checks });
      toast.success(r.message); setDecision(""); setRemarks(""); setRisks(""); setChecks({}); q.refetch(); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="mt-4 border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <b className="text-sm">Final Legal Review</b>
        <span className="text-xs text-muted-foreground">
          {open ? `${open} activit${open === 1 ? "y" : "ies"} not yet verified` : "Every activity assessed by a verifier"} · {w.Discrepancies} discrepanc{w.Discrepancies === 1 ? "y" : "ies"}
          {data ? ` · ${data.exceptions.length} exception${data.exceptions.length === 1 ? "" : "s"} · ${data.unverifiedDocs} document${data.unverifiedDocs === 1 ? "" : "s"} not verified` : ""}
        </span>
        {["Verified", "Rejected"].includes(w.Status) && data?.canReview && (
          <button className="text-xs underline" onClick={async () => {
            const reason = await askLegal({ title: "Reopen this verification?", message: "Activities become editable again; this is recorded as a new review version.", input: { label: "Reason", required: true }, confirmText: "Reopen" });
            if (!reason) return;
            try { toast.success((await reopenVerification(w.VerificationId, reason)).message); q.refetch(); onSaved(); } catch (e) { toast.error((e as Error).message); }
          }}>Reopen</button>
        )}
      </header>
      {data && data.exceptions.length > 0 && (
        <div className="border-b border-border p-3 text-xs">
          <p className={lbl}>Dependency overrides and legal exceptions (to be reviewed)</p>
          <ul className="space-y-1">
            {data.exceptions.map((x) => (
              <li key={x.ExceptionId} className="border-l-2 border-amber-600 pl-2"><b>{x.Kind}</b>{x.ActivityRef ? ` · ${x.ActivityRef}. ${x.ActivityName}` : ""} — {x.Reason}
                {x.Detail ? <span className="text-muted-foreground"> ({x.Detail})</span> : null} <span className="text-muted-foreground">· {x.CreatedBy ?? "—"} · {fmtTime(x.CreatedAt)}</span></li>
            ))}
          </ul>
        </div>
      )}
      {reviewable && data && (
        <div className="border-b border-border p-3">
          <div className="grid gap-x-4 gap-y-1.5 lg:grid-cols-2">
            {data.checks.map(([k, label]) => (
              <div key={k} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-64 shrink-0">{label}</span>
                {(["ok", "issue", "na"] as const).map((st) => (
                  <button key={st} aria-pressed={checks[k]?.status === st} onClick={() => setChecks((c) => ({ ...c, [k]: { status: st, note: c[k]?.note ?? "" } }))}
                    className={`h-6 border px-2 font-semibold ${checks[k]?.status === st ? (st === "ok" ? "border-emerald-700 bg-emerald-700 text-white" : st === "issue" ? "border-destructive bg-destructive text-white" : "border-foreground bg-foreground text-background") : "border-foreground/30 text-muted-foreground"}`}>
                    {st === "ok" ? "✓" : st === "issue" ? "✗" : "N/A"}
                  </button>
                ))}
                {checks[k]?.status === "issue" && <input className="h-6 min-w-0 flex-1 border border-foreground/30 bg-background px-1" placeholder="What is wrong" value={checks[k]?.note ?? ""}
                  onChange={(e) => setChecks((c) => ({ ...c, [k]: { status: c[k]?.status ?? "issue", note: e.target.value } }))} maxLength={300} />}
              </div>
            ))}
          </div>
          <label className="mt-3 block"><span className={lbl}>Legal risks and significant remarks</span>
            <textarea rows={3} maxLength={4000} className="w-full border border-foreground/30 bg-background p-2 text-sm" value={risks} onChange={(e) => setRisks(e.target.value)}
              placeholder="Risks accepted, conditions, follow-ups (required to approve when there are discrepancies or exceptions)" /></label>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <label><span className={lbl}>Decision</span>
              <select className="h-9 w-full border border-foreground/30 bg-background px-2 text-sm" value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="">Choose…</option>{data.decisions.map((d) => <option key={d} value={d} disabled={d === "Verified" && w.Status !== "Ready for Review"}>{d === "Verified" ? "Approve" : d}</option>)}
              </select></label>
            <label><span className={lbl}>Remarks{decision && decision !== "Verified" ? <span className="text-destructive"> *</span> : null}</span>
              <input className="h-9 w-full border border-foreground/30 bg-background px-2 text-sm" value={remarks} maxLength={2000} onChange={(e) => setRemarks(e.target.value)} /></label>
            <button disabled={busy} onClick={submit} className="h-9 self-end bg-foreground px-4 text-xs font-semibold uppercase text-background disabled:opacity-40">{busy ? "Saving…" : "Save review"}</button>
          </div>
          {w.Status !== "Ready for Review" && <p className="mt-2 text-xs text-muted-foreground">Approve is available once every mandatory activity is verified or approved as N/A. Land Approval waits for an approved Final Legal Review.</p>}
        </div>
      )}
      {!data?.canReview && !["Verified", "Closed", "Rejected"].includes(w.Status) && <p className="border-b border-border p-3 text-xs text-muted-foreground">A Legal Reviewer does the Final Legal Review once every activity is assessed.</p>}
      <div className="p-3">
        {q.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : !data?.reviews.length ? <p className="text-xs text-muted-foreground">Not reviewed yet.</p> : (
          <ol className="space-y-2 text-xs">
            {data.reviews.map((r) => {
              const issues = Object.entries(r.checklist).filter(([, c]) => c.status === "issue");
              return (
                <li key={r.ReviewId} className="border-l-2 border-foreground/30 pl-2">
                  <b>Version {r.VersionNo}</b> · <b className={TONE[r.Decision] ?? "text-amber-700"}>{decisionLabel(r.Decision)}</b> · {r.ReviewedBy ?? "—"} · {fmtTime(r.ReviewedAt)}
                  {r.SnapshotHash && <span className="ml-1 font-mono text-muted-foreground" title={r.SnapshotHash}>#{r.SnapshotHash.slice(0, 10)}</span>}
                  {r.Remarks && <span className="block">{r.Remarks}</span>}
                  {r.Risks && <span className="block text-amber-700">Risks: {r.Risks}</span>}
                  {issues.length > 0 && <span className="block text-destructive">Issues: {issues.map(([k, c]) => `${data.checks.find((x) => x[0] === k)?.[1] ?? k}${c.note ? ` (${c.note})` : ""}`).join("; ")}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
