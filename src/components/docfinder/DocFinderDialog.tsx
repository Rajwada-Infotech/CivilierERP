import React, { useEffect, useMemo, useState } from "react";
import { FileSearch, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { type DocSearchResult } from "./docFinderApi";
import { useDocFinder, useDocSearch } from "./useDocFinder";

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground">
    {children}
  </kbd>
);

/** "2026-04-01T00:00:00.000Z" -> "01/04/2026" without a timezone shift (these are date-only columns). */
function fmtDay(value: string | null): string {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function Row({ r, onSelect }: { r: DocSearchResult; onSelect: (r: DocSearchResult) => void }) {
  const meta = [fmtDay(r.date), r.status].filter(Boolean).join(" · ");
  return (
    <CommandItem
      value={`${r.table}:${r.id}`}
      onSelect={() => onSelect(r)}
      className="cursor-pointer items-start gap-3 py-2.5"
    >
      <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-sm text-foreground">{r.docNo}</span>
        {(meta || r.subtitle) && (
          <span className="truncate text-[0.6875rem] text-muted-foreground">
            {[meta, r.subtitle].filter(Boolean).join(" — ")}
          </span>
        )}
      </span>
      {r.amount != null && (
        <span className="shrink-0 pt-0.5 text-sm tabular-nums text-foreground">₹ {inr.format(Number(r.amount))}</span>
      )}
    </CommandItem>
  );
}

export function DocFinderDialog() {
  const { open, closeDocFinder, openResult } = useDocFinder();
  const [query, setQuery] = useState("");
  const search = useDocSearch(query, open);

  // Never show last time's query or results when reopened.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const groups = useMemo(() => {
    const byType = new Map<string, DocSearchResult[]>();
    for (const r of search.results) {
      if (!byType.has(r.type)) byType.set(r.type, []);
      byType.get(r.type)!.push(r);
    }
    return [...byType];
  }, [search.results]);

  const trimmed = query.trim();
  let body: React.ReactNode;
  if (search.belowMin) {
    body = (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        Type a document number — e.g. <span className="font-mono">SU-2026-00011</span> — or just its last digits.
      </div>
    );
  } else if (search.isError) {
    body = <div className="px-4 py-10 text-center text-sm text-destructive">Search failed. Try again.</div>;
  } else if (search.pending && search.results.length === 0) {
    body = (
      <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Searching…
      </div>
    );
  } else if (search.results.length === 0) {
    body = (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">No document found for “{trimmed}”.</div>
    );
  } else {
    body = groups.map(([type, rows]) => (
      <CommandGroup key={type} heading={type}>
        {rows.map((r) => (
          <Row key={`${r.table}:${r.id}`} r={r} onSelect={openResult} />
        ))}
      </CommandGroup>
    ));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDocFinder()}>
      <DialogContent hideCloseButton className="top-[16%] translate-y-0 gap-0 overflow-hidden p-0 sm:p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Find a document</DialogTitle>
        <DialogDescription className="sr-only">
          Type a document number, then press Enter to open the document.
        </DialogDescription>

        {/* Ranking is done server-side (exact > prefix > contains); cmdk's own filter is off. */}
        <Command shouldFilter={false} loop className="bg-transparent">
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Find a document by number…  (SU-2026-00011, JV-…, 00279)"
          />
          <CommandList className="max-h-[min(60vh,420px)] thin-scroll">{body}</CommandList>
        </Command>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-2 text-[0.6875rem] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
            <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Kbd>Alt</Kbd><Kbd>Shift</Kbd><Kbd>D</Kbd>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
