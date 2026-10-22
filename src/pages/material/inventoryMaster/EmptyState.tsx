import { Warehouse, Plus } from "lucide-react";
import { type Godown } from "@/api/godownsApi";

// ─── Empty State ──────────────────────────────────────────────────────────────
export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center">
          <Warehouse size={36} className="text-emerald-500/60" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500/20 border-2 border-card flex items-center justify-center">
          <Plus size={13} className="text-emerald-600" />
        </div>
      </div>
      <p className="text-base font-heading font-bold text-foreground mb-1">
        No godowns yet
      </p>
      <p className="text-xs text-muted-foreground max-w-xs mb-6">
        Create your first project godown or storage location to start tracking
        inventory across sites. Seeded godowns are assigned per project.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-500/20"
      >
        <Plus size={14} /> Create First Godown
      </button>
    </div>
  );
}
