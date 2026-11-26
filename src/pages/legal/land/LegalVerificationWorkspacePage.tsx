import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardTick } from "iconsax-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { askLegal } from "@/components/legal/LegalAsk";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalLookup } from "@/api/legalMastersApi";
import {
  addActivityComment, decideNa, getActivityComments, getActivityHistory, getVerificationMeta, getWorkspace, reopenActivity, requestNa, submitActivity,
  updateActivity, updateWorkspace, verifyActivity, VerificationError, type Activity, type Workspace,
} from "@/api/legalVerificationApi";
import { Progress, WS_TONE, wsLabel } from "./LegalVerificationListPage";
import { ActivityEntriesPanel, useEntryConfig } from "@/components/legal/ActivityEntriesPanel";
import { VerificationReviewPanel } from "@/components/legal/VerificationReviewPanel";
import { VerificationDocumentsPanel } from "@/components/legal/VerificationDocumentsPanel";

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtTime = (d: string) => new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const input = "h-9 w-full border border-foreground/30 bg-background px-2 text-sm focus:border-foreground focus:outline-none";
const lbl = "mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground";
const btn = "h-8 border px-3 text-xs font-semibold uppercase tracking-[0.06em] disabled:opacity-40";
/** Work status (the employee's progress). */
export const STATUS_TONE: Record<string, string> = {
  Closed: "text-muted-foreground", "Submitted for Review": "text-violet-700", "On Hold": "text-amber-700",
  "In Progress": "text-sky-700", Applied: "text-sky-700", "Report Pending": "text-sky-700", "Not Started": "text-muted-foreground",
};
/** Verification status (the verifier's decision). */
export const VERIFY_TONE: Record<string, string> = {
  Verified: "text-emerald-700", "N/A": "text-muted-foreground", Rejected: "text-destructive", Returned: "text-destructive", "Under Review": "text-violet-700", "Not Reviewed": "text-muted-foreground",
};
const BAD = ["Mismatched", "Discrepancy Found", "Additional Documents Required", "Unable to Verify", "Case Found", "Incomplete", "Records Not Available"];
const GOV: [string, string][] = [["GovSubmissionDate", "Government submission"], ["AckDate", "Acknowledgement"], ["QueryDate", "Query"], ["QueryResponseDate", "Query response"],
  ["HearingDate", "Hearing"], ["ReportReceiptDate", "Report received"], ["OrderDate", "Order"]];
const govKey = (c: string) => c[0].toLowerCase() + c.slice(1);

function useUsers() {
  return useQuery({ queryKey: ["legal-lookup", "user"], queryFn: () => getLegalLookup("user"), staleTime: 600_000 });
}

function History({ activityId }: { activityId: number }) {
  const h = useQuery({ queryKey: ["legal-activity-history", activityId], queryFn: () => getActivityHistory(activityId) });
  if (h.isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!h.data?.length) return <p className="text-xs text-muted-foreground">No changes yet.</p>;
  return (
    <ol className="space-y-1.5 text-xs">
      {h.data.map((r) => (
        <li key={r.HistoryId} className="border-l-2 border-foreground/30 pl-2">
          <span className="text-muted-foreground">{fmtTime(r.ChangedAt)} · {r.ChangedBy ?? "System"} · </span>
          <b>{r.Action}</b>
          {r.OldStatus !== r.NewStatus && r.NewStatus && <> · {r.OldStatus ?? "—"} → <b>{r.NewStatus}</b></>}
          {r.OldFinding !== r.NewFinding && (r.NewFinding || r.OldFinding) && <> · finding {r.OldFinding ?? "—"} → <b>{r.NewFinding ?? "—"}</b></>}
          {r.OldAssignee !== r.NewAssignee && (r.NewAssignee || r.OldAssignee) && <> · employee {r.OldAssignee ?? "—"} → <b>{r.NewAssignee ?? "—"}</b></>}
          {r.Remarks && <span className="block">{r.Remarks}</span>}
          {r.FileId && <LegalFileLink id={r.FileId} name={r.FileName ?? "Document"} />}
        </li>
      ))}
    </ol>
  );
}

function Comments({ activityId }: { activityId: number }) {
  const q = useQuery({ queryKey: ["legal-activity-comments", activityId], queryFn: () => getActivityComments(activityId) });
  const [text, setText] = useState("");
  const add = async () => {
    if (!text.trim()) return;
    try { toast.success((await addActivityComment(activityId, text)).message); setText(""); q.refetch(); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="text-xs">
      <div className="mb-2 flex gap-2"><input className={input} value={text} maxLength={2000} placeholder="Comment for the team" onChange={(e) => setText(e.target.value)} />
        <button className={`${btn} border-foreground`} onClick={add}>Add</button></div>
      {(q.data ?? []).map((c) => <p key={c.CommentId} className="border-l-2 border-foreground/30 py-0.5 pl-2"><span className="text-muted-foreground">{fmtTime(c.CreatedAt)} · {c.CreatedBy ?? "—"}:</span> {c.Comment}</p>)}
      {!q.data?.length && <p className="text-muted-foreground">No comments yet.</p>}
    </div>
  );
}

type Tab = "work" | "entries" | "documents" | "comments" | "history";

/** One activity: the employee's work, the verifier's decision, entries, documents, comments and history. */
function ActivityEditor({ a, w, canEdit, onSaved }: { a: Activity; w: Workspace; canEdit: boolean; onSaved: () => void }) {
  const meta = useQuery({ queryKey: ["legal-verification-meta"], queryFn: getVerificationMeta, staleTime: 3600_000 });
  const users = useUsers();
  const entryCfg = useEntryConfig();
  const hasEntries = !!entryCfg.data?.[a.ActivityCode];
  const [f, setF] = useState<Record<string, string>>(() => ({
    status: a.Status, finding: a.Finding ?? "", assignedUserId: a.AssignedUserId ? String(a.AssignedUserId) : "", verifierUserId: a.VerifierUserId ? String(a.VerifierUserId) : "",
    priority: a.Priority, startDate: a.StartDate ?? "", dueDate: a.DueDate ?? "", findings: a.Findings ?? "", remarks: a.Remarks ?? "", holdReason: a.HoldReason ?? "",
    nextAction: a.NextAction ?? "", handoverNote: "", ...Object.fromEntries(GOV.map(([c]) => [govKey(c), (a as unknown as Record<string, string | null>)[c] ?? ""])),
  }));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(a.EntryCount > 0 ? "entries" : "work");
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));
  const closed = a.Status === "Closed";
  const submitted = a.Status === "Submitted for Review";
  const workEditable = canEdit && !closed && !submitted;
  const iAmVerifier = !!w.canVerify && a.AssignedUserId !== w.me && a.SubmittedBy !== w.me && (!a.VerifierUserId || a.VerifierUserId === w.me);
  const reassigning = !!a.AssignedUserId && f.assignedUserId !== String(a.AssignedUserId ?? "");

  const act = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    try { toast.success((await fn()).message); onSaved(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const save = () => act(() => updateActivity(a.ActivityId, {
    ...f, finding: f.finding || null, assignedUserId: f.assignedUserId ? Number(f.assignedUserId) : null, verifierUserId: f.verifierUserId ? Number(f.verifierUserId) : null,
    startDate: f.startDate || null, dueDate: f.dueDate || null, ...Object.fromEntries(GOV.map(([c]) => [govKey(c), f[govKey(c)] || null])), updatedAt: a.UpdatedAt,
  }));
  const submit = async () => {
    setBusy(true);
    let extra: { overrideReason?: string; exceptionReason?: string } = {};
    try {
      for (let i = 0; i < 3; i++) {
        try { toast.success((await submitActivity(a.ActivityId, { updatedAt: a.UpdatedAt, ...extra })).message); onSaved(); return; }
        catch (e) {
          const err = e as VerificationError;
          if (err.data?.needsOverride && w.canOverride) {
            const reason = await askLegal({ title: "Submit with an open dependency?", message: `${err.message}. This records a dependency override — it does not verify or waive the prerequisite.`, input: { label: "Reason for the override", required: true }, confirmText: "Override and submit" });
            if (!reason) return; extra = { ...extra, overrideReason: reason }; continue;
          }
          if (err.data?.needsException && w.canOverride) {
            const reason = await askLegal({ title: "Submit without the updated Dag sketch?", message: `${err.message}.`, input: { label: "Reason for the exception", required: true }, confirmText: "Record exception and submit" });
            if (!reason) return; extra = { ...extra, exceptionReason: reason }; continue;
          }
          toast.error(err.message); return;
        }
      }
    } finally { setBusy(false); }
  };
  const decide = async (decision: "Verified" | "Returned" | "Rejected") => {
    let remarks: string | undefined;
    if (decision !== "Verified") {
      const r = await askLegal({ title: decision === "Returned" ? "Return for correction" : "Reject the work", input: { label: decision === "Returned" ? "What must be corrected" : "Reason for rejecting", required: true }, confirmText: decision === "Returned" ? "Return" : "Reject" });
      if (!r) return; remarks = r;
    } else {
      const r = await askLegal({ title: `Verify ${a.ActivityRef}. ${a.ActivityName}?`, message: `Finding: ${a.Finding ?? "—"}. Confirm you have checked the work and its evidence.`, input: { label: "Verification remarks (optional)" }, confirmText: "Verify" });
      if (r === null) return; remarks = r || undefined;
    }
    act(() => verifyActivity(a.ActivityId, { decision, remarks, updatedAt: a.UpdatedAt }));
  };
  const naRequest = async () => {
    const reason = await askLegal({ title: "Request N/A", message: "An authorised verifier must approve it.", input: { label: "Why this activity does not apply", required: true }, confirmText: "Request" });
    if (reason) act(() => requestNa(a.ActivityId, reason, a.UpdatedAt));
  };
  const naDecide = async (approve: boolean) => {
    const r = await askLegal({ title: approve ? "Approve N/A?" : "Refuse N/A?", message: `Reason given: ${a.NaReason}`, input: { label: approve ? "Remarks (optional)" : "Why it is refused", required: !approve }, confirmText: approve ? "Approve N/A" : "Refuse" });
    if (r !== null) act(() => decideNa(a.ActivityId, approve, r || undefined, a.UpdatedAt));
  };
  const reopen = async () => {
    const r = await askLegal({ title: `Reopen ${a.ActivityRef}?`, message: `It is ${a.VerifyStatus}. History is kept.`, input: { label: "Reason", required: true }, confirmText: "Reopen" });
    if (r) act(() => reopenActivity(a.ActivityId, r, a.UpdatedAt));
  };
  const tabs: Tab[] = hasEntries ? ["entries", "work", "documents", "comments", "history"] : ["work", "documents", "comments", "history"];
  const tabLabel = (t: Tab) => (t === "entries" ? `${entryCfg.data?.[a.ActivityCode]?.plural ?? "Entries"} (${a.EntryCount})` : t === "work" ? "Work & result"
    : t === "documents" ? `Documents (${a.documents?.length ?? 0})` : t === "comments" ? "Comments" : "History");
  const naPending = !!a.NaRequestedAt && a.VerifyStatus !== "N/A" && !closed;

  return (
    <div className="border-t-2 border-foreground bg-card p-3">
      {/* Status line and the actions that move the activity on */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border border-border px-3 py-2 text-xs">
        <span>Work: <b className={STATUS_TONE[a.Status] ?? ""}>{a.Status}</b></span>
        <span>Verification: <b className={VERIFY_TONE[a.VerifyStatus] ?? ""}>{a.VerifyStatus}</b></span>
        {a.SubmittedAt && <span className="text-muted-foreground">Submitted {fmt(a.SubmittedAt)}{a.SubmittedByName ? ` · ${a.SubmittedByName}` : ""}</span>}
        {a.ReviewedByName && ["Verified", "Returned", "Rejected"].includes(a.VerifyStatus) && <span className="text-muted-foreground">{a.VerifyStatus} by {a.ReviewedByName}{a.VerifyRemarks ? ` — ${a.VerifyRemarks}` : ""}</span>}
        {naPending && <span className="font-semibold text-amber-700">N/A requested by {a.NaRequestedByName ?? "—"}: {a.NaReason}</span>}
        {a.VerifyStatus === "N/A" && <span className="text-muted-foreground">N/A: {a.NaReason} · approved by {a.NaApprovedByName ?? "—"}</span>}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {workEditable && <button disabled={busy} onClick={submit} className={`${btn} border-foreground bg-foreground text-background`}>Submit for verification</button>}
          {submitted && iAmVerifier && <>
            <button disabled={busy} onClick={() => decide("Verified")} className={`${btn} border-emerald-700 bg-emerald-700 text-white`}>Verify</button>
            <button disabled={busy} onClick={() => decide("Returned")} className={`${btn} border-foreground`}>Return</button>
            <button disabled={busy} onClick={() => decide("Rejected")} className={`${btn} border-destructive text-destructive`}>Reject</button>
          </>}
          {submitted && w.canVerify && !iAmVerifier && <span className="self-center text-muted-foreground">{a.VerifierName ? `${a.VerifierName} verifies this` : "Another verifier must verify this"}</span>}
          {naPending && w.canVerify && a.NaRequestedBy !== w.me && <>
            <button disabled={busy} onClick={() => naDecide(true)} className={`${btn} border-foreground`}>Approve N/A</button>
            <button disabled={busy} onClick={() => naDecide(false)} className={`${btn} border-foreground/40`}>Refuse N/A</button>
          </>}
          {workEditable && !naPending && <button disabled={busy} onClick={naRequest} className={`${btn} border-foreground/40`}>Request N/A</button>}
          {(closed || submitted) && w.canVerify && <button disabled={busy} onClick={reopen} className={`${btn} border-foreground/40`}>Reopen</button>}
        </span>
      </div>
      {a.dependsOn?.length ? (
        <p className={`mb-3 text-xs ${a.blocked ? "text-amber-700" : "text-muted-foreground"}`}>
          Waits for: {a.dependsOn.map((d) => `${d.ActivityNo}. ${d.ActivityName} (${d.VerifyStatus})`).join(", ")}{a.blocked ? " — submitting before they are verified needs an authorised override" : ""}
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`h-7 border px-3 text-xs font-semibold uppercase tracking-[0.06em] ${tab === t ? "border-foreground bg-foreground text-background" : "border-foreground/40"}`}>{tabLabel(t)}</button>
        ))}
        {a.Description && <span className="text-xs text-muted-foreground">{a.Description}</span>}
      </div>
      {tab === "entries" && hasEntries ? <ActivityEntriesPanel activityId={a.ActivityId} code={a.ActivityCode} canEdit={workEditable} onChanged={onSaved}
          title={`Historical ownership flowchart · ${w.VerificationNo}`} period={{ from: a.PeriodFromYear, to: a.PeriodToYear, years: a.PeriodYears }} />
        : tab === "documents" ? <VerificationDocumentsPanel verificationId={w.VerificationId} activities={w.activities} canEdit={canEdit && !closed} onlyActivityId={a.ActivityId} />
        : tab === "comments" ? <Comments activityId={a.ActivityId} />
        : tab === "history" ? <History activityId={a.ActivityId} /> : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className={lbl}>Work status</span>
              <select disabled={!workEditable} className={input} value={f.status} onChange={(e) => set("status", e.target.value)}>
                {[...new Set([f.status, ...(meta.data?.statuses ?? [])])].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label><span className={lbl}>Finding</span>
              <select disabled={!workEditable} className={input} value={f.finding} onChange={(e) => set("finding", e.target.value)}><option value="">Not recorded</option>{(meta.data?.findings ?? []).map((s) => <option key={s}>{s}</option>)}</select></label>
            <label><span className={lbl}>Employee</span>
              <select disabled={!workEditable} className={input} value={f.assignedUserId} onChange={(e) => set("assignedUserId", e.target.value)}><option value="">Not assigned</option>{(users.data ?? []).map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
            <label><span className={lbl}>Verifier</span>
              <select disabled={!workEditable} className={input} value={f.verifierUserId} onChange={(e) => set("verifierUserId", e.target.value)}><option value="">Any verifier</option>{(users.data ?? []).map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
            {reassigning && <label className="sm:col-span-2 lg:col-span-4"><span className={lbl}>Handover note <span className="text-destructive">*</span></span><input className={input} value={f.handoverNote} maxLength={800} onChange={(e) => set("handoverNote", e.target.value)} placeholder="What is done, what is left, where the papers are" /></label>}
            <label><span className={lbl}>Priority</span>
              <select disabled={!workEditable} className={input} value={f.priority} onChange={(e) => set("priority", e.target.value)}>{(meta.data?.priorities ?? [f.priority]).map((s) => <option key={s}>{s}</option>)}</select></label>
            <label><span className={lbl}>Actual start</span><input disabled={!workEditable} type="date" className={input} value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
            <label><span className={lbl}>Internal target date{a.ExpectedDays != null ? ` (estimate ${a.ExpectedDays} d)` : ""}</span><input disabled={!workEditable} type="date" className={input} value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></label>
            <div className="text-xs"><span className={lbl}>Actual completion</span>{a.CompletedDate ? fmt(a.CompletedDate) : "—"}</div>
            {GOV.map(([c, l]) => <label key={c}><span className={lbl}>{l} date</span><input disabled={!workEditable} type="date" className={input} value={f[govKey(c)]} onChange={(e) => set(govKey(c), e.target.value)} /></label>)}
            {f.status === "On Hold" && <>
              <label className="sm:col-span-2"><span className={lbl}>Hold reason <span className="text-destructive">*</span></span><input disabled={!workEditable} className={input} value={f.holdReason} onChange={(e) => set("holdReason", e.target.value)} maxLength={500} /></label>
              <label className="sm:col-span-2"><span className={lbl}>Next action <span className="text-destructive">*</span></span><input disabled={!workEditable} className={input} value={f.nextAction} onChange={(e) => set("nextAction", e.target.value)} maxLength={500} /></label>
            </>}
            <label className="sm:col-span-2"><span className={lbl}>Findings (what was searched / checked and the result)</span>
              <textarea disabled={!workEditable} rows={3} className="w-full border border-foreground/30 bg-background p-2 text-sm" value={f.findings} onChange={(e) => set("findings", e.target.value)} /></label>
            <label className="sm:col-span-2"><span className={lbl}>Employee remarks{f.finding === "Mismatched" ? <span className="text-destructive"> *</span> : null}</span>
              <textarea disabled={!workEditable} rows={3} maxLength={1000} className="w-full border border-foreground/30 bg-background p-2 text-sm" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Estimated durations and government dates are internal targets, not guaranteed government timelines.</span>
            <span className="ml-auto flex items-center gap-2">
              {a.UpdatedAt && <span className="text-muted-foreground">{a.UpdatedByName ?? ""} · {fmtTime(a.UpdatedAt)}</span>}
              {workEditable && <button disabled={busy} onClick={save} className={`${btn} border-foreground bg-foreground text-background`}>{busy ? "Saving…" : "Save"}</button>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Header({ w, canEdit, onSaved }: { w: Workspace; canEdit: boolean; onSaved: () => void }) {
  const users = useUsers();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ targetDate: w.TargetDate ?? "", leadUserId: w.LeadUserId ? String(w.LeadUserId) : "", remarks: w.Remarks ?? "" });
  const save = async () => {
    try { toast.success((await updateWorkspace(w.VerificationId, { targetDate: f.targetDate || null, leadUserId: f.leadUserId ? Number(f.leadUserId) : null, remarks: f.remarks || null })).message); setEdit(false); onSaved(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const cell = (k: string, v: React.ReactNode) => <div className="border-b border-r border-border px-2.5 py-1.5"><span className={lbl}>{k}</span><span className="text-sm">{v}</span></div>;
  const dags = [...w.rs.map((r) => `RS ${r.RsDagNo} / Kh ${r.RsKhatianNo}`), ...w.lr.map((r) => `LR ${r.LrDagNo} / Kh ${r.LrKhatianNo}`)];
  return (
    <section className="mb-4 border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span><b className="font-mono">{w.VerificationNo}</b> · Enquiry {w.EnquiryNo} <span className={`ml-2 text-xs font-semibold ${WS_TONE[w.Status] ?? ""}`}>{wsLabel(w.Status)}</span></span>
        <span className="flex items-center gap-3"><Progress w={w} />{canEdit && <button onClick={() => setEdit((x) => !x)} className="text-xs underline">{edit ? "Cancel" : "Edit"}</button>}</span>
      </header>
      <div className="grid grid-cols-2 border-l border-t border-border sm:grid-cols-4">
        {cell("Project", w.ProjectName ?? "—")}
        {cell("Mouza", [w.MouzaName, w.JLNo ? `J.L. ${w.JLNo}` : null].filter(Boolean).join(" · ") || "—")}
        {cell("Location", w.LandLocation ?? "—")}
        {cell("Area", w.ApproxArea != null ? `${w.ApproxArea} ${w.UnitName ?? ""}` : "—")}
        {cell("Owner / contact", [w.ContactPerson, w.ContactNumber].filter(Boolean).join(" · ") || "—")}
        {cell("Dag / Khatian", dags.length ? dags.join(", ") : "—")}
        {cell("Started", fmt(w.StartDate))}
        {cell("Target", fmt(w.TargetDate))}
        {cell("Lead", w.LeadName ?? "—")}
        {cell("Not yet verified", w.Total - w.Completed - w.NotApplicable - (w.Rejected ?? 0))}
        {cell("Awaiting verification", w.AwaitingVerification ?? 0)}
        {cell("Returned", <span className={w.Returned ? "font-semibold text-destructive" : ""}>{w.Returned ?? 0}</span>)}
        {cell("N/A requests", w.NaRequests ?? 0)}
        {cell("On hold", w.OnHold)}
        {cell("Overdue", <span className={w.Overdue ? "font-semibold text-destructive" : ""}>{w.Overdue}</span>)}
        {cell("Discrepancies", <span className={w.Discrepancies ? "font-semibold text-destructive" : ""}>{w.Discrepancies}</span>)}
        {cell("Need documents", w.MissingDocuments)}
        {cell("Remarks", w.Remarks ?? "—")}
      </div>
      {edit && (
        <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
          <label><span className={lbl}>Target date</span><input type="date" className={input} value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></label>
          <label><span className={lbl}>Lead</span><select className={input} value={f.leadUserId} onChange={(e) => setF({ ...f, leadUserId: e.target.value })}><option value="">—</option>{(users.data ?? []).map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
          <label><span className={lbl}>Remarks</span><input className={input} value={f.remarks} maxLength={1000} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
          <button onClick={save} className="h-9 self-end bg-foreground px-4 text-xs font-semibold uppercase text-background">Save</button>
        </div>
      )}
    </section>
  );
}

/** One enquiry's legal verification workspace. */
export default function LegalVerificationWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = usePageRights("legal-land-enquiry").canEdit;
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState("All");
  const [view, setView] = useState<"activities" | "documents">("activities");
  const ws = useQuery({ queryKey: ["legal-verification", Number(id)], queryFn: () => getWorkspace(Number(id)), enabled: !!id });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-verification"] }); qc.invalidateQueries({ queryKey: ["legal-verification-list"] });
    qc.invalidateQueries({ queryKey: ["legal-activity-history"] }); qc.invalidateQueries({ queryKey: ["legal-verification-reviews"] }); qc.invalidateQueries({ queryKey: ["legal-verification-docs"] }); };
  const w = ws.data;
  const locked = !!w && ["Closed", "Verified", "Rejected"].includes(w.Status);
  const acts = (w?.activities ?? []).filter((a) =>
    filter === "All" ? true : filter === "Open" ? !["Verified", "N/A"].includes(a.VerifyStatus) : filter === "To verify" ? a.Status === "Submitted for Review"
      : filter === "Returned" ? a.VerifyStatus === "Returned" : filter === "Overdue" ? a.overdue : filter === "On Hold" ? a.Status === "On Hold"
      : filter === "Issues" ? (!!a.Finding && BAD.includes(a.Finding)) || a.VerifyStatus === "Rejected" : true);
  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Legal verification", path: "/legal/land/verification" }, { label: w?.VerificationNo ?? "…" }]} />
      <LegalShell stage="verification" title="Legal verification workspace" subtitle="Employees do the work and submit it; a verifier verifies, returns or rejects; the Final Legal Review closes it." icon={ClipboardTick}
        action={<button onClick={() => navigate("/legal/land/verification")} className="h-9 border border-foreground px-3 text-xs font-semibold uppercase tracking-[0.06em]">All verifications</button>}>
        {ws.error ? <p className="p-6 text-destructive">{(ws.error as Error).message}</p> : !w ? <p className="p-6 text-muted-foreground">Loading…</p> : (
          <>
            <Header key={w.UpdatedAt ?? ""} w={w} canEdit={canEdit && !locked} onSaved={refresh} />
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(["activities", "documents"] as const).map((v) => (
                <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={`h-8 border px-3 text-xs font-semibold uppercase tracking-[0.06em] ${view === v ? "border-foreground bg-foreground text-background" : "border-foreground/40"}`}>
                  {v === "activities" ? `Activities (${w.activities.length})` : "Document register"}</button>
              ))}
            </div>
            {view === "documents" ? <section className="mb-4 border border-border bg-card p-3"><VerificationDocumentsPanel verificationId={w.VerificationId} activities={w.activities} canEdit={(canEdit || !!w.searchOnly) && !locked} /></section> : <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {["All", "Open", "To verify", "Returned", "Overdue", "On Hold", "Issues"].map((s) => (
                <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)} className={`h-7 border px-2.5 text-xs font-semibold ${filter === s ? "border-foreground bg-foreground text-background" : "border-foreground/40 text-muted-foreground"}`}>{s}</button>
              ))}
            </div>
            <div className="border border-border bg-card">
              <div className="hidden grid-cols-[2.5rem_2.2fr_1fr_1fr_1fr_1.1fr_1fr] gap-x-2 border-b border-border px-3 py-1.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground md:grid">
                <span>No.</span><span>Activity</span><span>Work</span><span>Verification</span><span>Finding</span><span>Employee</span><span>Target</span>
              </div>
              {acts.map((a) => {
                const isOpen = open === a.ActivityId;
                return (
                  <div key={a.ActivityId} className="border-b border-border last:border-0">
                    <button onClick={() => setOpen(isOpen ? null : a.ActivityId)} aria-expanded={isOpen}
                      className={`grid w-full grid-cols-[2.5rem_1fr] gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-primary/5 md:grid-cols-[2.5rem_2.2fr_1fr_1fr_1fr_1.1fr_1fr] md:items-center ${a.overdue ? "bg-destructive/5" : ""}`}>
                      <span className="font-mono text-xs text-muted-foreground">{a.ActivityRef}</span>
                      <span className="text-sm font-semibold">{a.ActivityName}{!a.IsMandatory && <span className="ml-1 text-[0.625rem] font-normal uppercase text-muted-foreground">optional</span>}
                        {a.blocked && <span className="ml-1 text-[0.625rem] font-normal uppercase text-amber-700">waiting</span>}
                        {a.NaRequestedAt && a.VerifyStatus !== "N/A" && a.Status !== "Closed" && <span className="ml-1 text-[0.625rem] font-normal uppercase text-amber-700">N/A requested</span>}
                        {a.EntryCount > 0 && <span className="ml-1 text-[0.625rem] font-normal text-muted-foreground">· {a.EntryCount} entr{a.EntryCount === 1 ? "y" : "ies"}</span>}</span>
                      <span className={`col-start-2 text-xs font-semibold md:col-start-auto ${STATUS_TONE[a.Status] ?? ""}`}>{a.Status}</span>
                      <span className={`col-start-2 text-xs font-semibold md:col-start-auto ${VERIFY_TONE[a.VerifyStatus] ?? ""}`}>{a.VerifyStatus}</span>
                      <span className={`col-start-2 text-xs md:col-start-auto ${a.Finding && BAD.includes(a.Finding) ? "font-semibold text-destructive" : ""}`}>{a.Finding ?? "—"}</span>
                      <span className="col-start-2 text-xs md:col-start-auto">{a.AssignedName ?? <span className="text-muted-foreground">Not assigned</span>}</span>
                      <span className={`col-start-2 text-xs md:col-start-auto ${a.overdue ? "font-semibold text-destructive" : ""}`}>{a.DueDate ? fmt(a.DueDate) : "No target"}{a.overdue ? " · overdue" : ""}</span>
                    </button>
                    {isOpen && <ActivityEditor key={a.UpdatedAt ?? a.ActivityId} a={a} w={w} canEdit={(canEdit || (!!w.searchOnly && a.Department === "Search")) && !locked} onSaved={refresh} />}
                  </div>
                );
              })}
              {!acts.length && <p className="p-4 text-sm text-muted-foreground">Nothing here.</p>}
            </div>
            </>}
            <VerificationReviewPanel w={w} onSaved={refresh} />
          </>
        )}
      </LegalShell>
    </>
  );
}
