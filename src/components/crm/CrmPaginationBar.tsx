import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Shared across every CRM list page being migrated to server-side
// pagination (first built for CrmInvoices.tsx, extracted here so
// CrmApplication.tsx and every subsequent page reuse the exact same
// control/behavior instead of each reimplementing it).
export function CrmPaginationBar({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-1 py-2 text-xs text-muted-foreground">
      <span>Page {page} of {totalPages} · {total} total</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}
          className="flex items-center gap-1 px-2 py-1 border border-border rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
          <ChevronLeft size={12} /> Prev
        </button>
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
          className="flex items-center gap-1 px-2 py-1 border border-border rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
          Next <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
