import { X, Search, FileText, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/DataTable";
import { bridge, GRN_LIST_COLUMNS } from "./config";
import { HEAD, RULE } from "./config";
import type { GRNState } from "./useGRN";

// The GRN register: search, filters, entries grouped by purchase order.
export function GRNHistory({ m }: { m: GRNState }) {
  const { search, setSearch, page, setPage, grnStatusFilter, setGrnStatusFilter, totalPages, totalRecords, filteredGrns, groupedGrns, collapsedGrnGroups, toggleGrnGroup, fetchingGrns } = m;
  return (
    <>
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-4 py-3" style={{ borderBottom: RULE }}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className={HEAD}>
                  GRN Register
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {totalRecords} record{totalRecords !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <Input
                  placeholder="Search GRN, PO, Supplier…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {["All", "Pending", "Approved", "Booked", "Rejected"].map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setGrnStatusFilter(s)}
                    className={`px-3 py-1 text-xs font-medium border transition-colors ${grnStatusFilter === s ? "bg-foreground text-card border border-foreground border-transparent" : "bg-card text-muted-foreground border-foreground/30 hover:border-foreground/40"}`}
                  >
                    {s}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
        <div>
          {filteredGrns.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-10">
              No GRNs found. Click 'New GRN' to create one.
            </p>
          ) : (
            groupedGrns.map((group) => {
              const collapsed = !!collapsedGrnGroups[group.key];
              return (
                <div
                  key={group.key}
                  className="border-b border-foreground/30 last:border-0"
                >
                  {/* Group header — one PO's GRNs grouped together */}
                  <button
                    type="button"
                    onClick={() => toggleGrnGroup(group.key)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 bg-card hover:bg-primary/5 transition-colors text-left"
                  >
                    {collapsed ? (
                      <ChevronRight
                        size={14}
                        className="text-muted-foreground shrink-0"
                      />
                    ) : (
                      <ChevronDown
                        size={14}
                        className="text-muted-foreground shrink-0"
                      />
                    )}
                    <FileText size={13} className="text-primary shrink-0" />
                    <span className="text-sm font-heading font-semibold text-foreground">
                      {group.poNumber || "No PO Linked"}
                    </span>
                    {group.supplierName && (
                      <span className="text-xs text-muted-foreground truncate">
                        · {group.supplierName}
                      </span>
                    )}
                    <span className="ml-auto text-[0.625rem] font-medium text-muted-foreground bg-card px-2 py-0.5">
                      {group.rows.length} GRN
                      {group.rows.length !== 1 ? "s" : ""}
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

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/30 px-4 py-3 text-xs text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {totalRecords} record
              {totalRecords !== 1 ? "s" : ""}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 border border-foreground/30 px-3 py-1.5 text-xs hover:bg-primary/5 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 border border-foreground/30 px-3 py-1.5 text-xs hover:bg-primary/5 disabled:opacity-40 transition-colors"
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
