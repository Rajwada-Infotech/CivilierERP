import { escapeHtml } from "@/utils/escapeHtml";
import { Card } from "@/components/ui/card";
import { ArrowLeft, ShoppingCart, Printer, FilePenLine } from "lucide-react";
import { StatusChip } from "./config";
import type { POState } from "./usePurchaseOrder";

// The form's title bar: back, create / edit / view, the PO number.
export function POFormHeader({ m }: { m: POState }) {
  const { rights, viewMode, editingId, form, items, handlePrint, listData, goToList, goToEdit, isReadOnly } = m;
  return (
    <>
      {/* Form Header — Card matching Material Request style */}
      <Card className="border-border shadow-sm">
        <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 bg-emerald-500/[0.06] border-b border-emerald-500/20">
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={goToList}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Back</span>
            </button>
            <span className="text-emerald-500/40">|</span>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
                <ShoppingCart size={12} className="text-emerald-400" />
              </div>
              <h2 className="text-sm font-heading font-bold text-foreground truncate flex items-center gap-2">
                {viewMode === "create"
                  ? "New Purchase Order"
                  : viewMode === "edit"
                    ? "Edit Purchase Order"
                    : `Purchase Order — ${escapeHtml(form.poNumber || "—")}`}
                {viewMode === "view" && form.status && (
                  <StatusChip status={form.status} />
                )}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isReadOnly && (
              <>
                <StatusChip
                  status={
                    listData.find((r) => r._id === editingId)?.status ??
                    "Draft"
                  }
                />
                {rights.canPrint && (
                  <button
                    onClick={handlePrint}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted transition"
                  >
                    <Printer size={14} /> Print
                  </button>
                )}
                {rights.canEdit && form.status !== "Short Closed" && (
                  <button
                    onClick={() => {
                      const item = listData.find((r) => r._id === editingId);
                      if (item) goToEdit(item);
                    }}
                    className="btn-module inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-semibold transition shadow-sm"
                  >
                    <FilePenLine size={14} /> Edit
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
