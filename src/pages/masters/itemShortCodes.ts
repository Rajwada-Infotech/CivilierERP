// Item short codes must be unique across items (case-insensitive, spaces ignored — the same rule the server
// enforces). These helpers find the items that already share a code and suggest a free replacement.

export const SHORT_CODE_MAX = 20;

export const normalizeCode = (code: string | null | undefined): string => (code ?? "").trim().toUpperCase();

export interface CodedItem {
  _id: string;
  itemName: string;
  shortCode: string;
}

export interface DuplicateGroup<T extends CodedItem> {
  /** The code as most items spell it (first item's spelling). */
  code: string;
  items: T[];
}

/** Every short code used by more than one item, with those items. Items without a code are ignored. */
export function findDuplicateShortCodes<T extends CodedItem>(items: T[]): DuplicateGroup<T>[] {
  const byCode = new Map<string, T[]>();
  for (const item of items) {
    const key = normalizeCode(item.shortCode);
    if (!key) continue;
    const list = byCode.get(key);
    if (list) list.push(item);
    else byCode.set(key, [item]);
  }
  return [...byCode.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({ code: list[0].shortCode.trim(), items: list }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * A code nobody uses yet, based on `code`: the code + 2, 3, … (A → A2). Always within the 20-character
 * limit — a long code is shortened to make room for the number.
 */
export function suggestFreeShortCode(code: string, items: CodedItem[]): string {
  const taken = new Set(items.map((i) => normalizeCode(i.shortCode)));
  const base = code.trim();
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate = `${base.slice(0, SHORT_CODE_MAX - suffix.length)}${suffix}`;
    if (!taken.has(normalizeCode(candidate))) return candidate;
  }
  return base;
}
