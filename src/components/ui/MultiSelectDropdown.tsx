import React, { useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  /** Stable identity. Coerced to string internally — `value` is always string[]. */
  id: string | number;
  label: string;
  /** Optional secondary text shown dimmed after the label (code, count, etc.). */
  hint?: string | null;
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  /** Selected ids as strings. Accepts unknown so it drops straight into MasterPage custom fields. */
  value: unknown;
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Noun used in the summary line and empty states, e.g. "payment plan". */
  itemNoun?: string;
  /** Shown above the list inside the panel — used for cascade/scope explanations. */
  note?: string;
  /** Rendered in place of the whole control when there are no options at all. */
  emptyMessage?: string;
  disabled?: boolean;
  /** Collapsed trigger stops listing names past this count and shows "+N more". */
  maxChipsInTrigger?: number;
  className?: string;
}

/**
 * Searchable multi-select in a dropdown.
 *
 * Replaces the inline wrap-of-pills pattern used by earlier tag pickers, which
 * grew unbounded — at 20+ options the pills pushed the rest of the form off
 * screen, and at 50+ the field was unusable. Here the collapsed trigger stays a
 * single row whatever the option count, and the list itself scrolls inside a
 * fixed-height panel with a search box over it.
 *
 * Uses Popover (which portals) rather than an absolutely-positioned panel on
 * purpose: MasterPage's form card is `overflow-hidden`, so an in-flow panel
 * gets clipped at the card's bottom edge.
 */
export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  itemNoun = "item",
  note,
  emptyMessage,
  disabled = false,
  maxChipsInTrigger = 3,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const selected: string[] = useMemo(
    () => (Array.isArray(value) ? (value as unknown[]).map(String) : []),
    [value],
  );

  // Only ids that still exist in options — a plan can be untagged upstream (or
  // the block/project cascade can narrow the list) after a unit already
  // referenced it, and counting a stale id would report a selection the user
  // cannot see or clear.
  const liveSelected = useMemo(() => {
    const ids = new Set(options.map((o) => String(o.id)));
    return selected.filter((id) => ids.has(id));
  }, [options, selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ? o.hint.toLowerCase().includes(q) : false),
    );
  }, [options, search]);

  const toggle = (id: string) =>
    onChange(
      liveSelected.includes(id)
        ? liveSelected.filter((x) => x !== id)
        : [...liveSelected, id],
    );

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((o) => liveSelected.includes(String(o.id)));

  const toggleAllFiltered = () => {
    const filteredIds = filtered.map((o) => String(o.id));
    if (allFilteredSelected) {
      onChange(liveSelected.filter((id) => !filteredIds.includes(id)));
    } else {
      onChange(Array.from(new Set([...liveSelected, ...filteredIds])));
    }
  };

  if (!options.length) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {emptyMessage ?? `No ${itemNoun}s available.`}
      </p>
    );
  }

  const chosen = options.filter((o) => liveSelected.includes(String(o.id)));
  const shown = chosen.slice(0, maxChipsInTrigger);
  const overflow = chosen.length - shown.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={placeholder}
          className={cn(
            "w-full flex items-center gap-2 min-h-10 px-3 py-2 rounded-md border border-border bg-background text-left text-xs",
            "transition-colors hover:border-primary/50",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
        >
          <span className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
            {chosen.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {shown.map((o) => (
                  <span
                    key={o.id}
                    className="inline-flex items-center max-w-[14rem] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25 font-heading text-[11px]"
                  >
                    <span className="truncate">{o.label}</span>
                  </span>
                ))}
                {overflow > 0 && (
                  <span className="text-[11px] text-muted-foreground font-heading">
                    +{overflow} more
                  </span>
                )}
              </>
            )}
          </span>
          {chosen.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear all selected ${itemNoun}s`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange([]);
                }
              }}
              className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <X size={13} />
            </span>
          )}
          <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] p-0 overflow-hidden"
        onOpenAutoFocus={(e) => {
          // Land the caret in the search box rather than the first row, so a
          // long list is filtered by typing instead of scrolled.
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        {note && (
          <p className="px-3 pt-2.5 pb-1 text-[11px] text-muted-foreground">{note}</p>
        )}

        <div className="relative p-2 border-b border-border">
          <Search
            size={13}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="max-h-64 overflow-y-auto thin-scroll py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              No {itemNoun} matches “{search}”.
            </p>
          ) : (
            filtered.map((o) => {
              const id = String(o.id);
              const isSelected = liveSelected.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggle(id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                    "hover:bg-accent focus:outline-none focus-visible:bg-accent",
                    isSelected && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {isSelected && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-foreground">{o.label}</span>
                  {o.hint && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{o.hint}</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-muted/30">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {liveSelected.length} of {options.length} selected
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleAllFiltered}
              disabled={filtered.length === 0}
              className="px-2 py-1 rounded text-[11px] font-heading text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors"
            >
              {allFilteredSelected
                ? search
                  ? "Deselect matches"
                  : "Deselect all"
                : search
                  ? "Select matches"
                  : "Select all"}
            </button>
            {liveSelected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="px-2 py-1 rounded text-[11px] font-heading text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default MultiSelectDropdown;
