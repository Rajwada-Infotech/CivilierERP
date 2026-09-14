/**
 * Compress a Financial Year master's display name (e.g. "FY 2026-2027",
 * "AY24-25", "2025-26", "Financial Year 2026 to 2027") into the short
 * "YY-YY" form used inside generated document numbers (e.g. "26-27").
 *
 * The old implementation (`name.split("-")`, keep only if exactly 2 parts)
 * silently returned the *raw* name unchanged for anything that wasn't a
 * single, perfectly-formed "2025-2026"-style string — any extra dash, a
 * "FY " prefix containing a space-before-dash, or no dash at all (a name
 * typed as plain text) fell through untouched. That raw, inconsistent
 * string would then get embedded directly into the document number
 * (`{ProjectCode}-{ModuleCode}/{Serial}/{FinYear}`), which is what caused
 * saves to intermittently fail across Material Request, Purchase Order,
 * Vehicle In/Out, GRN, Invoice, Issues and Payment — whichever pages
 * happened to pass the un-shortened name produced a doc-number string that
 * didn't match what the backend's lock/uniqueness check expected.
 *
 * This version extracts digit groups directly, so it tolerates any letters,
 * spacing, or separators around the years.
 */
export function toShortFinYear(name: string | null | undefined): string {
  if (!name) return "";
  const digitGroups = name.match(/\d+/g) ?? [];

  if (digitGroups.length >= 2) {
    const start = digitGroups[0].slice(-2);
    const end = digitGroups[1].slice(-2);
    return `${start}-${end}`;
  }

  if (digitGroups.length === 1 && digitGroups[0].length >= 4) {
    // Only one year found (e.g. "FY2026") — derive the following year.
    const startYear = Number(digitGroups[0].slice(-4));
    const start = String(startYear).slice(-2);
    const end = String(startYear + 1).slice(-2);
    return `${start}-${end}`;
  }

  // Genuinely no recognizable year — fall back to the trimmed original
  // rather than silently producing an empty/garbled doc number segment.
  return name.trim();
}
