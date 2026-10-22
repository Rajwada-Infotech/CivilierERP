import { useState } from "react";
import { AlertTriangle, ChevronDown, Edit2 } from "lucide-react";
import { findDuplicateShortCodes, type CodedItem } from "./itemShortCodes";

interface Props<T extends CodedItem & { itemType?: string }> {
  items: T[];
  /** Whether the person may edit items — without it the list is shown but there is no Rename button. */
  canEdit: boolean;
  /** Opens the item in the form with a free short code filled in. */
  onRename: (id: string) => void;
}

/**
 * Lists the short codes used by more than one item, so they can be found and renamed. Each item must have
 * its own short code; the Item Master refuses a new duplicate, but older ones stay until someone renames them.
 * Renders nothing when every code is unique.
 */
export function DuplicateShortCodesPanel<T extends CodedItem & { itemType?: string }>({ items, canEdit, onRename }: Props<T>) {
  const [open, setOpen] = useState(false);
  const groups = findDuplicateShortCodes(items);
  if (groups.length === 0) return null;

  const itemCount = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="border border-foreground/40 bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <AlertTriangle size={15} className="shrink-0 text-foreground" />
        <span className="flex-1 text-sm font-medium text-foreground">
          {groups.length === 1 ? "1 short code is" : `${groups.length} short codes are`} used by more than one item
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({itemCount} items — each item needs its own short code)
          </span>
        </span>
        <span className="text-xs font-medium text-foreground">{open ? "Hide" : "Review"}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-foreground/40 px-4 py-3">
          {groups.map((group) => (
            <div key={group.code.toUpperCase()}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Code <span className="bg-card px-1.5 py-0.5 font-heading text-foreground">{group.code}</span> · {group.items.length} items
              </p>
              <ul className="divide-y divide-foreground/10 border border-foreground/30 bg-card">
                {group.items.map((item) => (
                  <li key={item._id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 truncate text-sm text-foreground">{item.itemName}</span>
                    {item.itemType && <span className="text-xs text-muted-foreground">{item.itemType}</span>}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => onRename(item._id)}
                        title="Open this item with a free short code filled in"
                        className="flex items-center gap-1.5 border border-foreground/30 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/5"
                      >
                        <Edit2 size={11} /> Give it a new code
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Rename all but one item in each group. Once none are left, the database can also enforce the rule.
          </p>
        </div>
      )}
    </div>
  );
}
