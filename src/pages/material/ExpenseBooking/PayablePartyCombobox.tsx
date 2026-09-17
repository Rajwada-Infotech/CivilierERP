import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PayablePartyOption {
  id: number;
  label: string;
  paymentTerms: string | null;
}

export interface PayablePartyGroup {
  /** Prefix used in the "prefix:id" value key — matches the S/C/B/A/P scheme already used for supplierLHeadId. */
  prefix: string;
  label: string;
  options: PayablePartyOption[];
}

// Searchable replacement for the plain grouped <Select> the Payable To field
// used to be — with 100+ suppliers/contractors/brokers/customers/partners on
// some companies, scrolling a native dropdown to find one was the actual
// complaint. Same grouping, same "prefix:id" value scheme, just filterable.
export function PayablePartyCombobox({
  groups,
  value,
  onChange,
  placeholder = "Select Payable Party",
  className,
}: {
  groups: PayablePartyGroup[];
  value: string;
  onChange: (key: string, option: PayablePartyOption) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(() => {
    if (!value) return "";
    const [prefix, idStr] = value.split(":");
    const id = Number(idStr);
    return groups.find((g) => g.prefix === prefix)?.options.find((o) => o.id === id)?.label ?? "";
  }, [groups, value]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        options: q ? g.options.filter((o) => o.label.toLowerCase().includes(q)) : g.options,
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, query]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className={cn(
          "w-full h-9 px-3 text-sm text-left flex items-center justify-between gap-2 rounded-md border border-input bg-background hover:bg-muted/40 transition-colors",
          !selectedLabel && "text-muted-foreground",
        )}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronsUpDown size={13} className="text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-border relative">
            <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              autoFocus
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search vendor / supplier / contractor…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filteredGroups.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">No matches found</div>
            ) : (
              filteredGroups.map((g) => (
                <div key={g.prefix}>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                    {g.label}
                  </div>
                  {g.options.map((o) => {
                    const key = `${g.prefix}:${o.id}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          onChange(key, o);
                          setOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted transition-colors",
                          value === key && "bg-primary/5 text-primary font-medium",
                        )}
                      >
                        <Check size={11} className={value === key ? "opacity-100" : "opacity-0"} />
                        <span className="truncate">{o.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
