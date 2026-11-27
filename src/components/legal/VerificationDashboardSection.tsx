import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getVerificationDashboard } from "@/api/legalVerificationApi";
import { getPreReg } from "@/api/legalIntelApi";

/** Legal dashboard (V2.1): verification, review, approval and post-registration counts and the workload (follows the project picker). */
export function VerificationDashboardSection({ project }: { project: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["legal-verification-dashboard", project], queryFn: () => getVerificationDashboard(project), staleTime: 60_000 });
  // Pre-registration compliance (classification & conversion) counts.
  const pre = useQuery({ queryKey: ["legal-prereg", project], queryFn: () => getPreReg(project), staleTime: 60_000 });
  const d = q.data;
  if (!d) return null;
  const pc = pre.data?.counts;
  const V = "/legal/land/verification", R = "/legal/verification/reports";
  const tiles: [string, number, string, string?][] = [
    ["Land enquiries", d.enquiries, "/legal/land/enquiries"],
    ["Pending legal verification", d.pendingVerification, V],
    ["Activities in progress", d.inProgress, V],
    ["Awaiting reports", d.awaitingReports, V],
    ["Awaiting verification", d.awaitingVerification, "/legal/my-tasks", d.awaitingVerification ? "text-violet-700" : undefined],
    ["Returned activities", d.returned, V, d.returned ? "text-destructive" : undefined],
    ["Overdue activities", d.overdueActivities, R, d.overdueActivities ? "text-destructive" : undefined],
    ["On hold", d.onHoldActivities, V, d.onHoldActivities ? "text-amber-700" : undefined],
    ["Final Legal Review pending", d.finalReviewPending, V, d.finalReviewPending ? "text-violet-700" : undefined],
    ["Land Approval pending", d.landApprovalPending, "/legal/approvals"],
    ["LA / ULC pending", d.laUlcPending, R],
    ["Mutation pending", d.pendingMutation, "/legal/land/post-registration"],
    ["Post-reg conversion pending", d.pendingConversion, "/legal/land/post-registration"],
    ...(pc ? [
      ["Pre-reg conversion pending", pc.prePending, "/legal/land/pre-registration", pc.prePending ? "text-amber-700" : undefined],
      ["Pre-reg conversion overdue", pc.preOverdue, "/legal/land/pre-registration", pc.preOverdue ? "text-destructive" : undefined],
      ["Conversion order to verify", pc.orderVerificationPending, "/legal/land/pre-registration", pc.orderVerificationPending ? "text-violet-700" : undefined],
      ["Registration blocked (conversion)", pc.registrationBlocked, "/legal/land/pre-registration", pc.registrationBlocked ? "text-destructive" : undefined],
      ["N/A conversion — approval pending", pc.notApplicablePending, "/legal/land/pre-registration"],
    ] as [string, number, string, string?][] : []),
    ["Legally approved", d.verified, V, "text-emerald-700"],
  ];
  const max = Math.max(1, ...d.byActivity.map((a) => a.open));
  const maxE = Math.max(1, ...d.byEmployee.map((a) => a.open));
  const bar = (open: number, overdue: number, m: number) => (
    <span className="flex h-3"><span className="h-full bg-destructive" style={{ width: `${(overdue / m) * 100}%` }} /><span className="h-full bg-foreground/70" style={{ width: `${((open - overdue) / m) * 100}%` }} /></span>
  );
  return (
    <section className="border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <b className="text-sm">Legal verification</b>
        <span className="flex gap-3 text-xs"><button className="underline" onClick={() => navigate("/legal/my-tasks")}>My tasks</button><button className="underline" onClick={() => navigate(R)}>Reports</button></span>
      </header>
      <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map(([label, n, path, tone]) => (
          <button key={label} onClick={() => navigate(path)} className="border-b border-r border-border px-3 py-2 text-left hover:bg-primary/5">
            <span className="block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
            <b className={`text-xl tabular-nums ${tone ?? ""}`}>{n}</b>
          </button>
        ))}
      </div>
      <div className="grid gap-4 p-3 lg:grid-cols-2">
        {d.byActivity.length > 0 && (
          <div>
            <p className="mb-2 text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">Not yet verified, by activity (red = overdue)</p>
            <ul className="space-y-1">
              {d.byActivity.map((a) => (
                <li key={a.no} className="grid grid-cols-[minmax(0,14rem)_1fr_3rem] items-center gap-2 text-xs">
                  <span className="truncate">{a.no}. {a.name}</span>{bar(a.open, a.overdue, max)}<span className="text-right tabular-nums">{a.open}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.byEmployee.length > 0 && (
          <div>
            <p className="mb-2 text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">Employee-wise open work (red = overdue)</p>
            <ul className="space-y-1">
              {d.byEmployee.map((a) => (
                <li key={a.name} className="grid grid-cols-[minmax(0,12rem)_1fr_3rem] items-center gap-2 text-xs">
                  <span className="truncate">{a.name}</span>{bar(a.open, a.overdue, maxE)}<span className="text-right tabular-nums">{a.open}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
