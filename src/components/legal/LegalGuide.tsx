import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, X } from "lucide-react";
import { getLegalRows } from "@/api/legalMastersApi";
import { getReportList } from "@/api/legalVerificationApi";

/**
 * "How it works" — the Legal module's working flow, opened from the Legal dashboard.
 * KEEP THIS IN STEP WITH THE MODULE: when a Legal screen, status, rule or step changes, update STEPS below in the
 * same change. The activity list, durations, dependencies, reminder days and the report list are read live from
 * Setup / the server, so they never go out of date.
 */
const GUIDE_UPDATED = "26 Nov 2026 · Legal V2.1";

type Step = { title: string; where?: string; points: string[] };
const STEPS: Step[] = [
  { title: "Setup (admin / Legal Admin)", where: "Setup → Legal masters", points: [
    "Locations: District, Sub-division, Block, Police Station, Municipality, Village, Mouza (J.L. no.).",
    "Registration offices (ADSR, DSR, RA, BLRO), RS Khatian, RS Plot and LR RoR registers.",
    "Area units, land types, document and deed types, lookup lists; persons and advocates.",
    "Approval Control: Verifier, Approver, L1 / L2 Approver, Legal Reviewer, Amendment Approver, Legal Admin, Search Executive.",
    "Verification Activities, Activity Dependencies, Activity Reminder Days and Legal Rules (see the live lists below).",
  ] },
  { title: "Land Enquiry", where: "Pipeline → 1", points: [
    "Record the offer: project, mouza, Dag / Khatian, area, owner contact, price, source. A duplicate Dag / Khatian is warned.",
    "Status: New → Under Review → Interested / On Hold / Rejected → Converted to Land Record. Verifiers are notified.",
  ] },
  { title: "Deed search", where: "Pipeline → 2", points: [
    "Each registry office gets a timeline with a due date; every year 1956 → today is marked Found / Not Found / Not Applicable.",
    "An office is completed once every year is searched. Due-soon and overdue reminders.",
  ] },
  { title: "Legal verification", where: "Pipeline → 3", points: [
    "Start a workspace for an enquiry: every active activity is created with a target date (internal, not a government timeline).",
    "Employee: assign employee and verifier (different people), set the work status (In Progress, Applied, Report Pending, On Hold with reason and next action), add the activity's entries, link documents in the register, record the finding and government dates.",
    "Submit for verification: needs the finding; open dependencies need an authorised override with a reason (recorded, not a verification); Mouza map needs the updated Dag sketch or an exception.",
    "Verifier: Verify, Return (remarks) or Reject (reason) — never their own work. N/A is requested with a reason and approved by another user. Reopen needs a reason; history is kept.",
    "Uploading a document never verifies it — the verifier verifies or rejects each document; a replaced file becomes a new version.",
  ] },
  { title: "Final Legal Review", where: "Bottom of the workspace (Legal Reviewer)", points: [
    "Opens when every mandatory activity is Verified, N/A or Rejected.",
    "12-point checklist, legal risks (required with discrepancies or exceptions); Approve, Return, Additional Documents, Further Investigation or Reject.",
    "Each decision is a numbered, fingerprinted version that cannot change; Approve locks the workspace and tells the Approvers.",
  ] },
  { title: "Land record and field verification", where: "Lands → Land Profile", points: [
    "Converting the enquiry creates the land; fill every section (owners, history, inheritance, records, cases, mortgage, transaction, payments, valuation, tax, documents).",
    "Send for verification: the Verifier marks each field ✓ / ✗ / N/A, sends back or saves a version.",
  ] },
  { title: "Land Approval", where: "Approvals", points: [
    "The Approver approves (→ Deed Process) or sends back.",
    "Refused until the Final Legal Review is approved, unless an authorised user records an exception (rule final_review_gate).",
  ] },
  { title: "Deed Process", where: "Pipeline → 5", points: [
    "Deed stage (Drafting → Under Review → Clearance Pending → Ready for Approval), drafter, target date, deed copy.",
    "Submit for final approval → L1 → L2.",
  ] },
  { title: "LA & ULC", where: "Pipeline → 6", points: ["Each clearance on its own: application, queries, report, certificate, expiry. Submitting is not a clearance."] },
  { title: "Deed Registration", where: "Pipeline → 7", points: [
    "Consideration, payment schedule and payments, stamp duty and fees, appointment, attempt, registered deed no. and copy, IGR / deed-location tracking.",
    "Registered land is locked; changes go through an amendment.",
  ] },
  { title: "Post-registration", where: "Pipeline → 8", points: [
    "Tasks with employee, due date and status.",
    "Mutation and Conversion tracked separately (application, office, employee, target, hearing, status, query log). Conversion waits for an approved mutation (rule conversion_after_mutation).",
  ] },
  { title: "Amendments", where: "Land Profile → Amendments", points: ["Request with type and reason → Amendment Approver approves → new version → verified again."] },
  { title: "Every day", points: [
    "My tasks: your work by due date, work returned to you, and work waiting for your verification.",
    "Reminders tab and notifications (assignment, due / overdue, report received, submitted, returned, final review and land approval pending). Overdue work escalates to the lead and Legal Admins.",
    "Dashboard counts and workload; Verification reports with dropdown filters and PDF / Excel export; Land Flowchart for each land's journey.",
    "Rules everywhere: you see only your projects; the maker is never the checker; a second save over someone's change is refused; history is never deleted; registered records are locked.",
  ] },
];

type Row = Record<string, unknown>;
function LiveSetup() {
  const acts = useQuery({ queryKey: ["legal-guide", "activities"], queryFn: () => getLegalRows("verification-activity"), staleTime: 300_000, retry: false });
  const deps = useQuery({ queryKey: ["legal-guide", "deps"], queryFn: () => getLegalRows("activity-dependency"), staleTime: 300_000, retry: false });
  const rem = useQuery({ queryKey: ["legal-guide", "reminders"], queryFn: () => getLegalRows("activity-reminder"), staleTime: 300_000, retry: false });
  const reps = useQuery({ queryKey: ["legal-report-list"], queryFn: getReportList, staleTime: 3600_000, retry: false });
  const active = ((acts.data ?? []) as Row[]).filter((a) => a.IsActive).sort((a, b) => Number(a.SortOrder ?? Number(a.ActivityNo) * 10) - Number(b.SortOrder ?? Number(b.ActivityNo) * 10));
  const waitsFor = (id: unknown) => ((deps.data ?? []) as Row[]).filter((d) => d.IsActive && d.TemplateId === id).map((d) => String(d.DependsOnTemplateId__label ?? ""));
  const days = ((rem.data ?? []) as Row[]).filter((r) => r.IsActive).map((r) => Number(r.DaysBefore)).sort((a, b) => b - a);
  return (
    <>
      <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-[0.08em]">Verification activities <span className="font-normal normal-case text-muted-foreground">(live from Setup)</span></h3>
      {acts.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : !active.length ? <p className="text-xs text-muted-foreground">Not available to you.</p> : (
        <table className="w-full text-left text-xs">
          <thead className="text-[0.625rem] uppercase tracking-wider text-muted-foreground"><tr><th className="py-1 pr-2">No.</th><th className="py-1 pr-2">Activity</th><th className="py-1 pr-2">Days</th><th className="py-1 pr-2">Stage</th><th className="py-1">Waits for</th></tr></thead>
          <tbody>
            {active.map((a) => (
              <tr key={String(a.TemplateId)} className="border-t border-border/60 align-top">
                <td className="py-1 pr-2 font-mono">{String(a.DisplayNo ?? a.ActivityNo)}</td>
                <td className="py-1 pr-2">{String(a.ActivityName)}{!a.IsMandatory && <span className="ml-1 text-muted-foreground">(optional)</span>}</td>
                <td className="py-1 pr-2">{a.DefaultDays != null ? String(a.DefaultDays) : "—"}</td>
                <td className="py-1 pr-2">{String(a.Stage ?? "")}</td>
                <td className="py-1">{waitsFor(a.TemplateId).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {days.length > 0 && <p className="mt-2 text-xs">Reminders to the employee: {days.map((d) => (d === 0 ? "on the due date" : `${d} day${d === 1 ? "" : "s"} before`)).join(", ")}, then daily when overdue.</p>}
      {(reps.data?.length ?? 0) > 0 && <>
        <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-[0.08em]">Reports <span className="font-normal normal-case text-muted-foreground">(live)</span></h3>
        <ol className="list-decimal space-y-0.5 pl-5 text-xs">{reps.data!.map((r) => <li key={r.key}>{r.title}</li>)}</ol>
      </>}
    </>
  );
}

/** Small corner button that opens the working flow of the Legal module in a side panel. */
export function LegalGuideButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <>
      <button onClick={() => setOpen(true)} title="How the Legal module works" aria-label="How the Legal module works"
        className="inline-flex h-9 items-center gap-1.5 border border-foreground/40 px-3 text-xs font-semibold uppercase tracking-[0.06em] hover:border-foreground">
        <BookOpen size={14} /> <span className="hidden sm:inline">How it works</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside role="dialog" aria-label="How the Legal module works" onClick={(e) => e.stopPropagation()}
            className="h-full w-full max-w-2xl overflow-y-auto border-l-2 border-foreground bg-card p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">How the Legal module works</h2>
                <p className="text-xs text-muted-foreground">Step by step, enquiry to post-registration · updated {GUIDE_UPDATED}</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="border border-foreground/40 p-1.5 hover:border-foreground"><X size={16} /></button>
            </div>
            <p className="mb-3 border border-border bg-muted/30 px-3 py-2 text-xs">
              Flow: Enquiry → Deed search → Legal verification → Final Legal Review → Land record → Land Approval → Deed Process → LA &amp; ULC → Deed Registration → Post-registration.
            </p>
            <ol className="space-y-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="border-l-2 border-foreground/30 pl-3">
                  <p className="text-sm font-semibold">{i}. {s.title}{s.where && <span className="ml-2 text-xs font-normal text-muted-foreground">{s.where}</span>}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
                </li>
              ))}
            </ol>
            <LiveSetup />
          </aside>
        </div>
      )}
    </>
  );
}
