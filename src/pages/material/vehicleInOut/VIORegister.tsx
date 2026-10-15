import { DataTable } from "@/components/ui/DataTable";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, X, ChevronDown, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { VehicleCard, COLUMNS } from "./config";
import { bridge } from "./config";
import type { VIOState } from "./useVehicleInOut";

// The register: search, filters, entries grouped by purchase order.
export function VIORegister({ m }: { m: VIOState }) {
  const { rights, finYears, search, setSearch, page, setPage, filterFY, setFilterFY, records, totalPages, total, filteredRecords, vehicleApprovalTrails, vehicleApprovalTrailsLoading, groupedRecords, collapsedGroups, toggleGroup, isFetching } = m;
  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* LIST                                                                */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  Vehicle In/Out Register
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {total} record{total !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* FY filter */}
                <div className="relative">
                  <select
                    value={filterFY}
                    onChange={(e) => {
                      setFilterFY(e.target.value);
                      setPage(1);
                    }}
                    className="pl-3 pr-8 py-2 rounded-lg text-xs bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground appearance-none"
                  >
                    <option value="">All Years</option>
                    {[...finYears]
                      .filter((fy) => fy.status === "Active")
                      .sort((a, b) => b.year.localeCompare(a.year))
                      .map((fy) => (
                        <option key={fy.id} value={fy.year}>
                          {fy.year}
                        </option>
                      ))}
                  </select>
                  <ChevronDown
                    size={11}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
                {/* Search */}
                <div className="relative w-full sm:w-60">
                  <Search
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <Input
                    placeholder="Search doc, vehicle, challan…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
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
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredRecords.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-10">
              No Vehicle In/Out records. Click 'New Entry' to create one.
            </p>
          ) : (
            groupedRecords.map((group) => {
              const collapsed = !!collapsedGroups[group.key];
              return (
                <div key={group.key} className="border-b border-border last:border-0">
                  {/* Group header — one PO's lots grouped together */}
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
                    <FileText size={13} className="text-primary shrink-0" />
                    <span className="text-sm font-heading font-semibold text-foreground">
                      {group.poNumber || "No PO Linked"}
                    </span>
                    {group.supplierName && (
                      <span className="text-xs text-muted-foreground truncate">
                        · {group.supplierName}
                      </span>
                    )}
                    <span className="ml-auto text-[0.625rem] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {group.rows.length} lot{group.rows.length !== 1 ? "s" : ""}
                    </span>
                  </button>

                  {!collapsed && (
                    <>
                      {/* Mobile: stacked cards (table is hard to use on phones) */}
                      <div
                        className={`sm:hidden p-3 space-y-3 transition-opacity duration-200 ${isFetching ? "opacity-60 pointer-events-none" : ""}`}
                      >
                        {group.rows.map((rec: any) => (
                          <VehicleCard
                            key={rec.VehicleInOutID}
                            rec={rec}
                            onView={bridge.onView}
                            onEdit={bridge.onEdit}
                            onDelete={bridge.onDelete}
                            onGeneratePdf={bridge.onGeneratePdf}
                            canEdit={rights.canEdit}
                            canDelete={rights.canDelete}
                            approvalTrail={vehicleApprovalTrails.get(String(rec.VehicleInOutID)) ?? null}
                            approvalTrailLoading={vehicleApprovalTrailsLoading}
                          />
                        ))}
                      </div>

                      {/* Desktop / tablet: full table */}
                      <div
                        className={`hidden sm:block overflow-x-auto transition-opacity duration-200 ${isFetching ? "opacity-60 pointer-events-none" : ""}`}
                      >
                        <DataTable
                          data={group.rows}
                          columns={COLUMNS}
                          searchable={false}
                          paginated={false}
                          emptyMessage="No Vehicle In/Out records."
                          getRowId={(r: any) => String(r.VehicleInOutID)}
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {total} record
              {total !== 1 ? "s" : ""}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 transition-colors"
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
