import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import {
  ASSIGNMENT_STATUS_META,
  getAmendments,
  type AmendmentRecord,
} from "@/api/dependencyActivityAssignmentApi";
import { dependencyAutoName, matchesAutoNameSearch } from "@/lib/dependencyAutoName";
import { Search } from "lucide-react";

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SOURCE_LABEL: Record<string, string> = { QC: "Quality check", APPROVAL: "Approval" };

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";

// Every activity ever sent back for rework — via QC or an Approval
// rejection — read-only. A row here is a past attempt (migration 488's
// fork-on-rework design); "Now at" shows what the current attempt has
// moved on to since.
const autoNameOf = (r: AmendmentRecord) =>
  dependencyAutoName({ flatName: r.flatName, alias: r.alias, roomName: r.roomName, storey: r.storey, activityName: r.activityName });

export default function Amendment() {
  const rights = usePageRights("civilworkdpr-amendment");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["civilworkdpr-amendments"],
    queryFn: getAmendments,
    enabled: rights.canView,
  });

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return rows;
    // Every word typed must appear somewhere in the Auto Name (flat, room, activity), location,
    // engineer or reason — so a whole Auto Name, or any pieces of it, finds the row.
    return rows.filter((r) =>
      matchesAutoNameSearch(q, [autoNameOf(r), r.activityName, r.alias, r.scopePath, r.projectName, r.engineerNames, r.reworkReason]),
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
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Amendment"
        subtitle="Every activity sent back for rework, why, and where its current attempt has got to since."
      >
        {!rights.canView ? (
          <div className="bg-card p-8 text-center text-sm text-muted-foreground" style={{ border: "1px dashed hsl(var(--border))" }}>
            You don't have access to this page.
          </div>
        ) : (
          <>
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Sent back", value: rows.length, note: "attempts reworked in all" },
                { label: "At quality check", value: rows.filter((r) => r.reworkSource === "QC").length, note: "rated Poor on inspection" },
                { label: "At approval", value: rows.filter((r) => r.reworkSource === "APPROVAL").length, note: "rejected by an approver" },
                { label: "Since settled", value: rows.filter((r) => r.currentStatus === "COMPLETED" || r.currentStatus === "APPROVED").length, note: "now completed or approved" },
              ].map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
              <p className="flex items-baseline gap-2.5">
                <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Reworked activities</span>
                <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{filtered.length}</span>
              </p>
              <div className="relative ml-auto w-full sm:w-80">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search auto name, activity, location, engineer, reason…"
                  className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2.5 text-left">Activity</th>
                    <th className="px-4 py-2.5 text-left">Location</th>
                    <th className="px-4 py-2.5 text-left">Attempt</th>
                    <th className="px-4 py-2.5 text-left">Engineer</th>
                    <th className="px-4 py-2.5 text-left">Sent back at</th>
                    <th className="px-4 py-2.5 text-left">Reason</th>
                    <th className="px-4 py-2.5 text-left">Date</th>
                    <th className="px-4 py-2.5 text-left">Now at</th>
                  </tr>
                </thead>
                <tbody>
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
                      const sourceLabel = r.reworkSource ? SOURCE_LABEL[r.reworkSource] : null;
                      const currentMeta = r.currentStatus ? ASSIGNMENT_STATUS_META[r.currentStatus] : null;
                      return (
                        <tr key={r.assignmentId}>
                          <td className="px-4 py-3">
                            <p className="text-[0.8125rem] font-medium text-foreground flex items-baseline gap-2">
                              <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-muted-foreground">{r.sequenceNo}</span>
                              {r.activityName}
                            </p>
                            <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{autoNameOf(r)}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px]">
                            {r.projectName ? `${r.projectName} > ` : ""}{r.scopePath}
                          </td>
                          <td className="px-4 py-3 font-heading text-xs font-semibold tabular-nums text-foreground whitespace-nowrap">{r.attemptNo}</td>
                          <td className="px-4 py-3 text-xs text-foreground">{r.engineerNames || "—"}</td>
                          <td className="px-4 py-3 text-xs">
                            {sourceLabel ? <span className={LBL}>{sourceLabel}</span> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className={`px-4 py-3 text-xs max-w-[260px] ${r.reworkReason ? "text-foreground" : "text-muted-foreground"}`}>
                            {r.reworkReason || "No reason recorded"}
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground whitespace-nowrap tabular-nums">{fmtDate(r.updatedAt)}</td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {currentMeta ? (
                              <SheetMark
                                text={`${currentMeta.label}${r.currentAttemptNo ? ` · attempt ${r.currentAttemptNo}` : ""}`}
                                tone={r.currentStatus === "COMPLETED" || r.currentStatus === "APPROVED" ? "done" : r.currentStatus === "CANCELLED" ? "stopped" : "waiting"}
                              />
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
          </>
        )}
      </SheetShell>
    </>
  );
}
