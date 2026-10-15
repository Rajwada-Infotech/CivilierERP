import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/DataTable";
import { Search, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import type { POState } from "./usePurchaseOrder";

// The purchase-order register: filters, the list, paging.
export function PORegister({ m }: { m: POState }) {
  const { page, setPage, poTypeFilter, setPoTypeFilter, collapsedProjectGroups, setCollapsedProjectGroups, projectFilter, setProjectFilter, searchQuery, setSearchQuery, isLoading, allProjects, items, totalPages, totalRecords, filteredList, groupedByProject, poColumns } = m;
  return (
    <>
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  Purchase Order Register
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {totalRecords} project{totalRecords !== 1 ? "s" : ""} · {filteredList.length} PO{filteredList.length !== 1 ? "s" : ""} on this page
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-64">
                  <Search
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search PO number, supplier…"
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
                  {allProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { value: "", label: "All POs" },
                { value: "WO_PO", label: "WO-POs" },
                { value: "Direct", label: "Direct" },
                { value: "Normal", label: "From MR" },
              ].map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => {
                    setPoTypeFilter(tab.value);
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    poTypeFilter === tab.value
                      ? "btn-module text-white border-transparent shadow-sm"
                      : "bg-background text-muted-foreground border-border hover:border-emerald-500/40"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-14 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : filteredList.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-10">
              No purchase orders found. Click 'New PO' to create one.
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
                      {group.rows.length} order{group.rows.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  {!collapsed && (
                    <DataTable
                      data={group.rows}
                      searchable={false}
                      paginated={false}
                      emptyMessage="No purchase orders found."
                      getRowId={(r: any) => String(r._id)}
                      columns={poColumns}
                    />
                  )}
                </div>
              );
            })
          )}
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10 text-xs text-muted-foreground">
            <span>
              Page {page} of {totalPages} ({totalRecords} projects)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 transition text-xs"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 transition text-xs"
              >
                Next
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
