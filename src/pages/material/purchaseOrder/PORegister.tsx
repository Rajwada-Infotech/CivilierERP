import { DataTable } from "@/components/ui/DataTable";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { HEAD, KEY_LINE, RULE, FIELD, chip } from "./config";
import type { POState } from "./usePurchaseOrder";

const TABS = [
  { value: "", label: "All POs" },
  { value: "WO_PO", label: "WO-POs" },
  { value: "Direct", label: "Direct" },
  { value: "Normal", label: "From MR" },
];

// The purchase-order register: filters, the list, paging.
export function PORegister({ m }: { m: POState }) {
  const { page, setPage, poTypeFilter, setPoTypeFilter, collapsedProjectGroups, setCollapsedProjectGroups, projectFilter, setProjectFilter, searchQuery, setSearchQuery, isLoading, allProjects, totalPages, totalRecords, filteredList, groupedByProject, poColumns } = m;
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-3 space-y-3" style={{ borderBottom: RULE }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className={HEAD}>Purchase order register</span>
            <p className="text-xs text-muted-foreground mt-1">
              {totalRecords} project{totalRecords !== 1 ? "s" : ""} · {filteredList.length} PO{filteredList.length !== 1 ? "s" : ""} on this page
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search PO number, supplier…"
                aria-label="Search purchase orders"
                className={`${FIELD} pl-9`}
              />
            </div>
            <select
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Project"
              className={`${FIELD} sm:w-48`}
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
          {TABS.map((tab) => (
            <button
              key={tab.value}
              aria-pressed={poTypeFilter === tab.value}
              onClick={() => {
                setPoTypeFilter(tab.value);
                setPage(1);
              }}
              className={chip(poTypeFilter === tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-14 text-sm text-muted-foreground">Loading…</div>
      ) : filteredList.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-10">No purchase orders found. Use New purchase order to raise one.</p>
      ) : (
        groupedByProject.map((group) => {
          const collapsed = !!collapsedProjectGroups[group.key];
          return (
            <div key={group.key} className="border-b border-foreground/20 last:border-0">
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={() => setCollapsedProjectGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-primary/5 transition-colors text-left"
                style={{ borderBottom: collapsed ? undefined : "1px solid hsl(var(--foreground) / 0.2)" }}
              >
                {collapsed ? (
                  <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                )}
                <span className="font-heading text-sm font-bold tracking-tight text-foreground">{group.projectName || "No project"}</span>
                <span className="ml-auto font-heading text-[0.625rem] font-semibold tabular-nums text-muted-foreground border border-foreground/30 px-1.5 py-0.5">
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
      <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground" style={{ borderTop: RULE }}>
        <span className="tabular-nums">
          Page {page} of {totalPages} ({totalRecords} projects)
        </span>
        <div className="flex gap-2">
          <button onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1} className={`${KEY_LINE} h-8 px-3`}>
            Previous
          </button>
          <button onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages} className={`${KEY_LINE} h-8 px-3`}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
