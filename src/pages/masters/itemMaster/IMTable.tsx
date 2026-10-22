import { Search, Trash2, Check, Loader2 } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import type { ItemMasterState } from "./useItemMaster";

// The item list.
export function IMTable({ m }: { m: ItemMasterState }) {
  const { rights, data, search, deleteConfirmId, selectedIds, setSelectedIds, confirmingBulkDelete, setConfirmingBulkDelete, bulkDeleting, handleSearchChange, handleBulkDelete, filtered, ITEM_COLUMNS } = m;
  return (
    <>
      {/* ── Table ── */}
      <div className="border border-foreground bg-card p-4">
        <div className="relative mb-4">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm font-body bg-card border border-foreground/30 text-foreground focus:outline-none"
          />
        </div>

        {/* Bulk actions — only appears once something's checked */}
        {rights.canDelete && selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-4 px-3 py-2 border border-destructive/30 bg-destructive/5">
            <span className="text-xs font-heading font-medium text-foreground">
              {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
              {confirmingBulkDelete ? (
                <>
                  <span className="text-xs text-destructive">
                    Delete {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}?
                  </span>
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-heading font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                  >
                    {bulkDeleting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Check size={12} />
                    )}
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmingBulkDelete(false)}
                    disabled={bulkDeleting}
                    className="px-3 py-1.5 text-xs font-heading text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="px-3 py-1.5 text-xs font-heading text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setConfirmingBulkDelete(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-heading font-semibold border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 size={12} /> Delete Selected
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <DataTable
          data={filtered}
          columns={ITEM_COLUMNS}
          loading={false}
          searchable={false}
          paginated={true}
          defaultPageSize={10}
          emptyMessage={
            search
              ? "No items match your search."
              : "No items yet. Add one above."
          }
          rowClassName={(row) =>
            row.original._id === deleteConfirmId ? "bg-destructive/5" : ""
          }
        />
      </div>
    </>
  );
}
