import React, { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ClipboardList,
  Clock,
  Cpu,
  Database,
  FolderOpen,
  HardHat,
  Landmark,
  Megaphone,
  MessageSquare,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { moduleLandings, type CompassEntry } from "./compassRegistry";
import { groupByModule, searchEntries } from "./compassSearch";
import { useCompass } from "./useCompass";

const MODULE_ICONS: Record<string, React.ElementType> = {
  finance: Landmark,
  material: Package,
  engineering: HardHat,
  crm: Building2,
  sales: ShoppingCart,
  "sales-automation": Megaphone,
  followup: ClipboardList,
  ticket: MessageSquare,
  records: FolderOpen,
  civilworkdpr: HardHat,
  loan: Wallet,
  "fixed-asset": Cpu,
  maintenance: Wrench,
  "hr-payroll": Users,
  admin: Settings,
  dba: Database,
  super_admin: ShieldCheck,
};

function Row({ entry, value, onSelect, showModule }: {
  entry: CompassEntry;
  /** cmdk needs a unique value per row; a page can appear in Recent and Modules at once. */
  value: string;
  onSelect: (e: CompassEntry) => void;
  showModule?: boolean;
}) {
  const Icon = MODULE_ICONS[entry.moduleId] ?? FolderOpen;
  const sub = [showModule ? entry.module : null, entry.group].filter(Boolean).join(" · ");
  return (
    <CommandItem value={value} onSelect={() => onSelect(entry)} className="gap-3 py-2.5 cursor-pointer">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-foreground">{entry.label}</span>
        {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </CommandItem>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
    {children}
  </kbd>
);

export function CompassDialog() {
  const { open, closeCompass, entries, recent, select, shortcut } = useCompass();
  const [query, setQuery] = useState("");

  // Never show last time's query when reopened.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const hasQuery = query.trim().length > 0;
  const results = useMemo(() => searchEntries(entries, query), [entries, query]);
  const groups = useMemo(() => groupByModule(results), [results]);
  const landings = useMemo(() => moduleLandings(entries), [entries]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeCompass()}>
      <DialogContent
        hideCloseButton
        className="top-[16%] translate-y-0 gap-0 overflow-hidden p-0 sm:p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Find a page</DialogTitle>
        <DialogDescription className="sr-only">
          Type to search every page you have access to, then press Enter to open it.
        </DialogDescription>

        {/* Our own ranking (label > alias > section > module); cmdk's built-in filter is off. */}
        <Command shouldFilter={false} loop className="bg-transparent">
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search pages…  (try “invoice”, “brs”, “finance po”)"
          />
          <CommandList className="max-h-[min(60vh,420px)] thin-scroll">
            {hasQuery ? (
              results.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No pages match “{query.trim()}”.
                </div>
              ) : (
                groups.map((g) => (
                  <CommandGroup key={g.moduleId} heading={g.module}>
                    {g.entries.map((e) => (
                      <Row key={e.route} entry={e} value={e.route} onSelect={select} />
                    ))}
                  </CommandGroup>
                ))
              )
            ) : (
              <>
                {recent.length > 0 && (
                  <CommandGroup
                    heading={
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" /> Recent
                      </span>
                    }
                  >
                    {recent.map((e) => (
                      <Row key={e.route} entry={e} value={`recent:${e.route}`} onSelect={select} showModule />
                    ))}
                  </CommandGroup>
                )}
                <CommandGroup heading="Jump to a module">
                  {landings.map((e) => (
                    <CommandItem
                      key={e.moduleId}
                      value={`module:${e.moduleId}`}
                      onSelect={() => select(e)}
                      className="gap-3 py-2.5 cursor-pointer"
                    >
                      {React.createElement(MODULE_ICONS[e.moduleId] ?? FolderOpen, {
                        className: "h-4 w-4 shrink-0 text-muted-foreground",
                      })}
                      <span className="text-sm text-foreground">{e.module}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
            <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
          </span>
          <span className="hidden sm:flex items-center gap-1">
            <Kbd>{shortcut.primary}</Kbd>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
