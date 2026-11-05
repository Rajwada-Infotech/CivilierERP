import { Search, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { HEAD, KEY_LINE, RULE, chip } from "./config";
import type { MRState } from "./useMaterialRequest";

// The request register: search, project and status filters, requests grouped by project.
export function MRList({ m }: { m: MRState }) {
  const { page, setPage, search, setSearch, setSearchParams, statusFilter, setStatusFilter, collapsedProjectGroups, setCollapsedProjectGroups, projectFilter, setProjectFilter, projects, listData, loadingList, columns } = m;
  const totalPages = listData?.totalPages || 1;
  const rows: any[] = listData?.data || [];
  const totalCount = listData?.total || 0;

  // Grouped by Project, same collapsible pattern GRN/Vehicle In/Out use
  // for their parent PO — groups.set() on first appearance preserves the
  // order rows arrive in, and the list is already newest-first (server
  // sort), so a project's group lands wherever its most recently
  // created request would — the latest-created project naturally ends
  // up on top with no separate sort step needed.
  const groupedByProject = (() => {
    const groups = new Map<string, { key: string; projectName: string | null; rows: any[] }>();
    for (const r of rows) {
      const key = r.ProjectName || "no-project";
      if (!groups.has(key)) {
        groups.set(key, { key, projectName: r.ProjectName || null, rows: [] });
      }
      groups.get(key)!.rows.push(r);
    }
    return Array.from(groups.values());
  })();

  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-3 space-y-3" style={{ borderBottom: RULE }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className={HEAD}>Request register</span>
            {!loadingList && (
              <p className="text-xs text-muted-foreground mt-1">
                {totalCount} project{totalCount !== 1 ? "s" : ""} · {rows.length} request{rows.length !== 1 ? "s" : ""} on this page
              </p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search doc no, company…"
                aria-label="Search requests"
                className="w-full h-9 pl-9 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
              />
            </div>
            <select
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Project"
              className="h-9 w-full sm:w-48 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground outline-none"
            >
              <option value="">All projects</option>
              {(projects as any[]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {["", "Pending", "Approved", "Overdue"].map((s) => (
            <button
              key={s || "all"}
              aria-pressed={statusFilter === s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
                if (s) setSearchParams({ status: s });
                else setSearchParams({});
              }}
              className={chip(statusFilter === s)}
            >
              {s || "All"}
            </button>
          ))}
        </div>
      </div>

      {loadingList ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <RefreshCw size={15} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-10">
              No material requests found. Use New request to raise one.
            </p>
          ) : (
            groupedByProject.map((group) => {
              const collapsed = !!collapsedProjectGroups[group.key];
              return (
                <div key={group.key} className="border-b border-foreground/20 last:border-0">
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedProjectGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                    }
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-primary/5 transition-colors text-left"
                    style={{ borderBottom: collapsed ? undefined : "1px solid hsl(var(--foreground) / 0.2)" }}
                  >
                    {collapsed ? (
                      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                    )}
                    <span className="font-heading text-sm font-bold tracking-tight text-foreground">
                      {group.projectName || "No project"}
                    </span>
                    <span className="ml-auto font-heading text-[0.625rem] font-semibold tabular-nums text-muted-foreground border border-foreground/30 px-1.5 py-0.5">
                      {group.rows.length} request{group.rows.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  {!collapsed && (
                    <DataTable
                      data={group.rows}
                      columns={columns}
                      searchable={false}
                      paginated={false}
                      emptyMessage="No material requests found."
                      getRowId={(r: any) => String(r.MRId)}
                    />
                  )}
                </div>
              );
            })
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 text-sm" style={{ borderTop: RULE }}>
              <span className="text-muted-foreground tabular-nums">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1}>
                  Previous
                </button>
                <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages}>
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
