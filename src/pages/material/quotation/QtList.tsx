import { Search, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/DataTable";
import type { QtState } from "./useQuotation";

// The quotation register: search, status filter, the table.
export function QtList({ m }: { m: QtState }) {
  const { search, setSearch, statusFilter, setStatusFilter, items, loadingList, rows, columns } = m;
  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Quotation Register</CardTitle>
              {!loadingList && (
                <p className="text-xs text-muted-foreground mt-0.5">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
              )}
            </div>
            <div className="relative w-full sm:w-64">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search doc no, company…"
                className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {["", "Draft", "Sent", "PartiallyQuoted", "Quoted", "Closed"].map((s) => (
              <button
                key={s || "all"}
                onClick={() => setStatusFilter(s)}
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
          <DataTable
            data={rows}
            columns={columns}
            searchable={false}
            paginated={false}
            emptyMessage="No quotations found. Click 'New Quotation' to create one."
          />
        )}
      </CardContent>
    </Card>
  );
}
