import { Save, RotateCcw, Check } from "lucide-react";
import { WorkOrderComparePanel, RULE, LBL, KEY_LINE, KEY_INK } from "./config";
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-5 py-3 sm:py-4 bg-card" style={{ border: RULE }}>
        <p className={`${LBL} hidden sm:block`}>
          {canSave ? <span className="text-foreground">Ready to save</span> : !headerIsValid ? !header.godownId ? "Select a source godown" : "Fill in the required fields to save" : "Fix cart errors above"}
        </p>
        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={resetFields}
            disabled={isSaving || (!header.companyId && !header.projectId && !header.reason.trim() && !header.remarks.trim() && !header.issuedTo && cart.every((ci) => !ci.ItemId && !ci.Quantity))}
            className={`${KEY_LINE} flex-1 sm:flex-none h-9 px-4`}
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={onSave}
            disabled={!canSave || isSaving || saved}
            className={`${KEY_INK} flex-1 sm:flex-none h-9 px-5 whitespace-nowrap`}
          >
            {saved ? <Check size={14} /> : isSaving ? <span className="w-3.5 h-3.5 border-2 border-card/30 border-t-card animate-spin" /> : <Save size={14} />}
            {saved ? "Saved" : isSaving ? "Saving…" : editingId ? "Update issue" : "Save issue"}
          </button>
        </div>
      </div>
    </>
  );
}
