import type { CompassEntry } from "./compassRegistry";

interface Prepared {
  entry: CompassEntry;
  label: string;
  words: string[];
  group: string;
  module: string;
  keywords: string[];
}

// Lowercasing/word-splitting happens once per registry, not once per keystroke.
const cache = new WeakMap<CompassEntry[], Prepared[]>();

function prepare(entries: CompassEntry[]): Prepared[] {
  let p = cache.get(entries);
  if (!p) {
    p = entries.map((entry) => {
      const label = entry.label.toLowerCase();
      return {
        entry,
        label,
        words: label.split(/[^a-z0-9&]+/).filter(Boolean),
        group: (entry.group ?? "").toLowerCase(),
        module: entry.module.toLowerCase(),
        keywords: entry.keywords.map((k) => k.toLowerCase()),
      };
    });
    cache.set(entries, p);
  }
  return p;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/** Best score any field gives one query token; 0 means "no match". */
function tokenScore(t: string, p: Prepared): number {
  let best = 0;
  const hit = (s: number) => {
    if (s > best) best = s;
  };

  if (p.label === t) hit(100);
  else if (p.label.startsWith(t)) hit(90);
  else if (p.words.some((w) => w.startsWith(t))) hit(80);
  else if (p.label.includes(t)) hit(70);

  for (const k of p.keywords) {
    if (k === t) hit(65);
    else if (k.startsWith(t)) hit(60);
    else if (k.includes(t)) hit(50);
  }

  if (p.group) {
    if (p.group.startsWith(t)) hit(45);
    else if (p.group.includes(t)) hit(40);
  }
  if (p.module.startsWith(t)) hit(40);
  else if (p.module.includes(t)) hit(35);

  // Light typo/abbreviation tolerance ("purchs" / "pomstr"), only for longer
  // tokens so 1–2 letters don't match half the app.
  if (best === 0 && t.length >= 3 && isSubsequence(t, p.label)) hit(25);

  return best;
}

/**
 * Ranks entries against the query. Every whitespace-separated token must match
 * something (label, alias, section or module), so "finance invoice" narrows to
 * the Invoice page under Finance rather than every invoice in the app.
 */
export function searchEntries(entries: CompassEntry[], query: string, limit = 40): CompassEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: { entry: CompassEntry; score: number }[] = [];
  for (const p of prepare(entries)) {
    let total = 0;
    let ok = true;
    for (const t of tokens) {
      const s = tokenScore(t, p);
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (ok) scored.push({ entry: p.entry, score: total });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.label.length - b.entry.label.length ||
      a.entry.label.localeCompare(b.entry.label),
  );
  return scored.slice(0, limit).map((s) => s.entry);
}

export interface CompassGroup {
  moduleId: string;
  module: string;
  entries: CompassEntry[];
}

/**
 * Groups ranked results by module. Groups are ordered by their best-ranked
 * hit, so the most relevant module heading is on top.
 */
export function groupByModule(results: CompassEntry[]): CompassGroup[] {
  const groups = new Map<string, CompassGroup>();
  for (const e of results) {
    let g = groups.get(e.moduleId);
    if (!g) {
      g = { moduleId: e.moduleId, module: e.module, entries: [] };
      groups.set(e.moduleId, g);
    }
    g.entries.push(e);
  }
  return [...groups.values()];
}
