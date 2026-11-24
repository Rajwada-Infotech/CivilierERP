import { Search, ChevronRight, ChevronDown } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { bridge, GRN_LIST_COLUMNS } from "./config";
import { HEAD, RULE, KEY_LINE } from "./config";
import { chip } from "../materialRequest/config";
import type { GRNState } from "./useGRN";

// The GRN register, laid out like the Material Request register: search, project and status filters, GRNs grouped by project.
export function GRNHistory({ m }: { m: GRNState }) {
  const { search, setSearch, page, setPage, grnStatusFilter, setGrnStatusFilter, grnProjectFilter, setGrnProjectFilter, registerProjects, totalPages, filteredGrns, groupedGrns, collapsedGrnGroups, toggleGrnGroup, fetchingGrns } = m;
  return (
    <>
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-4 py-3 space-y-3" style={{ borderBottom: RULE }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className={HEAD}>GRN register</span>
              <p className="text-xs text-muted-foreground mt-1">
                {groupedGrns.length} project{groupedGrns.length !== 1 ? "s" : ""} · {filteredGrns.length} GRN{filteredGrns.length !== 1 ? "s" : ""} on this page
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search GRN, PO, supplier…"
                  aria-label="Search GRNs"
                  className="w-full h-9 pl-9 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
                />
              </div>
              <select
                value={grnProjectFilter}
                onChange={(e) => { setGrnProjectFilter(e.target.value); setPage(1); }}
                aria-label="Project"
                className="h-9 w-full sm:w-48 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground outline-none"
              >
                <option value="">All projects</option>
                {(registerProjects as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {["All", "Pending", "Approved", "Booked", "Rejected"].map((s) => (
              <button key={s} type="button" aria-pressed={grnStatusFilter === s} onClick={() => { setGrnStatusFilter(s); setPage(1); }} className={chip(grnStatusFilter === s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          {filteredGrns.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-10">
              No GRNs found. Use New GRN to record one.
            </p>
          ) : (
            groupedGrns.map((group) => {
              const collapsed = !!collapsedGrnGroups[group.key];
              return (
                <div
                  key={group.key}
                  className="border-b border-foreground/20 last:border-0"
                >
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() => toggleGrnGroup(group.key)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-primary/5 transition-colors text-left"
                    style={{ borderBottom: collapsed ? undefined : "1px solid hsl(var(--foreground) / 0.2)" }}
                  >
                    {collapsed ? <ChevronRight size={14} className="text-muted-foreground shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
                    <span className="font-heading text-sm font-bold tracking-tight text-foreground">{group.projectName || "No project"}</span>
                    <span className="ml-auto font-heading text-[0.625rem] font-semibold tabular-nums text-muted-foreground border border-foreground/30 px-1.5 py-0.5">
                      {group.rows.length} GRN{group.rows.length !== 1 ? "s" : ""}
                    </span>
                  </button>

                  {!collapsed && (
                    <div
                      className={`overflow-x-auto transition-opacity duration-200 ${fetchingGrns ? "opacity-60 pointer-events-none" : ""}`}
                    >
                      <DataTable
                        data={group.rows}
                        columns={GRN_LIST_COLUMNS}
                        onRowClick={(row) => bridge.onView(row.original)}
                        searchable={false}
                        paginated={false}
                        emptyMessage="No GRNs found."
                        getRowId={(r: any) => String(r.GRNID)}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 text-sm" style={{ borderTop: RULE }}>
              <span className="text-muted-foreground tabular-nums">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1}>Previous</button>
                <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages}>Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
