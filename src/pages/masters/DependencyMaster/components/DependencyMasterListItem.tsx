import { useState } from "react";
import { ChevronRight, Pencil, Trash2, Loader2, Link2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const accent = isInternal ? "#f97316" : "#0ea5e9";
  const dotCount = Math.min(row.activityCount, 6);

  // Clicking an activity chip opens the same assign-engineer-&-material
  // modal Work Allocation uses for a rung — it fetches and pre-fills
  // whatever's already been assigned (workers, material, labour source) for
  // that specific activity, or lets one be created if nothing exists yet.
  const [activeRung, setActiveRung] = useState<LadderActivity | null>(null);

  return (
    <div
      className={`group rounded-xl border transition-all ${
        isExpanded ? "border-primary/30 bg-primary/[0.03]" : "border-border/60 hover:border-border"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
      >
        <span
          className="w-1 self-stretch rounded-full shrink-0"
          style={{ background: accent, opacity: 0.7 }}
        />
        <ChevronRight
          size={14}
          className={`text-muted-foreground/60 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-heading font-semibold text-foreground truncate">{row.alias}</span>
            <span
              className="text-[9px] font-heading uppercase tracking-widest shrink-0"
              style={{ color: accent }}
            >
              {isInternal ? "Internal" : "External"}
            </span>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5 flex items-center gap-1">
            <Link2 size={9} className="shrink-0 opacity-60" />
            {row.scopePath}
          </p>
        </div>

        {/* Chain-length preview — one dot per activity, filled up to 6 */}
        <div className="hidden sm:flex items-center gap-0.5 shrink-0 mr-1" title={`${row.activityCount} activities`}>
          {Array.from({ length: dotCount }).map((_, i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: accent, opacity: 0.4 + (i / Math.max(dotCount - 1, 1)) * 0.5 }}
            />
          ))}
          {row.activityCount > 6 && (
            <span className="text-[9px] text-muted-foreground ml-0.5">+{row.activityCount - 6}</span>
          )}
        </div>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-20 text-right">
          {row.activityCount} {row.activityCount === 1 ? "step" : "steps"}
        </span>

        <div
          className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pl-11 border-t border-border/40 pt-3 -mt-px">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Loading chain…
            </div>
          ) : cached ? (
            <>
              <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-2 flex items-center gap-1">
                <GitBranch size={9} /> Activity Chain
              </p>
              <ActivityChainPreview rungs={cached.activities} onRungClick={setActiveRung} />
            </>
          ) : (
            <p className="py-4 text-xs text-destructive italic">Failed to load this chain — try expanding again.</p>
          )}
        </div>
      )}

      {activeRung && (
        <RungAssignmentModal rung={activeRung} chain={row} onClose={() => setActiveRung(null)} />
      )}
    </div>
  );
}
