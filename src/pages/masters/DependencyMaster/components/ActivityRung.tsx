import { GripVertical, Trash2, ArrowDown } from "lucide-react";
import type { LadderActivity } from "@/api/dependencyMasterApi";

interface Props {
  rung: LadderActivity;
  index: number;
  total: number;
  onRemove?: () => void;
  onDragStart?: (index: number) => void;
  onDragOver?: (index: number) => void;
  onDrop?: () => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  /** Inline list-row preview — no drag handle, no delete button. */
  readOnly?: boolean;
}

// One rung of the ladder — sequence number, activity name, inherited
// Internal/External tag, drag handle, delete. The connector arrow to the
// next rung lives here too (rendered below the card) so removing a rung
// can't leave an orphaned connector behind.
export function ActivityRung({
  rung,
  index,
  total,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
  isDropTarget,
  readOnly,
}: Props) {
  return (
    <div className="relative pl-9">
      {/* Rail node */}
      <div className="absolute left-0 top-3 w-7 h-7 rounded-full bg-primary text-white text-[11px] font-heading font-bold flex items-center justify-center shadow-sm z-10">
        {rung.sequenceNo}
      </div>
      {/* Rail line down to the next node */}
      {index < total - 1 && (
        <div className="absolute left-[13px] top-10 bottom-[-14px] w-px bg-border" />
      )}

      <div
        draggable={!readOnly}
        onDragStart={() => onDragStart?.(index)}
        onDragOver={(e) => {
          if (readOnly) return;
          e.preventDefault();
          onDragOver?.(index);
        }}
        onDrop={(e) => {
          if (readOnly) return;
          e.preventDefault();
          onDrop?.();
        }}
        className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 bg-card transition-all ${
          isDragging ? "opacity-40" : ""
        } ${isDropTarget ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
      >
        {!readOnly && (
          <GripVertical size={14} className="text-muted-foreground/50 cursor-grab shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground flex-1 truncate">
          {rung.activityName}
        </span>
        <span
          className={`text-[9px] font-heading uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${
            rung.workType === "INTERNAL"
              ? "bg-orange-500/10 text-orange-500"
              : "bg-sky-500/10 text-sky-500"
          }`}
        >
          {rung.workType === "INTERNAL" ? "Internal" : "External"}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
            title="Remove"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {index < total - 1 && (
        <div className="flex items-center justify-center py-1 text-muted-foreground/40">
          <ArrowDown size={13} />
        </div>
      )}
    </div>
  );
}
