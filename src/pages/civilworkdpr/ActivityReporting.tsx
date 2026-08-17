import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_META as STATUS_META,
  getReportedAssignments,
  type AssignmentStatus,
} from "@/api/dependencyActivityAssignmentApi";
import { AssignmentStatusSelect } from "@/components/civilworkdpr/AssignmentStatusSelect";
import { ClipboardList, UserRound, CalendarDays, Package, Loader2, ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import type { ReportedAssignment } from "@/api/dependencyActivityAssignmentApi";

const FILTER_OPTIONS: Array<{ value: AssignmentStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  ...ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
];

export default function ActivityReporting() {
  const rights = usePageRights("civilworkdpr-activity-reporting");
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | "ALL">("ALL");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["civilworkdpr-activity-reporting"],
    queryFn: () => getReportedAssignments(),
    enabled: rights.canView,
  });

  const filteredRows = useMemo(
    () => (statusFilter === "ALL" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  );

  // Group by dependency chain — every activity raised against the same
  // chain now shows together instead of scattered across the flat list,
  // same grouping GRN.tsx uses for PO. Group order follows first-appearance
  // in the (already recency-sorted) rows.
  const groupedRows = useMemo(() => {
    const groups = new Map<
      number,
      { key: number; alias: string; workType: ReportedAssignment["workType"]; scopePath: string; projectName: string | null; rows: ReportedAssignment[] }
    >();
    for (const row of filteredRows) {
      if (!groups.has(row.dependencyMasterId)) {
        groups.set(row.dependencyMasterId, {
          key: row.dependencyMasterId,
          alias: row.alias,
          workType: row.workType,
          scopePath: row.scopePath,
          projectName: row.projectName,
          rows: [],
        });
      }
      groups.get(row.dependencyMasterId)!.rows.push(row);
    }
    return Array.from(groups.values());
  }, [filteredRows]);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<number, boolean>>({});
  const toggleGroup = (key: number) => setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Reporting" },
        ]}
      />
      <CivilWorkDprShell
        title="Reporting"
        subtitle="Every activity assigned an engineer or material from Work Reporting, tracked through to completion"
        icon={ClipboardList}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border bg-muted/30">
              <span className="text-sm font-heading font-semibold text-foreground">Assigned Activities</span>
              <div className="flex flex-wrap gap-1.5">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-heading font-medium transition-colors ${
                      statusFilter === opt.value
                        ? "bg-cyan-500 text-white"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-14">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {rows.length === 0
                  ? "No activities have been assigned yet — click an activity chip in Work Reporting's Link Dependency chain to assign one."
                  : "No activities match this status."}
              </div>
            ) : (
              groupedRows.map((group) => {
                const collapsed = !!collapsedGroups[group.key];
                return (
                  <div key={group.key} className="border-b border-border last:border-0">
                    {/* Group header — one dependency chain's activities grouped together */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
                    >
                      {collapsed ? (
                        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                      )}
                      <GitBranch size={13} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                      <span className="text-sm font-heading font-semibold text-foreground">{group.alias}</span>
                      <span
                        className={`text-[10px] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                          group.workType === "INTERNAL"
                            ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                            : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                        }`}
                      >
                        {group.workType}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        · {group.projectName ? `${group.projectName} — ` : ""}
                        {group.scopePath}
                      </span>
                      <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                        {group.rows.length} activit{group.rows.length !== 1 ? "ies" : "y"}
                      </span>
                    </button>

                    {!collapsed && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide">
                              <th className="px-5 py-2">Activity</th>
                              <th className="px-3 py-2">Engineer</th>
                              <th className="px-3 py-2">Start Date</th>
                              <th className="px-3 py-2">Material</th>
                              <th className="px-5 py-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.rows.map((row) => (
                              <tr key={row.assignmentId} className="border-b border-border last:border-0 hover:bg-muted/20">
                                <td className="px-5 py-3">
                                  <span className="text-xs font-medium text-foreground">
                                    {row.sequenceNo}. {row.activityName}
                                  </span>
                                </td>
                                <td className="px-3 py-3">
                                  <span className="flex items-center gap-1.5 text-xs text-foreground">
                                    <UserRound size={11} className="text-muted-foreground shrink-0" />
                                    {row.engineerName || <span className="text-muted-foreground italic">Unassigned</span>}
                                  </span>
                                </td>
                                <td className="px-3 py-3">
                                  <span className="flex items-center gap-1.5 text-xs text-foreground whitespace-nowrap">
                                    <CalendarDays size={11} className="text-muted-foreground shrink-0" />
                                    {row.startDate ? new Date(row.startDate).toLocaleDateString() : "—"}
                                  </span>
                                </td>
                                <td className="px-3 py-3">
                                  {row.materials.length === 0 ? (
                                    <span className="text-xs text-muted-foreground italic">—</span>
                                  ) : (
                                    <div className="flex flex-col gap-0.5">
                                      {row.materials.map((m, i) => (
                                        <span key={i} className="flex items-center gap-1.5 text-xs text-foreground whitespace-nowrap">
                                          <Package size={11} className="text-muted-foreground shrink-0" />
                                          {m.name}
                                          <span className="text-muted-foreground">
                                            · {m.quantity}
                                            {m.uom ? ` ${m.uom}` : ""}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-5 py-3">
                                  <AssignmentStatusSelect rungId={row.rungId} status={row.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </CivilWorkDprShell>
    </>
  );
}
