import { useMemo, useState } from "react";
import { Link2, Search, X } from "lucide-react";
import type { DependencyMasterListRow, LadderActivity } from "@/api/dependencyMasterApi";
import { dependencyAutoName, matchesAutoNameSearch } from "@/lib/dependencyAutoName";

const MAX_RESULTS = 25;

interface Props {
  chains: DependencyMasterListRow[];
  onPick: (rung: LadderActivity, chain: DependencyMasterListRow) => void;
}

/**
 * Search every activity by its Auto Name ("NS/n1/101, Hall Room and 2.1 Column and Beam …") — or any
 * part of it — and jump straight to its allocation, instead of walking Project → Tower → Floor →
 * Flat → Room. Every word typed must match somewhere in the activity's name or location.
 */
/** Matching activities (by Auto Name or any part of it) for a query over a set of chains. */
export function useAutoNameMatches(chains: DependencyMasterListRow[], query: string) {
  const entries = useMemo(
    () =>
      chains.flatMap((chain) =>
        (chain.activities ?? [])
          .filter((r) => r.rungId != null)
          .map((rung) => ({
            rung,
            chain,
            autoName: dependencyAutoName({ flatName: chain.flatName, alias: chain.alias, roomName: chain.roomName, storey: chain.storey, activityName: rung.activityName }),
          })),
      ),
    [chains],
  );
  const q = query.trim();
  return useMemo(
    () =>
      q.length < 2
        ? []
        : entries.filter((e) => matchesAutoNameSearch(q, [e.autoName, e.chain.alias, e.chain.projectName, e.chain.towerName, e.chain.scopePath])),
    [entries, q],
  );
}

/** The list of matches — each row shows the Auto Name and where it is; clicking one picks it. */
export function AutoNameResults({ chains, query, onPick }: Props & { query: string }) {
  const q = query.trim();
  const results = useAutoNameMatches(chains, query);
  if (q.length < 2) return null;
  return (
    <div className="mt-3">
      {results.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No activity matches "{q}".</p>
      ) : (
        <>
          <p className="text-[0.6875rem] text-muted-foreground mb-1.5">
            {results.length} activit{results.length === 1 ? "y" : "ies"} match
            {results.length > MAX_RESULTS ? ` — showing the first ${MAX_RESULTS}, type more to narrow it down` : ""}
          </p>
          <ul className="divide-y divide-border/60 rounded-lg border border-border max-h-72 overflow-y-auto bg-card">
            {results.slice(0, MAX_RESULTS).map((e) => (
              <li key={e.rung.rungId}>
                <button onClick={() => onPick(e.rung, e.chain)} className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors">
                  <p className="text-sm font-medium text-foreground">{e.autoName}</p>
                  <p className="text-[0.6875rem] text-muted-foreground">{e.chain.projectName ? `${e.chain.projectName} > ` : ""}{e.chain.scopePath}</p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function AutoNameFinder({ chains, onPick }: Props) {
  const [query, setQuery] = useState("");
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden mb-4">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/30">
        <Link2 size={14} className="text-cyan-600 dark:text-cyan-400" />
        <span className="text-sm font-heading font-semibold text-foreground">Find by Auto Name</span>
        <span className="text-[0.6875rem] text-muted-foreground">flat, room and activity in any order</span>
      </div>
      <div className="p-3.5 sm:p-5">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. NS/n1/101, Hall Room and 2.1 Column and Beam…"
            className="w-full pl-8 pr-8 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear">
              <X size={13} />
            </button>
          )}
        </div>
        <AutoNameResults chains={chains} query={query} onPick={onPick} />
      </div>
    </div>
  );
}
