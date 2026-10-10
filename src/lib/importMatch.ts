// Shared name matching for Excel imports (FA Inventory, Work Order, ...).
// Master names are compared trimmed and case/space-insensitive — names such as "RAJWADA CITY "
// or "Mobile " carry trailing spaces nobody can see in Excel.

export const normText = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const lev = (a: string, b: string): number => {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
};

/** Up to 3 master names that look like what was typed, as a " — did you mean …?" hint. */
export function didYouMean(input: string, names: string[]): string {
  const q = normText(input);
  if (!q) return "";
  const hits = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
    .map((n) => ({ n, k: normText(n) }))
    .filter(({ k }) => k.includes(q) || q.includes(k) || lev(q, k) <= Math.max(2, Math.floor(q.length * 0.3)))
    .slice(0, 3)
    .map(({ n }) => `"${n}"`);
  return hits.length ? ` — did you mean ${hits.join(" / ")}?` : "";
}
