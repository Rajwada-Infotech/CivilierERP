// Searching a list of HSN / SAC codes as someone types: the code they typed comes first.
// Order: the exact code, codes starting with it, codes containing it, then a match in the description.
// Each group keeps the list's own order. Spaces and dots in codes are ignored ("3917 40" finds 39174000).
const norm = (s: string) => s.replace(/[\s.]/g, "").toLowerCase();

export function rankHsn<T>(rows: T[], query: string, code: (r: T) => string, desc: (r: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const qc = norm(q);
  const buckets: T[][] = [[], [], [], []];
  for (const r of rows) {
    const c = norm(code(r) || "");
    if (qc && c === qc) buckets[0].push(r);
    else if (qc && c.startsWith(qc)) buckets[1].push(r);
    else if (qc && c.includes(qc)) buckets[2].push(r);
    else if ((desc(r) || "").toLowerCase().includes(q)) buckets[3].push(r);
  }
  return buckets.flat();
}
