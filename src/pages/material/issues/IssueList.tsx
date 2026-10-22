import { RULE, HEAD, LBL, KEY_LINE, inputCls, chip } from "./config";
import { Search, RefreshCw } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import type { IssuesState } from "./useIssues";

// The issue register: search, status filter, paged table.
export function IssueList({ m }: { m: IssuesState }) {
  const { page, setPage, search, setSearch, issueStatusFilter, setIssueStatusFilter, loadingIssues, columns, totalPages, listData, totalCount } = m;
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-5 py-4 flex flex-col gap-3" style={{ borderBottom: RULE }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className={HEAD}>Issue register</h3>
            {!loadingIssues && (
              <p className={`${LBL} mt-1 tabular-nums`}>
                {totalCount} record{totalCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search issue no, company…"
              className={`${inputCls} pl-9 !py-2`}
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
              className={chip(issueStatusFilter === s)}
            >
              {s || "All"}
            </button>
          ))}
        </div>
      </div>
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
            <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: RULE }}>
              <span className={`${LBL} tabular-nums`}>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1} className={`${KEY_LINE} h-8 px-3`}>
                  Previous
                </button>
                <button type="button" onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages} className={`${KEY_LINE} h-8 px-3`}>
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
