import { Save, RotateCcw, Check } from "lucide-react";
import { WorkOrderComparePanel } from "./config";
import type { IssuesState } from "./useIssues";

// The work-order comparison and the save bar.
export function IssueFormFooter({ m }: { m: IssuesState }) {
  const { editingId, header, cart, headerIsValid, canSave, isSaving, saved, resetFields, onSave } = m;
  return (
    <>
      {/* ── Work order comparison ── */}
      {header.workOrderId && (
        <WorkOrderComparePanel
          woId={Number(header.workOrderId)}
          docNo={header.workOrderDocNo || `#${header.workOrderId}`}
          excludeIssueId={editingId}
          cart={cart}
        />
      )}

      {/* ── Save bar ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
        <p className="text-[0.6875rem] text-muted-foreground hidden sm:block">
          {canSave ? <span className="text-emerald-500 font-medium">Ready to save</span> : !headerIsValid ? !header.godownId ? "Select a source godown" : "Fill in the required fields to save" : "Fix cart errors above"}
        </p>
        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={resetFields}
            disabled={isSaving || (!header.companyId && !header.projectId && !header.reason.trim() && !header.remarks.trim() && !header.issuedTo && cart.every((ci) => !ci.ItemId && !ci.Quantity))}
            className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={onSave}
            disabled={!canSave || isSaving || saved}
            className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold btn-module text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
          >
            {saved ? <Check size={14} /> : isSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
            {saved ? "Saved!" : isSaving ? "Saving…" : editingId ? "Update Issue" : "Save Issue"}
          </button>
        </div>
      </div>
    </>
  );
}
