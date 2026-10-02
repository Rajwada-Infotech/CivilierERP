import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  ASSIGNMENT_STATUS_META,
  getAmendments,
  type AmendmentRecord,
} from "@/api/dependencyActivityAssignmentApi";
import { FileClock, Search, UserRound, CalendarDays, ShieldCheck, RotateCcw } from "lucide-react";

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SOURCE_META: Record<string, { label: string; className: string }> = {
  QC: { label: "Quality Check", className: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  APPROVAL: { label: "Approval", className: "bg-[#ffe2021a] text-amber-600 dark:text-amber-400" },
};

// Every activity ever sent back for rework — via QC or an Approval
// rejection — read-only. A row here is a past attempt (migration 488's
// fork-on-rework design); "Now at" shows what the current attempt has
// moved on to since.
export default function Amendment() {
  const rights = usePageRights("civilworkdpr-amendment");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["civilworkdpr-amendments"],
    queryFn: getAmendments,
    enabled: rights.canView,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.activityName, r.alias, r.scopePath, r.projectName, r.engineerNames, r.reworkReason].some((v) =>
        (v || "").toLowerCase().includes(q),
      ),
    );
  }, [rows, search]);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Amendment" },
        ]}
      />
      <CivilWorkDprShell
        title="Amendment"
        subtitle="Every activity sent back for rework, and what became of it"
        icon={FileClock}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-border bg-muted/30">
              <span className="text-sm font-heading font-semibold text-foreground">Reworked Activities</span>
              <span className="text-[0.6875rem] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{rows.length}</span>
              <div className="relative ml-auto w-full sm:w-72">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search activity, location, engineer, reason…"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-[0.625rem] uppercase tracking-widest font-heading text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Activity</th>
                    <th className="px-4 py-2 text-left">Location</th>
                    <th className="px-4 py-2 text-left">Attempt</th>
                    <th className="px-4 py-2 text-left">Engineer</th>
                    <th className="px-4 py-2 text-left">Reworked Via</th>
                    <th className="px-4 py-2 text-left">Reason</th>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Now At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {isLoading ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                        {rows.length === 0
                          ? "No activity has ever been sent back for rework."
                          : "No amendments match your search."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => {
                      const sourceMeta = r.reworkSource ? SOURCE_META[r.reworkSource] : null;
                      const currentMeta = r.currentStatus ? ASSIGNMENT_STATUS_META[r.currentStatus] : null;
                      return (
                        <tr key={r.assignmentId} className="hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{r.sequenceNo}. {r.activityName}</p>
                            <p className="text-[0.6875rem] text-muted-foreground">{r.alias}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px]">
                            {r.projectName ? `${r.projectName} > ` : ""}{r.scopePath}
                          </td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            Attempt {r.attemptNo}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <span className="inline-flex items-center gap-1.5">
                              <UserRound size={11} className="text-muted-foreground" />
                              {r.engineerNames || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {sourceMeta ? (
                              <span className={`inline-flex items-center gap-1 text-[0.625rem] font-heading font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${sourceMeta.className}`}>
                                {r.reworkSource === "QC" ? <ShieldCheck size={10} /> : <RotateCcw size={10} />}
                                {sourceMeta.label}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground max-w-[260px]">
                            {r.reworkReason || <span className="text-muted-foreground italic">No reason recorded</span>}
                          </td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDays size={11} className="text-muted-foreground" />
                              {fmtDate(r.updatedAt)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {currentMeta ? (
                              <span className={`text-[0.625rem] font-heading font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${currentMeta.className}`}>
                                {currentMeta.label}
                                {r.currentAttemptNo ? ` · #${r.currentAttemptNo}` : ""}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CivilWorkDprShell>
    </>
  );
}
