import { Save, RotateCcw, Check } from "lucide-react";
import type { POState } from "./usePurchaseOrder";

// The bottom action bar: save, submit, print, cancel.
export function POActionBar({ m }: { m: POState }) {
  const { form, lineItems, saving, saved, items, handleSave, goToCreate, isReadOnly } = m;
  return (
    <>
      {/* Bottom action bar */}
      {!isReadOnly &&
        (() => {
          const poOverMrCap = lineItems.some(
            (li) =>
              li.mrItemId != null &&
              li.mrPendingQty != null &&
              li.quantity - li.mrPendingQty > 0.0001,
          );
          const poCanSave = !!(
            form.supplierId &&
            form.companyId &&
            form.projectId &&
            lineItems.some((li) => li.itemName || li.rate > 0) &&
            !poOverMrCap
          );
          const poIsDirty = !!(
            form.supplierId ||
            form.companyId ||
            form.projectId ||
            form.remarks ||
            form.expectedDate ||
            lineItems.some((li) => li.itemName || li.rate > 0)
          );
          return (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-foreground/30 bg-card overflow-hidden">
              <p className="text-[0.6875rem] text-muted-foreground hidden sm:block">
                {saved ? (
                  <span className="text-foreground font-medium">
                    Saved!
                  </span>
                ) : poCanSave ? (
                  <span className="text-foreground font-medium">
                    Ready to save
                  </span>
                ) : poOverMrCap ? (
                  <span className="text-destructive font-medium">
                    A line exceeds the remaining Material Request quantity
                  </span>
                ) : (
                  "Fill in the required fields to save"
                )}
              </p>
              <div className="flex items-center gap-2 sm:ml-auto">
                <button
                  onClick={goToCreate}
                  disabled={saving || saved || !poIsDirty}
                  className="flex-1 sm:flex-none px-4 py-1.5 text-xs font-heading border border-foreground/30 text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={12} /> Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || saved || !poCanSave}
                  className="flex-1 sm:flex-none px-5 py-2 text-sm font-heading font-semibold bg-foreground text-card border border-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
                >
                  {saved ? (
                    <Check size={14} />
                  ) : saving ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {saved
                    ? "Saved!"
                    : saving
                      ? "Saving…"
                      : "Save Purchase Order"}
                </button>
              </div>
            </div>
          );
        })()}
    </>
  );
}
