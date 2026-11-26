import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardTick } from "iconsax-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePaged } from "@/components/legal/usePaged";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalLookup } from "@/api/legalMastersApi";
import { getStartableEnquiries, getVerifications, startVerification, type VerificationSummary } from "@/api/legalVerificationApi";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const input = "h-9 w-full border border-foreground/30 bg-background px-2 text-sm focus:border-foreground focus:outline-none";
export const WS_TONE: Record<string, string> = { "In Progress": "text-sky-700", "Ready for Review": "text-violet-700", Verified: "text-emerald-700", Returned: "text-destructive", Rejected: "text-destructive", "On Hold": "text-amber-700", Closed: "text-muted-foreground" };
/** Workspace status as people read it ("Verified" = the Final Legal Review is approved). */
export const wsLabel = (s: string) => (s === "Verified" ? "Legally approved" : s === "Ready for Review" ? "Final review pending" : s);

/** Start a workspace for an enquiry that has none yet. */
function StartPanel({ onDone }: { onDone: (id: number) => void }) {
  const enquiries = useQuery({ queryKey: ["legal-verification-startable"], queryFn: getStartableEnquiries });
  const users = useQuery({ queryKey: ["legal-lookup", "user"], queryFn: () => getLegalLookup("user"), staleTime: 600_000 });
  const [f, setF] = useState({ enquiryId: "", targetDate: "", leadUserId: "" });
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (!f.enquiryId) { toast.error("Choose an enquiry"); return; }
    setBusy(true);
    try {
      const r = await startVerification({ enquiryId: Number(f.enquiryId), targetDate: f.targetDate || undefined, leadUserId: f.leadUserId ? Number(f.leadUserId) : null });
      toast.success(r.message);
      onDone(r.verificationId);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mb-4 border-2 border-foreground bg-card p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]">Start legal verification</p>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <select className={input} value={f.enquiryId} onChange={(e) => setF({ ...f, enquiryId: e.target.value })} aria-label="Enquiry">
          <option value="">{enquiries.isLoading ? "Loading…" : enquiries.data?.length ? "Choose an enquiry…" : "No enquiry waiting"}</option>
          {(enquiries.data ?? []).map((e) => <option key={e.EnquiryId} value={e.EnquiryId}>{e.EnquiryNo} · {[e.MouzaName, e.LandLocation, e.ProjectName].filter(Boolean).join(" · ")} ({e.EnquiryStatus})</option>)}
        </select>
        <label className="text-xs"><span className="sr-only">Target date</span><input type="date" className={input} value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} title="Target completion date" /></label>
        <select className={input} value={f.leadUserId} onChange={(e) => setF({ ...f, leadUserId: e.target.value })} aria-label="Lead">
          <option value="">Lead (optional)…</option>{(users.data ?? []).map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
        <button disabled={busy} onClick={start} className="h-9 bg-foreground px-4 text-xs font-semibold uppercase tracking-[0.06em] text-background disabled:opacity-40">{busy ? "Starting…" : "Start"}</button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Every active activity in Setup → Verification Activities is created, with due dates from its expected duration.</p>
    </div>
  );
}

export function Progress({ w }: { w: Pick<VerificationSummary, "Total" | "Completed" | "NotApplicable"> }) {
  const done = w.Completed + w.NotApplicable;
  const pct = w.Total ? Math.round((done / w.Total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={`${done} of ${w.Total} resolved`}>
      <div className="h-2 w-28 border border-foreground/40"><div className="h-full bg-foreground" style={{ width: `${pct}%` }} /></div>
      <span className="text-xs tabular-nums">{done}/{w.Total}</span>
    </div>
  );
}

/** Legal verification: one workspace per land enquiry, with the verification activities. */
export default function LegalVerificationListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const rights = usePageRights("legal-land-enquiry");
  const [starting, setStarting] = useState(false);
  const list = usePaged(["legal-verification-list"], (qs) => getVerifications(qs));
  const items = list.data?.items ?? [];
  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Legal verification" }]} />
      <LegalShell stage="verification" title="Legal verification" subtitle="Every legal check on an enquiry, tracked activity by activity: who does it, by when, what was found." icon={ClipboardTick}
        action={rights.canCreate ? <button onClick={() => setStarting((s) => !s)} className="h-9 border border-foreground bg-foreground px-4 text-xs font-semibold uppercase tracking-[0.06em] text-background">{starting ? "Close" : "+ Start verification"}</button> : undefined}>
        {starting && <StartPanel onDone={(id) => { qc.invalidateQueries({ queryKey: ["legal-verification-list"] }); navigate(`/legal/land/verification/${id}`); }} />}
        {list.search("Search verification, enquiry, mouza…")}
        {list.error ? <p className="p-6 text-destructive">{(list.error as Error).message}</p> : list.isLoading ? <p className="p-6 text-muted-foreground">Loading…</p> : !items.length ? (
          <p className="border border-border p-6 text-sm text-muted-foreground">No verification started yet. Use Start verification to open one for an enquiry.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((w) => (
              <button key={w.VerificationId} onClick={() => navigate(`/legal/land/verification/${w.VerificationId}`)} className="border border-border bg-card p-3 text-left hover:border-foreground">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><b className="font-mono">{w.VerificationNo}</b> <span className="text-xs text-muted-foreground">· {w.EnquiryNo}</span></span>
                  <span className={`text-xs font-semibold ${WS_TONE[w.Status] ?? ""}`}>{wsLabel(w.Status)}</span>
                </div>
                <p className="mt-1 truncate text-sm">{[w.MouzaName, w.LandLocation].filter(Boolean).join(" · ") || "—"}</p>
                <p className="text-xs text-muted-foreground">{w.ProjectName ?? "No project"} · started {fmt(w.StartDate)}{w.TargetDate ? ` · target ${fmt(w.TargetDate)}` : ""}{w.LeadName ? ` · lead ${w.LeadName}` : ""}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Progress w={w} />
                  {w.Overdue > 0 && <span className="text-xs font-semibold text-destructive">{w.Overdue} overdue</span>}
                  {w.OnHold > 0 && <span className="text-xs font-semibold text-amber-700">{w.OnHold} on hold</span>}
                  {w.Discrepancies > 0 && <span className="text-xs font-semibold text-destructive">{w.Discrepancies} discrepanc{w.Discrepancies === 1 ? "y" : "ies"}</span>}
                  {w.MissingDocuments > 0 && <span className="text-xs font-semibold text-amber-700">{w.MissingDocuments} need documents</span>}
                  {(w.AwaitingVerification ?? 0) > 0 && <span className="text-xs font-semibold text-violet-700">{w.AwaitingVerification} to verify</span>}
                  {(w.Returned ?? 0) > 0 && <span className="text-xs font-semibold text-destructive">{w.Returned} returned</span>}
                </div>
              </button>
            ))}
          </div>
        )}
        {list.pager}
      </LegalShell>
    </>
  );
}
