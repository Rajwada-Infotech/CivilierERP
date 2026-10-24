import type { RefObject } from "react";
import { Command as CommandPrimitive } from "cmdk";
import type { CompassEntry } from "./compassRegistry";
import type { CompassGroup } from "./compassSearch";
import { CompassRow } from "./CompassRow";
import { CompassSection } from "./CompassSection";

// What sits under the search line: the matching pages grouped by module while there's a query, otherwise the pages
// visited recently and an index of modules to jump to. Rows are numbered straight down the list.
export function CompassResults({
  listRef,
  query,
  groups,
  recent,
  landings,
  onSelect,
}: {
  /** The scrolling list, so the panel can put it back at the top. */
  listRef?: RefObject<HTMLDivElement>;
  query: string;
  groups: CompassGroup[];
  recent: CompassEntry[];
  landings: CompassEntry[];
  onSelect: (e: CompassEntry) => void;
}) {
  const q = query.trim();
  let n = 0;

  return (
    <CommandPrimitive.List ref={listRef} className="thin-scroll" label="Pages">
      {q ? (
        groups.length === 0 ? (
          <p className="c-empty">No pages match “{q}”.</p>
        ) : (
          groups.map((g) => (
            <CompassSection key={g.moduleId} title={g.module} count={g.entries.length}>
              {g.entries.map((e) => (
                <CompassRow key={e.route} entry={e} value={e.route} index={++n} onSelect={onSelect} />
              ))}
            </CompassSection>
          ))
        )
      ) : (
        <>
          {recent.length > 0 && (
            <CompassSection title="Recent" count={recent.length}>
              {recent.map((e) => (
                <CompassRow key={e.route} entry={e} value={`recent:${e.route}`} index={++n} onSelect={onSelect} showModule />
              ))}
            </CompassSection>
          )}
          <CompassSection title="Jump to a module" count={landings.length} className="c-modules">
            {landings.map((e) => (
              <CompassRow
                key={e.moduleId}
                entry={e}
                value={`module:${e.moduleId}`}
                index={++n}
                onSelect={onSelect}
                title={e.module}
              />
            ))}
          </CompassSection>
        </>
      )}
    </CommandPrimitive.List>
  );
}
