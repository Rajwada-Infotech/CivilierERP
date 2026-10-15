import { Truck, ArrowLeft } from "lucide-react";
import type { VIOState } from "./useVehicleInOut";

// The form's title bar: back, new / edit, the entry number.
export function VIOFormHeader({ m }: { m: VIOState }) {
  const { editingId, resetForm } = m;
  return (
    <>
      {/* Form header */}
      <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 bg-emerald-500/[0.06] border-b border-emerald-500/20">
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={resetForm}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <span className="text-emerald-500/40">|</span>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
              <Truck size={12} className="text-emerald-400" />
            </div>
            <h2 className="text-sm font-heading font-bold text-foreground truncate">
              {editingId ? "Edit Vehicle In/Out" : "New Vehicle In/Out"}
            </h2>
          </div>
        </div>
      </div>
    </>
  );
}
