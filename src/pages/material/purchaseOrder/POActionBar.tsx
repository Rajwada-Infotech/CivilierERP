import { Save, RotateCcw, Check } from "lucide-react";
import type { POState } from "./usePurchaseOrder";
import { KEY_INK, KEY_LINE } from "./config";

// The bottom action bar: save, submit, print, cancel.
export function POActionBar({ m }: { m: POState }) {
  const { form, lineItems, saving, saved, items, handleSave, goToCreate, isReadOnly, amending, amendChecking } = m;
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
                {!amending && (
                <button
                  onClick={goToCreate}
                  disabled={saving || saved || !poIsDirty}
                  className={`${KEY_LINE} flex-1 sm:flex-none h-9 px-4`}
                >
                  <RotateCcw size={12} /> Reset
                </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || saved || !poCanSave || amendChecking}
                  className={`${KEY_INK} flex-1 sm:flex-none h-9 px-5 whitespace-nowrap`}
                >
                  {saved ? (
                    <Check size={13} />
                  ) : saving ? (
                    <span className="w-3 h-3 border-2 border-card/30 border-t-card rounded-full animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                  {saved
                    ? "Saved!"
                    : saving
                      ? "Saving…"
                      : amending
                        ? amendChecking
                          ? "Checking…"
                          : "Review amendment"
                        : "Save Purchase Order"}
                </button>
              </div>
            </div>
          );
        })()}
    </>
  );
}
