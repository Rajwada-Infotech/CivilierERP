import { Search, RefreshCw, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/DataTable";
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
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">
                Request Register
              </CardTitle>
              {!loadingList && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {totalCount} project{totalCount !== 1 ? "s" : ""} · {rows.length} request{rows.length !== 1 ? "s" : ""} on this page
                </p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search doc no, company…"
                  className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
                />
              </div>
              <select
                value={projectFilter}
                onChange={(e) => {
                  setProjectFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 w-full sm:w-48 px-2.5 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
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
            {[
              "",
              "Pending",
              "Approved",
            ].map((s) => (
              <button
                key={s || "all"}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                  if (s) setSearchParams({ status: s });
                  else setSearchParams({});
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  statusFilter === s
                    ? "btn-module text-white border-transparent shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:border-emerald-500/40"
                }`}
              >
                {s || "All"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loadingList ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-10">
                No material requests found. Click 'New Request' to create one.
              </p>
            ) : (
              groupedByProject.map((group) => {
                const collapsed = !!collapsedProjectGroups[group.key];
                return (
                  <div key={group.key} className="border-b border-border last:border-0">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedProjectGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                      }
                      className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
                    >
                      {collapsed ? (
                        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                      )}
                      <Building2 size={13} className="text-primary shrink-0" />
                      <span className="text-sm font-heading font-semibold text-foreground">
                        {group.projectName || "No Project"}
                      </span>
                      <span className="ml-auto text-[0.625rem] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
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
              <div className="flex items-center justify-between border-t border-border px-6 py-3 text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((p) => Math.min(p + 1, totalPages))
                    }
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
