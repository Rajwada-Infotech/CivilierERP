import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardTick } from "iconsax-react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { askLegal } from "@/components/legal/LegalAsk";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalLookup, uploadLegalFile } from "@/api/legalMastersApi";
import {
  addActivityDocument, getActivityHistory, getVerificationMeta, getWorkspace, updateActivity, updateWorkspace, VerificationError,
  type Activity, type Workspace,
} from "@/api/legalVerificationApi";
import { Progress, WS_TONE } from "./LegalVerificationListPage";
import { ActivityEntriesPanel, useEntryConfig } from "@/components/legal/ActivityEntriesPanel";

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtTime = (d: string) => new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const input = "h-9 w-full border border-foreground/30 bg-background px-2 text-sm focus:border-foreground focus:outline-none";
const lbl = "mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground";
export const STATUS_TONE: Record<string, string> = {
  Completed: "text-emerald-700", "Not Applicable": "text-muted-foreground", "On Hold": "text-amber-700", Rejected: "text-destructive",
  "In Progress": "text-sky-700", Applied: "text-sky-700", "Report Pending": "text-sky-700", Pending: "text-foreground", "Not Started": "text-muted-foreground",
};
const BAD = ["Mismatched", "Discrepancy Found", "Additional Documents Required", "Unable to Verify"];

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
          {r.OldAssignee !== r.NewAssignee && (r.NewAssignee || r.OldAssignee) && <> · assignee {r.OldAssignee ?? "—"} → <b>{r.NewAssignee ?? "—"}</b></>}
          {r.Remarks && <span className="block">{r.Remarks}</span>}
          {r.FileId && <LegalFileLink id={r.FileId} name={r.FileName ?? "Document"} />}
        </li>
      ))}
    </ol>
  );
}

/** One activity opened for editing: status, finding, people, dates, findings, documents, history. */
function ActivityEditor({ a, canEdit, canOverride, onSaved }: { a: Activity; canEdit: boolean; canOverride: boolean; onSaved: () => void }) {
  const meta = useQuery({ queryKey: ["legal-verification-meta"], queryFn: getVerificationMeta, staleTime: 3600_000 });
  const users = useUsers();
  const [f, setF] = useState({
    status: a.Status, finding: a.Finding ?? "", assignedUserId: a.AssignedUserId ? String(a.AssignedUserId) : "", priority: a.Priority,
    startDate: a.StartDate ?? "", dueDate: a.DueDate ?? "", findings: a.Findings ?? "", remarks: a.Remarks ?? "", holdReason: a.HoldReason ?? "", nextAction: a.NextAction ?? "",
  });
  const [busy, setBusy] = useState(false);
  const entryCfg = useEntryConfig();
  const hasEntries = !!entryCfg.data?.[a.ActivityCode];
  const [tab, setTab] = useState<"entries" | "details" | "history">(a.EntryCount > 0 ? "entries" : "details");
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));

  const send = async (overrideReason?: string) => {
    const body = { ...f, finding: f.finding || null, assignedUserId: f.assignedUserId ? Number(f.assignedUserId) : null, startDate: f.startDate || null, dueDate: f.dueDate || null, updatedAt: a.UpdatedAt, overrideReason };
    return updateActivity(a.ActivityId, body);
  };
  const save = async () => {
    setBusy(true);
    try {
      toast.success((await send()).message);
      onSaved();
    } catch (e) {
      const err = e as VerificationError;
      if (err.data?.needsOverride && canOverride) {
        const reason = await askLegal({ title: "Complete with an open dependency?", message: `${err.message}. Completing now is recorded as an override.`, input: { label: "Reason for the override", required: true }, confirmText: "Override and save" });
        if (reason) {
          try { toast.success((await send(reason)).message); onSaved(); } catch (e2) { toast.error((e2 as Error).message); }
        }
      } else toast.error(err.message);
    } finally { setBusy(false); }
  };
  const attach = () => {
    const el = document.createElement("input");
    el.type = "file"; el.accept = "application/pdf,image/*";
    el.onchange = async () => {
      const file = el.files?.[0];
      if (!file) return;
      try {
        const up = await uploadLegalFile(file);
        toast.success((await addActivityDocument(a.ActivityId, { fileId: up.id, title: up.fileName })).message);
        onSaved();
      } catch (e) { toast.error((e as Error).message); }
    };
    el.click();
  };
  const ro = !canEdit;

  return (
    <div className="border-t-2 border-foreground bg-card p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {((hasEntries ? ["entries", "details", "history"] : ["details", "history"]) as ("entries" | "details" | "history")[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`h-7 border px-3 text-xs font-semibold uppercase tracking-[0.06em] ${tab === t ? "border-foreground bg-foreground text-background" : "border-foreground/40"}`}>
            {t === "entries" ? `${entryCfg.data?.[a.ActivityCode]?.plural ?? "Entries"} (${a.EntryCount})` : t === "details" ? "Status & result" : "History"}
          </button>
        ))}
        {a.Description && <span className="text-xs text-muted-foreground">{a.Description}</span>}
      </div>
      {tab === "entries" && hasEntries ? <ActivityEntriesPanel activityId={a.ActivityId} code={a.ActivityCode} canEdit={canEdit} onChanged={onSaved} />
        : tab === "history" ? <History activityId={a.ActivityId} /> : (
        <>
          {a.dependsOn?.length ? (
            <p className={`mb-3 text-xs ${a.blocked ? "text-amber-700" : "text-muted-foreground"}`}>
              Waits for: {a.dependsOn.map((d) => `${d.ActivityNo}. ${d.ActivityName} (${d.Status})`).join(", ")}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className={lbl}>Status</span>
              <select disabled={ro} className={input} value={f.status} onChange={(e) => set("status", e.target.value)}>{(meta.data?.statuses ?? [f.status]).map((s) => <option key={s}>{s}</option>)}</select></label>
            <label><span className={lbl}>Finding</span>
              <select disabled={ro} className={input} value={f.finding} onChange={(e) => set("finding", e.target.value)}><option value="">Not recorded</option>{(meta.data?.findings ?? []).map((s) => <option key={s}>{s}</option>)}</select></label>
            <label><span className={lbl}>Assigned to</span>
              <select disabled={ro} className={input} value={f.assignedUserId} onChange={(e) => set("assignedUserId", e.target.value)}><option value="">Not assigned</option>{(users.data ?? []).map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
            <label><span className={lbl}>Priority</span>
              <select disabled={ro} className={input} value={f.priority} onChange={(e) => set("priority", e.target.value)}>{(meta.data?.priorities ?? [f.priority]).map((s) => <option key={s}>{s}</option>)}</select></label>
            <label><span className={lbl}>Start date</span><input disabled={ro} type="date" className={input} value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
            <label><span className={lbl}>Due date{a.ExpectedDays != null ? ` (expected ${a.ExpectedDays} d)` : ""}</span><input disabled={ro} type="date" className={input} value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></label>
            <div className="text-xs sm:col-span-2"><span className={lbl}>Completed</span>{a.CompletedDate ? `${fmt(a.CompletedDate)}${a.ReviewedByName ? ` · ${a.ReviewedByName}` : ""}` : "—"}</div>
            {f.status === "On Hold" && <>
              <label className="sm:col-span-2"><span className={lbl}>Hold reason <span className="text-destructive">*</span></span><input disabled={ro} className={input} value={f.holdReason} onChange={(e) => set("holdReason", e.target.value)} maxLength={500} /></label>
              <label className="sm:col-span-2"><span className={lbl}>Next action <span className="text-destructive">*</span></span><input disabled={ro} className={input} value={f.nextAction} onChange={(e) => set("nextAction", e.target.value)} maxLength={500} /></label>
            </>}
            <label className="sm:col-span-2"><span className={lbl}>Findings (what was searched / checked and the result)</span>
              <textarea disabled={ro} rows={3} className="w-full border border-foreground/30 bg-background p-2 text-sm" value={f.findings} onChange={(e) => set("findings", e.target.value)} /></label>
            <label className="sm:col-span-2"><span className={lbl}>Remarks{f.status === "Rejected" || f.finding === "Mismatched" ? <span className="text-destructive"> *</span> : null}</span>
              <textarea disabled={ro} rows={3} maxLength={1000} className="w-full border border-foreground/30 bg-background p-2 text-sm" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span className={lbl + " mb-0"}>Documents</span>
            {(a.documents ?? []).map((d) => <LegalFileLink key={d.DocId} id={d.FileId} name={d.Title || d.FileName || "Document"} />)}
            {!a.documents?.length && <span className="text-muted-foreground">None</span>}
            {canEdit && <button onClick={attach} className="inline-flex items-center gap-1 underline"><Upload size={11} /> Attach</button>}
            <span className="ml-auto flex items-center gap-2">
              {a.UpdatedAt && <span className="text-muted-foreground">{a.UpdatedByName ?? ""} · {fmtTime(a.UpdatedAt)}</span>}
              {canEdit && <button disabled={busy} onClick={save} className="h-8 border border-foreground bg-foreground px-4 font-semibold uppercase tracking-[0.06em] text-background disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>}
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
        <span><b className="font-mono">{w.VerificationNo}</b> · Enquiry {w.EnquiryNo} <span className={`ml-2 text-xs font-semibold ${WS_TONE[w.Status] ?? ""}`}>{w.Status}</span></span>
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
        {cell("Pending", w.Total - w.Completed - w.NotApplicable)}
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
  const ws = useQuery({ queryKey: ["legal-verification", Number(id)], queryFn: () => getWorkspace(Number(id)), enabled: !!id });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-verification"] }); qc.invalidateQueries({ queryKey: ["legal-verification-list"] }); qc.invalidateQueries({ queryKey: ["legal-activity-history"] }); };
  const w = ws.data;
  const acts = (w?.activities ?? []).filter((a) =>
    filter === "All" ? true : filter === "Open" ? !["Completed", "Not Applicable"].includes(a.Status) : filter === "Overdue" ? a.overdue
      : filter === "On Hold" ? a.Status === "On Hold" : filter === "Issues" ? !!a.Finding && BAD.includes(a.Finding) : true);
  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Legal verification", path: "/legal/land/verification" }, { label: w?.VerificationNo ?? "…" }]} />
      <LegalShell stage="verification" title="Legal verification workspace" subtitle="Open an activity to update its status, finding, assignee, dates and documents." icon={ClipboardTick}
        action={<button onClick={() => navigate("/legal/land/verification")} className="h-9 border border-foreground px-3 text-xs font-semibold uppercase tracking-[0.06em]">All verifications</button>}>
        {ws.error ? <p className="p-6 text-destructive">{(ws.error as Error).message}</p> : !w ? <p className="p-6 text-muted-foreground">Loading…</p> : (
          <>
            <Header key={w.UpdatedAt ?? ""} w={w} canEdit={canEdit} onSaved={refresh} />
            <div className="mb-2 flex flex-wrap gap-1.5">
              {["All", "Open", "Overdue", "On Hold", "Issues"].map((s) => (
                <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)} className={`h-7 border px-2.5 text-xs font-semibold ${filter === s ? "border-foreground bg-foreground text-background" : "border-foreground/40 text-muted-foreground"}`}>{s}</button>
              ))}
            </div>
            <div className="border border-border bg-card">
              {acts.map((a) => {
                const isOpen = open === a.ActivityId;
                return (
                  <div key={a.ActivityId} className="border-b border-border last:border-0">
                    <button onClick={() => setOpen(isOpen ? null : a.ActivityId)} aria-expanded={isOpen}
                      className={`grid w-full grid-cols-[2rem_1fr] gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-primary/5 md:grid-cols-[2rem_2.4fr_1fr_1.2fr_1.2fr_1fr] md:items-center ${a.overdue ? "bg-destructive/5" : ""}`}>
                      <span className="font-mono text-xs text-muted-foreground">{a.ActivityNo}</span>
                      <span className="text-sm font-semibold">{a.ActivityName}{!a.IsMandatory && <span className="ml-1 text-[0.625rem] font-normal uppercase text-muted-foreground">optional</span>}
                        {a.blocked && <span className="ml-1 text-[0.625rem] font-normal uppercase text-amber-700">waiting</span>}
                        {a.EntryCount > 0 && <span className="ml-1 text-[0.625rem] font-normal text-muted-foreground">· {a.EntryCount} entr{a.EntryCount === 1 ? "y" : "ies"}</span>}</span>
                      <span className={`col-start-2 text-xs font-semibold md:col-start-auto ${STATUS_TONE[a.Status] ?? ""}`}>{a.Status}</span>
                      <span className={`col-start-2 text-xs md:col-start-auto ${a.Finding && BAD.includes(a.Finding) ? "font-semibold text-destructive" : ""}`}>{a.Finding ?? "—"}</span>
                      <span className="col-start-2 text-xs md:col-start-auto">{a.AssignedName ?? <span className="text-muted-foreground">Not assigned</span>}</span>
                      <span className={`col-start-2 text-xs md:col-start-auto ${a.overdue ? "font-semibold text-destructive" : ""}`}>{a.DueDate ? `Due ${fmt(a.DueDate)}` : "No due date"}{a.overdue ? " · overdue" : ""}</span>
                    </button>
                    {isOpen && <ActivityEditor key={a.UpdatedAt ?? a.ActivityId} a={a} canEdit={canEdit && w.Status !== "Closed"} canOverride={w.canOverride} onSaved={refresh} />}
                  </div>
                );
              })}
              {!acts.length && <p className="p-4 text-sm text-muted-foreground">Nothing here.</p>}
            </div>
          </>
        )}
      </LegalShell>
    </>
  );
}
