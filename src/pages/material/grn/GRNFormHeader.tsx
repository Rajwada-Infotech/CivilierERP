import { Truck, Receipt, ArrowLeft } from "lucide-react";
import type { GRNState } from "./useGRN";

// The form's title bar: back, new / edit, the GRN number.
export function GRNFormHeader({ m }: { m: GRNState }) {
  const { editingId, resetForm } = m;
  return (
    <>
      {/* Form header — Finance Payment style with emerald theme */}
      <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 bg-card border-b border-foreground/40">
        <div className="absolute left-0 top-0 bottom-0 w-0.5" />
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={resetForm}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <span className="text-foreground">|</span>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 flex items-center justify-center bg-card border border-foreground/40 shrink-0">
              <Truck size={12} className="text-foreground" />
            </div>
            <h2 className="text-sm font-heading font-bold text-foreground truncate">
              {editingId
                ? "Edit Goods Receipt Note"
                : "New Goods Receipt Note"}
            </h2>
          </div>
        </div>
      </div>
    </>
  );
}
