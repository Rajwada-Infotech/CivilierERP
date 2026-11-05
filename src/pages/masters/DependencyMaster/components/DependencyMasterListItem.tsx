import { useState } from "react";
import { ChevronRight, Pencil, Trash2, Loader2 } from "lucide-react";
import type { DependencyMasterDetail, DependencyMasterListRow, LadderActivity } from "@/api/dependencyMasterApi";
import { ActivityChainPreview } from "./ActivityChainPreview";
import { RungAssignmentModal } from "@/pages/civilworkdpr/RungAssignmentModal";

interface Props {
  row: DependencyMasterListRow;
  isExpanded: boolean;
  isLoading: boolean;
  cached: DependencyMasterDetail | null;
  onToggle: () => void;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

// A single entry — alias, resolved path, work type, and a chain-length
// preview (dots, one per activity) so the shape of the dependency is
// legible even collapsed. Expanding lazily fetches (once, cached) the full
// chain and renders it inline as a read-only ladder.
export function DependencyMasterListItem({
  row,
  isExpanded,
  isLoading,
  cached,
  onToggle,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: Props) {
  const isInternal = row.workType === "INTERNAL";
  const dotCount = Math.min(row.activityCount, 6);

  // Clicking an activity chip opens the same assign-engineer-&-material
  // modal Work Allocation uses for a rung — it fetches and pre-fills
  // whatever's already been assigned (workers, material, labour source) for
  // that specific activity, or lets one be created if nothing exists yet.
  const [activeRung, setActiveRung] = useState<LadderActivity | null>(null);

  return (
    <div
      className={`group border transition-colors bg-card ${
        isExpanded ? "border-foreground" : "border-foreground/30 hover:border-foreground"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
      >
        <ChevronRight
          size={14}
          className={`text-foreground shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{row.alias}</span>
            <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground shrink-0">{isInternal ? "Internal" : "External"}</span>
          </div>
          <p className="text-[0.6875rem] text-muted-foreground truncate mt-0.5">{row.scopePath}</p>
        </div>

        {/* Chain-length preview — one dot per activity, filled up to 6 */}
        <div className="hidden sm:flex items-center gap-0.5 shrink-0 mr-1" title={`${row.activityCount} activities`}>
          {Array.from({ length: dotCount }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 ${isInternal ? "bg-foreground" : "border border-foreground"}`}
            />
          ))}
          {row.activityCount > 6 && (
            <span className="text-[0.5625rem] text-muted-foreground ml-0.5">+{row.activityCount - 6}</span>
          )}
        </div>
        <span className="font-heading text-[0.625rem] tabular-nums text-muted-foreground shrink-0 w-20 text-right">
          {row.activityCount} {row.activityCount === 1 ? "step" : "steps"}
        </span>

        <div
          className="flex items-center gap-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {canEdit && (
            <span role="button" tabIndex={0} onClick={onEdit} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(); } }} title="Edit" aria-label="Edit"
              className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors cursor-pointer">
              <Pencil className="h-3.5 w-3.5" />
            </span>
          )}
          {canDelete && (
            <span role="button" tabIndex={0} onClick={onDelete} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDelete(); } }} title="Delete" aria-label="Delete"
              className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors cursor-pointer">
              <Trash2 className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pl-10 border-t border-foreground/30 pt-3">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Loading chain…
            </div>
          ) : cached ? (
            <>
              <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">Activity chain</p>
              <ActivityChainPreview rungs={cached.activities} onRungClick={setActiveRung} />
            </>
          ) : (
            <p className="py-4 text-xs text-destructive">Could not load this chain. Close and open it again.</p>
          )}
        </div>
      )}

      {activeRung && (
        <RungAssignmentModal rung={activeRung} chain={row} onClose={() => setActiveRung(null)} />
      )}
    </div>
  );
}
