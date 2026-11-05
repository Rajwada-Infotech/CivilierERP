import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { readChainLink } from "@/lib/civilWorkDprLinks";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { usePageRights } from "@/hooks/usePageRights";
import {
  ASSIGNMENT_STATUS_META,
  getEngineers,
  getRungAssignment,
  getTransferCandidateIds,
  getTransferCandidatesPage,
  transferWork,
} from "@/api/dependencyActivityAssignmentApi";
import { ArrowRightLeft, Loader2, Search } from "lucide-react";

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const labelCls = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5 block";

// Move activities from one engineer to another — pick the engineer to take
// work away from, tick the activities (one, several, or all of them), pick
// who takes over. Only work still with the engineer is listed (Allocated /
// In Progress / Hold / Rework); finished work has nothing left to hand over.
export default function WorkTransfer() {
  const rights = usePageRights("civilworkdpr-work-transfer");
  const queryClient = useQueryClient();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [remarks, setRemarks] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Opened from a report row: only that one activity is listed (and ticked) until the person asks for the rest.
  const [focusRung, setFocusRung] = useState<number | null>(null);

  const { data: engineers = [] } = useQuery({
    queryKey: ["civilworkdpr-engineers"],
    queryFn: getEngineers,
    enabled: rights.canView,
  });

  // The search is applied on the server (after a short pause), and the list loads 50 at a time.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const PAGE = 50;
  const candQ = useInfiniteQuery({
    queryKey: ["civilworkdpr-transfer-candidates", fromId, projectFilter, term, focusRung],
    queryFn: ({ pageParam }) =>
      getTransferCandidatesPage({
        engineerId: Number(fromId),
        page: pageParam,
        limit: PAGE,
        projectId: projectFilter ? Number(projectFilter) : undefined,
        search: term || undefined,
        rungId: focusRung ?? undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length * PAGE < last.total ? all.length + 1 : undefined),
    enabled: rights.canView && !!fromId,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const isLoading = candQ.isLoading;
  const visible = useMemo(() => candQ.data?.pages.flatMap((p) => p.rows) ?? [], [candQ.data]);
  const totalMatching = candQ.data?.pages[0]?.total ?? 0;
  const projects = useMemo(
    () => (candQ.data?.pages[0]?.projects ?? []).map((p) => ({ id: p.id, name: p.name || `Project ${p.id}`, count: p.count })),
    [candQ.data],
  );
  const totalAll = projects.reduce((a, p) => a + p.count, 0);

  useEffect(() => {
    setSelected(new Set());
    setProjectFilter("");
  }, [fromId]);

  // ?rung= from a report row: take the activity's current engineer as "Transfer from" and show just that activity.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedRung = readChainLink(searchParams).rungId;
  useEffect(() => {
    if (!linkedRung || !rights.canView) return;
    let cancelled = false;
    getRungAssignment(linkedRung)
      .then((detail) => {
        if (cancelled) return;
        const engineerId = detail.assignment?.engineerIds?.[0];
        if (!engineerId) {
          toast.error("That activity has no engineer to transfer work from.");
          return;
        }
        setFocusRung(linkedRung);
        setFromId(String(engineerId));
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not open that activity.");
      })
      .finally(() => {
        if (cancelled) return;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("rung");
            next.delete("chain");
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRung, rights.canView]);

  // Once the one activity is listed, tick it. (If it is not transferable - finished, say - the list is empty.)
  useEffect(() => {
    if (focusRung && visible.length === 1) setSelected(new Set([visible[0].assignmentId]));
  }, [focusRung, visible]);

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.assignmentId));
  const [selectingAll, setSelectingAll] = useState(false);
  // "Select all" covers everything matching the filter, not just the rows loaded so far.
  const toggleAllVisible = async () => {
    if (allVisibleSelected && selected.size >= Math.min(totalMatching, visible.length)) {
      setSelected(new Set());
      return;
    }
    setSelectingAll(true);
    try {
      const ids = await getTransferCandidateIds({ engineerId: Number(fromId), projectId: projectFilter ? Number(projectFilter) : undefined, search: term || undefined });
      setSelected(new Set(ids));
    } catch (e: any) {
      toast.error(e.message || "Couldn't select all.");
    } finally {
      setSelectingAll(false);
    }
  };
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fromName = engineers.find((e) => String(e.id) === fromId)?.name;
  const toName = engineers.find((e) => String(e.id) === toId)?.name;

  const mutation = useMutation({
    mutationFn: () =>
      transferWork({
        fromEngineerId: Number(fromId),
        toEngineerId: Number(toId),
        assignmentIds: Array.from(selected),
        remarks: remarks.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast.success(`${res.transferred} ${res.transferred === 1 ? "activity" : "activities"} transferred to ${toName}.`);
      setSelected(new Set());
      setRemarks("");
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-transfer-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-activity-reporting"] });
    },
    onError: (e: Error) => toast.error(e.message || "Transfer failed."),
  });

  const canSubmit = rights.canEdit && !!fromId && !!toId && fromId !== toId && selected.size > 0 && !mutation.isPending;

  const handleTransfer = () => {
    const n = selected.size;
    if (!window.confirm(`Transfer ${n} ${n === 1 ? "activity" : "activities"} from ${fromName} to ${toName}?`)) return;
    mutation.mutate();
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Work Transfer" },
        ]}
      />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Work transfer"
        subtitle="Move activities from one engineer to another, one at a time or many together."
      >
        {!rights.canView ? (
          <div className="bg-card p-8 text-center text-sm text-muted-foreground" style={{ border: "1px dashed hsl(var(--border))" }}>
            You don't have access to this page.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-card px-4 py-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3" style={{ border: "1px solid hsl(var(--foreground))" }}>
              <div>
                <label className={labelCls}>Transfer from</label>
                <SearchableNativeSelect
                  value={fromId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setFocusRung(null);
                    setFromId(e.target.value);
                  }}
                >
                  <option value="">Select engineer…</option>
                  {engineers.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </SearchableNativeSelect>
              </div>
              <div>
                <label className={labelCls}>Transfer to</label>
                <SearchableNativeSelect
                  value={toId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setToId(e.target.value)}
                >
                  <option value="">Select engineer…</option>
                  {engineers.filter((e) => String(e.id) !== fromId).map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </SearchableNativeSelect>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label className={labelCls}>Remarks (optional)</label>
                <input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. on leave, moved to another site"
                  className="w-full px-3 py-2.5 text-sm bg-card border border-foreground/40 focus:border-foreground text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                />
              </div>
            </div>

            <div className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
                <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
                  {fromName ? `${fromName}'s activities` : "Activities"}
                </span>
                {fromId && (
                  <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">
                    {selected.size} of {totalAll} selected
                  </span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  {focusRung && (
                    <button
                      type="button"
                      onClick={() => {
                        setFocusRung(null);
                        setSelected(new Set());
                      }}
                      className="px-3 py-2 border border-dashed border-foreground text-xs font-medium text-foreground hover:bg-primary/10 transition-colors text-left"
                    >
                      Showing only the activity you opened - show all of {fromName ? `${fromName}'s` : "their"} work
                    </button>
                  )}
                  {projects.length > 1 && (
                    <select
                      value={projectFilter}
                      onChange={(e) => setProjectFilter(e.target.value)}
                      className="h-9 px-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground focus:outline-none"
                    >
                      <option value="">All projects</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.count})</option>
                      ))}
                    </select>
                  )}
                  <div className="relative flex-1 sm:w-64">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search activity, location…"
                      className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 w-10">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={toggleAllVisible}
                          disabled={visible.length === 0 || !rights.canEdit || selectingAll}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-4 py-2 text-left">Activity</th>
                      <th className="px-4 py-2 text-left">Location</th>
                      <th className="px-4 py-2 text-left">Engineers</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Progress</th>
                      <th className="px-4 py-2 text-left">End Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!fromId ? (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Pick the engineer to transfer work from.</td></tr>
                    ) : isLoading ? (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 size={16} className="inline animate-spin mr-2" />Loading…</td></tr>
                    ) : visible.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                          {totalAll === 0 ? "This engineer has no transferable activities." : "No activities match your filters."}
                        </td>
                      </tr>
                    ) : (
                      visible.map((c, i) => {
                        const meta = ASSIGNMENT_STATUS_META[c.status];
                        // Rows arrive sorted project by project; a header marks where each project starts.
                        const newProject = i === 0 || visible[i - 1].projectId !== c.projectId;
                        return (
                          <React.Fragment key={c.assignmentId}>
                          {newProject && (
                            <tr style={{ boxShadow: "inset 0 1px 0 hsl(var(--foreground))" }}>
                              <td colSpan={7} className="px-4 py-2 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-foreground">
                                {c.projectName || "No project"}
                                <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                                  {visible.filter((v) => v.projectId === c.projectId).length} loaded
                                </span>
                              </td>
                            </tr>
                          )}
                          <tr>
                            <td className="px-4 py-3">
                              <Checkbox
                                checked={selected.has(c.assignmentId)}
                                onCheckedChange={() => toggleOne(c.assignmentId)}
                                disabled={!rights.canEdit}
                                aria-label={`Select ${c.activityName}`}
                              />
                            </td>
                            <td className="px-4 py-3 font-medium text-foreground">{c.activityName}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[260px]">
                              {c.projectName ? `${c.projectName} > ` : ""}{c.scopePath}
                            </td>
                            <td className="px-4 py-3 text-xs">{c.engineerNames || "—"}</td>
                            <td className="px-4 py-3">
                              <SheetMark
                                text={meta?.label ?? c.status}
                                tone={c.status === "COMPLETED" || c.status === "APPROVED" ? "done" : c.status === "CANCELLED" ? "stopped" : "waiting"}
                              />
                            </td>
                            <td className="px-4 py-3 font-heading text-xs font-semibold tabular-nums text-foreground">{Math.round(c.progressPercent ?? 0)}%</td>
                            <td className="px-4 py-3 text-xs whitespace-nowrap tabular-nums">{fmtDate(c.endDate)}</td>
                          </tr>
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {fromId && visible.length > 0 && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-xs text-muted-foreground">
                  <span>Showing {visible.length} of {totalMatching}</span>
                  {candQ.hasNextPage && (
                    <button
                      type="button"
                      onClick={() => candQ.fetchNextPage()}
                      disabled={candQ.isFetchingNextPage}
                      className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 border border-foreground text-foreground hover:bg-primary/10"
                    >
                      {candQ.isFetchingNextPage && <Loader2 size={12} className="animate-spin" />}
                      Load more
                    </button>
                  )}
                </div>
              )}

              {rights.canEdit && (
                <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
                  <span className={`text-xs ${selected.size > 0 && toName ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    {selected.size > 0 && toName
                      ? `${selected.size} activit${selected.size === 1 ? "y" : "ies"}${fromName ? ` from ${fromName}` : ""} to ${toName}`
                      : "Select activities and a receiving engineer"}
                  </span>
                  <button
                    type="button"
                    onClick={handleTransfer}
                    disabled={!canSubmit}
                    className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-5 bg-foreground text-card border border-foreground"
                  >
                    {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
                    Transfer{selected.size > 0 ? ` ${selected.size}` : ""}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetShell>
    </>
  );
}
