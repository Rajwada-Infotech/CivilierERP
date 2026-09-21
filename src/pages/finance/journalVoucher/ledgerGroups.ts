import type { JournalVoucherLedgerOption } from "@/api/journalVoucherApi";

// Display order + labels for the picker's groups. The keys are computed by the
// server (backend/utils/ledgerOptionGroup.js) because LHeadType alone can't
// tell a Landlord from a Supplier, or a project's own ledger from a Contractor.
export const LEDGER_GROUPS: { key: string; label: string }[] = [
  { key: "general", label: "General Ledger" },
  { key: "bank", label: "Bank" },
  { key: "cash", label: "Cash" },
  { key: "customer", label: "Customer" },
  { key: "supplier", label: "Supplier" },
  { key: "landlord", label: "Landlord" },
  { key: "vendor", label: "Vendor" },
  { key: "contractor", label: "Contractor" },
  { key: "broker", label: "Broker" },
  { key: "partner", label: "Partners" },
  { key: "project", label: "Project Ledgers" },
  { key: "other", label: "Other" },
];

const GROUP_LABEL: Record<string, string> = Object.fromEntries(LEDGER_GROUPS.map((g) => [g.key, g.label]));
const GROUP_ORDER: Record<string, number> = Object.fromEntries(LEDGER_GROUPS.map((g, i) => [g.key, i]));

export const ledgerGroupLabel = (key: string) => GROUP_LABEL[key] ?? GROUP_LABEL.other;

export interface LedgerGroup {
  key: string;
  label: string;
  options: JournalVoucherLedgerOption[];
}

/** Every whitespace-separated word of `query` must appear in the head's name,
 *  code, bank-account tail or group name (case-insensitive). */
export function filterLedgerOptions(options: JournalVoucherLedgerOption[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => {
    const hay = `${o.label} ${o.code ?? ""} ${o.accountNoLast4 ?? ""} ${ledgerGroupLabel(o.group)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Groups in the fixed display order (empty groups dropped), names A→Z within each. */
export function groupLedgerOptions(options: JournalVoucherLedgerOption[]): LedgerGroup[] {
  const byKey = new Map<string, JournalVoucherLedgerOption[]>();
  for (const o of options) {
    const key = o.group in GROUP_ORDER ? o.group : "other";
    const list = byKey.get(key) ?? [];
    list.push(o);
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .sort((a, b) => GROUP_ORDER[a[0]] - GROUP_ORDER[b[0]])
    .map(([key, opts]) => ({
      key,
      label: ledgerGroupLabel(key),
      options: [...opts].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    }));
}
