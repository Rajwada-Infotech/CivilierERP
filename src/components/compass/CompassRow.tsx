import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeft } from "lucide-react";
import type { CompassEntry } from "./compassRegistry";
import { moduleLook } from "./compassModules";

const pad = (n: number) => String(n).padStart(2, "0");

// One page: its index number, its module's mark, its name with the module/section under it, and the Enter key that
// shows on the highlighted row.
export function CompassRow({
  entry,
  value,
  index,
  onSelect,
  showModule,
  title,
}: {
  entry: CompassEntry;
  /** cmdk needs a unique value per row; a page can appear in Recent and in the results at once. */
  value: string;
  index: number;
  onSelect: (e: CompassEntry) => void;
  showModule?: boolean;
  /** Overrides the page label (the module index shows module names). */
  title?: string;
}) {
  const { Icon, color } = moduleLook(entry.moduleId);
  const sub = title ? null : [showModule ? entry.module : null, entry.group].filter(Boolean).join(" · ");
  return (
    <CommandPrimitive.Item value={value} onSelect={() => onSelect(entry)}>
      <span className="c-num">{pad(index)}</span>
      <span className="c-mark" style={{ color }}>
        <Icon size={15} />
      </span>
      <span className="c-text">
        <span className="c-name">{title ?? entry.label}</span>
        {sub && <span className="c-sub">{sub}</span>}
      </span>
      <span className="c-key c-go" aria-hidden="true"><CornerDownLeft size={11} strokeWidth={2} /></span>
    </CommandPrimitive.Item>
  );
}
