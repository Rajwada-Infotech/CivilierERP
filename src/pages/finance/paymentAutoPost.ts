// The Payment posting tab posts a payment's unposted entries to the general ledger by itself, one at a time. This is
// the rule for which entry goes next.
//
// An entry whose post FAILED is never picked again automatically. (It used to be: each failure re-ran the effect,
// which found the same entry still unposted and posted it again straight away - a loop at network speed that, under
// the rate limit, locked every user out.) The person retries it on purpose.

export interface AutoPostEntry {
  type: string;
  pmtId: number;
  isPosted?: boolean;
  isBounced?: boolean;
}

export const autoPostKey = (e: Pick<AutoPostEntry, "type" | "pmtId">): string => `${e.type}:${e.pmtId}`;

export function nextEntryToAutoPost<T extends AutoPostEntry>(entries: T[], failed: ReadonlySet<string>): T | undefined {
  return entries.find(
    // Debit notes post themselves on save and have no post-to-gl endpoint.
    (e) => !e.isPosted && !e.isBounced && e.type !== "debit_note" && !failed.has(autoPostKey(e)),
  );
}

export const autoPostUrl = (e: Pick<AutoPostEntry, "type" | "pmtId">): string =>
  e.type === "bounce_charge" ? `/api/new-payment/${e.pmtId}/post-bounce-charge-to-gl` : `/api/new-payment/${e.pmtId}/post-to-gl`;
