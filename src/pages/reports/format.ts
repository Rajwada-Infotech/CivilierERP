// Every ExportColumn accessor below feeds both the on-screen preview table
// AND the exported CSV/Excel file (same accessor, no separate formatter) —
// no ₹ glyph and no thousands separators, so exported amounts stay real,
// Excel-parseable numbers instead of text (matches the convention already
// used in Vendor Ledger's and Expense Booking's own exports).
export const fmt = (n: number | undefined | null) =>
  n == null ? "—" : Number(n).toFixed(2);

// Civil Work DPR reports that show their own Project picker above the table.
export const CWD_INLINE_PROJECT_REPORTS = new Set([
  "cwd-activity-status",
  "cwd-overdue",
  "cwd-engineer-workload",
  "cwd-quality-checks",
  "cwd-daily-updates",
  "cwd-daily-reports",
  "cwd-user-daily-work",
  "cwd-tag-wise",
]);

// Civil Work DPR report cells.
export const cwdDate = (v: unknown) => (v ? String(v).slice(0, 10) : "—");
export const cwdPercent = (v: unknown) => (v == null || v === "" ? "—" : `${Math.round(Number(v) * 10) / 10}%`);
export const cwdStatusLabel = (v: unknown) =>
  v
    ? String(v)
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "—";
