import { Save, RotateCcw } from "lucide-react";
import type { GRNState } from "./useGRN";

// Save / update and reset.
export function GRNFormActions({ m }: { m: GRNState }) {
  const { editingId, setEditingId, buildEmptyForm, formData, setFormData, setErrors, createMutation, updateMutation, onSubmit } = m;
  return (
    <>
      {/* ── Actions ── */}
      {(() => {
        const isSaving =
          createMutation.isPending || updateMutation.isPending;
        const canSave =
          !!formData.poId &&
          !!formData.supplierId &&
          formData.items.some((i) => i.receivedQty > 0);
        const isDirty =
          formData.poId !== "" ||
          formData.remarks !== "" ||
          formData.godownId !== "" ||
          formData.projectId !== "" ||
          formData.docNo !== "" ||
          formData.items.some((i) => i.receivedQty > 0 || i.rate > 0);
        return (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
            <p className="text-[0.6875rem] text-muted-foreground hidden sm:block">
              {canSave ? (
                <span className="text-emerald-500 font-medium">
                  Ready to save
                </span>
              ) : (
                "Fill in the required fields to save"
              )}
            </p>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                onClick={() => {
                  setFormData(buildEmptyForm());
                  setEditingId(null);
                  setErrors({});
                }}
                disabled={!isDirty || isSaving}
                className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={12} /> Reset
              </button>
              <button
                onClick={onSubmit}
                disabled={!canSave || isSaving}
                className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold btn-module text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
              >
                {isSaving ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {isSaving
                  ? "Saving…"
                  : editingId
                    ? "Update GRN"
                    : "Save GRN"}
              </button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
