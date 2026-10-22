import { Search, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/DataTable";
import type { IssuesState } from "./useIssues";

// The issue register: search, status filter, paged table.
export function IssueList({ m }: { m: IssuesState }) {
  const { page, setPage, search, setSearch, issueStatusFilter, setIssueStatusFilter, loadingIssues, columns, totalPages, listData, totalCount } = m;
  return (
    <>
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  Issue Register
                </CardTitle>
                {!loadingIssues && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {totalCount} record{totalCount !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
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
                  placeholder="Search issue no, company…"
                  className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {["", "Pending", "Approved", "Rejected", "Draft"].map((s) => (
                <button
                  key={s || "all"}
                  type="button"
                  onClick={() => {
                    setIssueStatusFilter(s);
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${issueStatusFilter === s ? "btn-module text-white border-transparent shadow-sm" : "bg-background text-muted-foreground border-border hover:border-emerald-500/40"}`}
                >
                  {s || "All"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingIssues ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <RefreshCw size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <DataTable
                data={listData}
                columns={columns}
                searchable={false}
                paginated={false}
                emptyMessage="No material issues found. Click 'New Issue' to create one."
                getRowId={(r: any) => String(r.IssueId)}
              />
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
    </>
  );
}
