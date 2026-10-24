import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { moduleLandings } from "./compassRegistry";
import { groupByModule, searchEntries } from "./compassSearch";
import { useCompass } from "./useCompass";
import { COMPASS_CSS } from "./compassStyles";
import { CompassSearchHead } from "./CompassSearchHead";
import { CompassResults } from "./CompassResults";
import { CompassFooter } from "./CompassFooter";

// The Compass panel: the search head, the results, and the key line, on one sheet.
//
// Sizing: it starts 10% down the screen and is at most 80% of its height, so its bottom never leaves the screen;
// the head and footer keep their size and only the result list between them scrolls (see compassStyles.ts for why
// the panel itself can't be scrolled).
//
// Highlight and scroll: the first row is highlighted (the latest Recent page, or the best match) and the list sits at
// the top whenever the panel opens or the query changes. Left to cmdk, the highlight could land further down and get
// scrolled into view while the panel was still animating open, leaving the list scrolled to the middle.
export function CompassDialog() {
  const { open, closeCompass, entries, recent, select, shortcut } = useCompass();
  const [query, setQuery] = useState("");

  // Never show last time's query when reopened.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const results = useMemo(() => searchEntries(entries, query), [entries, query]);
  const groups = useMemo(() => groupByModule(results), [results]);
  const landings = useMemo(() => moduleLandings(entries), [entries]);

  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState("");
  const first = query.trim()
    ? (groups[0]?.entries[0]?.route ?? "")
    : recent[0]
      ? `recent:${recent[0].route}`
      : landings[0]
        ? `module:${landings[0].moduleId}`
        : "";
  useLayoutEffect(() => {
    if (!open) return;
    setActive(first);
    const toTop = () => { if (listRef.current) listRef.current.scrollTop = 0; };
    toTop();
    // Once more after the open animation, in case anything scrolled the list while it ran.
    const raf = requestAnimationFrame(toTop);
    const t = window.setTimeout(toTop, 250);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
    // `first` changes with the query and with the lists; the reset follows it.
  }, [open, first]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeCompass()}>
      <DialogContent
        hideCloseButton
        className="compass-sheet top-[10dvh] translate-y-0 flex flex-col gap-0 p-0 sm:p-0 sm:max-w-2xl max-h-[80dvh] overflow-clip"
      >
        <style>{COMPASS_CSS}</style>
        <DialogTitle className="sr-only">Find a page</DialogTitle>
        <DialogDescription className="sr-only">
          Type to search every page you have access to, then press Enter to open it.
        </DialogDescription>

        {/* Our own ranking (label > alias > section > module); cmdk's built-in filter is off. */}
        <CommandPrimitive shouldFilter={false} loop value={active} onValueChange={setActive} className="flex min-h-0 flex-1 flex-col" label="Find a page">
          <CompassSearchHead query={query} onQuery={setQuery} />
          <CompassResults listRef={listRef} query={query} groups={groups} recent={recent} landings={landings} onSelect={select} />
        </CommandPrimitive>

        <CompassFooter shortcut={shortcut.primary} />
      </DialogContent>
    </Dialog>
  );
}
