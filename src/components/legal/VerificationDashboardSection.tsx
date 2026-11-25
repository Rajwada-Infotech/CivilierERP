import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getVerificationDashboard } from "@/api/legalVerificationApi";

/** Legal dashboard: where legal verification stands (follows the project picker). */
export function VerificationDashboardSection({ project }: { project: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["legal-verification-dashboard", project], queryFn: () => getVerificationDashboard(project), staleTime: 60_000 });
  const d = q.data;
  if (!d) return null;
  const tiles: [string, number, string, string?][] = [
    ["Land enquiries", d.enquiries, "/legal/land/enquiries"],
    ["Verifications", d.verifications, "/legal/land/verification"],
    ["Active", d.active, "/legal/land/verification"],
    ["Ready for review", d.readyForReview, "/legal/land/verification"],
    ["Returned", d.returned, "/legal/land/verification", d.returned ? "text-destructive" : undefined],
    ["Verified", d.verified, "/legal/land/verification", "text-emerald-700"],
    ["Overdue activities", d.overdueActivities, "/legal/verification/reports", d.overdueActivities ? "text-destructive" : undefined],
    ["On-hold activities", d.onHoldActivities, "/legal/land/verification", d.onHoldActivities ? "text-amber-700" : undefined],
    ["Discrepancies", d.discrepancies, "/legal/verification/reports", d.discrepancies ? "text-destructive" : undefined],
    ["Pending mutation", d.pendingMutation, "/legal/verification/reports"],
    ["Pending conversion", d.pendingConversion, "/legal/verification/reports"],
  ];
  const max = Math.max(1, ...d.byActivity.map((a) => a.open));
  return (
    <section className="border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <b className="text-sm">Legal verification</b>
        <span className="flex gap-3 text-xs"><button className="underline" onClick={() => navigate("/legal/my-tasks")}>My tasks</button><button className="underline" onClick={() => navigate("/legal/verification/reports")}>Reports</button></span>
      </header>
      <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map(([label, n, path, tone]) => (
          <button key={label} onClick={() => navigate(path)} className="border-b border-r border-border px-3 py-2 text-left hover:bg-primary/5">
            <span className="block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
            <b className={`text-xl tabular-nums ${tone ?? ""}`}>{n}</b>
          </button>
        ))}
      </div>
      {d.byActivity.length > 0 && (
        <div className="p-3">
          <p className="mb-2 text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">Open activities by type (red = overdue)</p>
          <ul className="space-y-1">
            {d.byActivity.map((a) => (
              <li key={a.no} className="grid grid-cols-[minmax(0,14rem)_1fr_3rem] items-center gap-2 text-xs">
                <span className="truncate">{a.no}. {a.name}</span>
                <span className="flex h-3"><span className="h-full bg-destructive" style={{ width: `${(a.overdue / max) * 100}%` }} /><span className="h-full bg-foreground/70" style={{ width: `${((a.open - a.overdue) / max) * 100}%` }} /></span>
                <span className="text-right tabular-nums">{a.open}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
