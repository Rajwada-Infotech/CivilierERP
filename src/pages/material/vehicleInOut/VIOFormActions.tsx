import { RotateCcw, Save, RefreshCw, Check } from "lucide-react";
import { buildEmpty } from "./config";
import type { VIOState } from "./useVehicleInOut";

// Save / update and reset.
export function VIOFormActions({ m }: { m: VIOState }) {
  const { activeFinYear, editingId, setEditingId, setErrors, uploading, setReceivedQtyByItem, setPhotoByItem, setQualityByItem, setBrandByItem, setForm, createMut, updateMut, onSubmit } = m;
  return (
    <>
      {/* ── Actions ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-foreground/30 bg-card overflow-hidden mt-4 -mx-5 -mb-5">
        <p className="hidden sm:block text-[0.6875rem] text-muted-foreground">
          Ready to save
        </p>
        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={() => {
              setForm(buildEmpty(activeFinYear));
              setReceivedQtyByItem({});
              setPhotoByItem({});
              setQualityByItem({});
              setBrandByItem({});
              setEditingId(null);
              setErrors({});
            }}
            disabled={createMut.isPending || updateMut.isPending}
            className="flex-1 sm:flex-none px-4 py-1.5 text-xs font-heading border border-foreground/30 text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={onSubmit}
            disabled={
              createMut.isPending || updateMut.isPending || uploading
            }
            className="flex-1 sm:flex-none px-5 py-2 text-sm font-heading font-semibold bg-foreground text-card border border-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
          >
            {createMut.isPending || updateMut.isPending ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : editingId ? (
              <Check size={14} />
            ) : (
              <Save size={14} />
            )}
            {createMut.isPending || updateMut.isPending
              ? "Saving…"
              : editingId
                ? "Update"
                : "Save Entry"}
          </button>
        </div>
      </div>
    </>
  );
}
