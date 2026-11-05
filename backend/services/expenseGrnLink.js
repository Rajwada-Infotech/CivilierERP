"use strict";

// Which invoices (ExpenseBooking) a GRN went into. An invoice is booked on one GRN (ESourceType 'GRN', ESourceId), or
// several GRNs of one PO are merged into it (migration 194): then ESourceId holds only the first and ELinkedGrnIds the
// JSON array of all of them. Looking at ESourceId alone showed a merged invoice on its first GRN only — the others
// read as not invoiced — so everything that asks "which invoice has this GRN" goes through here.

/** SQL predicate: the ExpenseBooking row (alias `a`, or none) covers the GRN id held by the parameter `param`. */
function ebCoversGrnSql(a, param) {
  const p = a ? `${a}.` : "";
  return `(${p}ESourceType = 'GRN' AND (${p}ESourceId = ${param}
    OR (${p}ELinkedGrnIds IS NOT NULL AND EXISTS (SELECT 1 FROM OPENJSON(${p}ELinkedGrnIds) WHERE TRY_CAST(value AS INT) = ${param}))))`;
}

/** Every GRN id an invoice row covers, first (ESourceId) first. */
function grnIdsOfExpense(eb) {
  const ids = [];
  const first = parseInt(eb?.ESourceId, 10);
  if (Number.isFinite(first)) ids.push(first);
  if (eb?.ELinkedGrnIds) {
    try {
      for (const v of JSON.parse(eb.ELinkedGrnIds)) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && !ids.includes(n)) ids.push(n);
      }
    } catch {
      /* a malformed list leaves the first GRN only */
    }
  }
  return ids;
}

module.exports = { ebCoversGrnSql, grnIdsOfExpense };
