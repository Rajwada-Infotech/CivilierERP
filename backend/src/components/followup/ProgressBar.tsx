import React from "react";

const TEAL = "#0d9488";

function colorFor(pct: number): string {
  if (pct >= 100) return "#22c55e";
  if (pct >= 50) return TEAL;
  if (pct >= 1) return "#f59e0b";
  return "#64748b";
}

interface ProgressBarProps {
  /** Effective (possibly sub-task-rolled-up) value shown when not actively dragging. */
  value: number;
  /** Fires once the user releases the drag/click — this is what should persist to the server. */
  onCommit: (value: number) => void;
  /** True for a task with sub-tasks — its % is auto-computed, not directly draggable. */
  disabled?: boolean;
  size?: "sm" | "md";
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, onCommit, disabled, size = "md" }) => {
  const [local, setLocal] = React.useState(value);
  const [dragging, setDragging] = React.useState(false);

  // Follow external updates (server refetch after commit, or another
  // client's change) whenever the user isn't actively mid-drag.
  React.useEffect(() => {
    if (!dragging) setLocal(value);
  }, [value, dragging]);

  const commit = () => {
    setDragging(false);
    if (local !== value) onCommit(local);
  };

  const trackHeight = size === "sm" ? "h-1.5" : "h-2";
  const color = colorFor(local);

  return (
    <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
      <div className={`relative flex-1 ${trackHeight} rounded-full bg-muted overflow-hidden min-w-[60px]`}>
        <div
          className="h-full rounded-full transition-[width] duration-150"
          style={{ width: `${local}%`, background: color }}
        />
        {!disabled && (
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={local}
            onChange={(e) => {
              setDragging(true);
              setLocal(Number(e.target.value));
            }}
            onMouseUp={commit}
            onTouchEnd={commit}
            onKeyUp={commit}
            onBlur={commit}
            title={`${local}% complete — drag to update`}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
        )}
      </div>
      <span
        className={`shrink-0 font-mono font-semibold ${size === "sm" ? "text-[10px] w-7" : "text-xs w-8"} text-right`}
        style={{ color }}
        title={disabled ? "Auto-calculated from sub-tasks" : undefined}
      >
        {local}%
      </span>
    </div>
  );
};
