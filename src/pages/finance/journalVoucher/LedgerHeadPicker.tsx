import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { JournalVoucherLedgerOption } from "@/api/journalVoucherApi";
import { filterLedgerOptions, groupLedgerOptions } from "./ledgerGroups";

// Keeps the list snappy on databases with thousands of heads — the search box
// narrows it, and the footer says so when results were cut.
const MAX_RENDERED = 300;

export function LedgerHeadPicker({
  value,
  onChange,
  options,
}: {
  value: number | null;
  onChange: (id: number) => void;
  options: JournalVoucherLedgerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  // Two heads can share a name (e.g. the same customer on two bookings) — show
  // the code beside those so they can be told apart.
  const duplicateLabels = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const o of options) {
      const k = o.label.trim().toLowerCase();
      if (seen.has(k)) dupes.add(k);
      else seen.add(k);
    }
    return dupes;
  }, [options]);

  const { groups, total, shown } = useMemo(() => {
    const matches = filterLedgerOptions(options, query);
    const capped = matches.slice(0, MAX_RENDERED);
    return { groups: groupLedgerOptions(capped), total: matches.length, shown: capped.length };
  }, [options, query]);

  const suffix = (o: JournalVoucherLedgerOption) => {
    if (o.accountNoLast4) return `•••${o.accountNoLast4}`;
    return duplicateLabels.has(o.label.trim().toLowerCase()) && o.code ? o.code : null;
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-8 w-full items-center justify-between gap-2 text-left text-xs focus:outline-none"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : "Select account…"}
          </span>
          <ChevronsUpDown size={12} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[340px] p-0"
        // The popover is portaled outside the Dialog, whose scroll lock would
        // otherwise swallow the mouse wheel — let the list scroll itself.
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search account heads…"
            value={query}
            onValueChange={setQuery}
            className="h-9 text-xs"
          />
          <CommandList className="max-h-72">
            <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
              No account head matches “{query.trim()}”.
            </CommandEmpty>
            {groups.map((g) => (
              <CommandGroup
                key={g.key}
                heading={g.label}
                className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest"
              >
                {g.options.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={String(o.id)}
                    onSelect={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    className="text-xs text-foreground data-[selected=true]:bg-neutral-900 data-[selected=true]:text-neutral-50"
                  >
                    <Check size={12} className={cn("mr-2 shrink-0", o.id === value ? "opacity-100" : "opacity-0")} />
                    <span className="truncate text-foreground">{o.label}</span>
                    {suffix(o) && <span className="ml-auto pl-2 text-[10px] text-muted-foreground">{suffix(o)}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {total > shown && (
              <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
                Showing {shown} of {total} — keep typing to narrow it down.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
