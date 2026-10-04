// One-time backfill: reverses the GL posting for every payment / received
// payment / fund transfer that's already marked IsBounced=1 in
// BankReconciliation but whose GeneralLedgerEntry legs were never reversed
// — the gap in the OLD version of brs.js's PUT /:sourceType/:sourceId/bounce
// endpoint (it only wrote BankReconciliation, never touched GL). That
// endpoint is now fixed for every bounce going forward; this script clears
// the historical backlog that predates the fix.
//
// A bounced cheque/transfer never actually moved the money, so leaving its
// GL leg live permanently overstates what was actually paid/received —
// this was confirmed as the root cause of S.S CONSTRUCTION's residual
// balance (PAY-2026-00163 bounced, PAY-2026-00164 reissued and cleared, but
// PAY-163's GL leg was never reversed until this backfill runs).
//
// Reversal only — flips IsReversed=1 on the live legs, same audit-trail
// convention as every other reversal in this codebase (never a physical
// delete, see services/generalLedger.js's reversePostingBySource).
//
// Dry-run by default — prints what WOULD be reversed without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/reverseBouncedPaymentGL.js
//   node backend/scripts/reverseBouncedPaymentGL.js --apply

const { connectDB, getPool, closeDB, sql } = require("../db");

const APPLY = process.argv.includes("--apply");

const GL_SOURCE_TYPES = {
  PAYMENT: ["PaymentPosting", "NewPayment"],
  RECEIVED: ["ReceivedPayment"],
  FUND_TRANSFER_OUT: ["FundTransfer"],
  FUND_TRANSFER_IN: ["FundTransfer"],
};

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const bouncedRes = await pool.request().query(`
    SELECT BRSID, SourceType, SourceID, BounceDate, BounceReason
    FROM dbo.BankReconciliation
    WHERE IsBounced = 1
    ORDER BY SourceType, SourceID
  `);

  console.log(`Found ${bouncedRes.recordset.length} row(s) marked IsBounced=1. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  let reversedCount = 0;
  let totalAmount = 0;

  for (const row of bouncedRes.recordset) {
    const candidates = GL_SOURCE_TYPES[row.SourceType];
    if (!candidates) {
      console.log(`${row.SourceType} ${row.SourceID}: no GL mapping (skipped — needs manual check, e.g. CRM_RECEIVED/LOAN_*)`);
      continue;
    }

    let found = null;
    for (const glSourceType of candidates) {
      const legRes = await pool.request()
        .input("SourceType", sql.NVarChar(50), glSourceType)
        .input("SourceId", sql.Int, row.SourceID)
        .query(`
          SELECT EntryId, LHeadId, DebitAmount, CreditAmount
          FROM dbo.GeneralLedgerEntry
          WHERE SourceType = @SourceType AND SourceId = @SourceId AND IsReversed = 0
        `);
      if (legRes.recordset.length) { found = { glSourceType, legs: legRes.recordset }; break; }
    }

    if (!found) {
      console.log(`✓ ${row.SourceType} ${row.SourceID} — already reversed or never posted, nothing to do`);
      continue;
    }

    const amt = found.legs.reduce((s, l) => s + (Number(l.DebitAmount) || Number(l.CreditAmount) || 0), 0) / 2;
    reversedCount++;
    totalAmount += amt;
    console.log(`${row.SourceType} ${row.SourceID} (bounced ${row.BounceDate ? new Date(row.BounceDate).toISOString().slice(0, 10) : "?"}, reason: ${row.BounceReason}) — reversing ${found.legs.length} leg(s) under ${found.glSourceType}, ~₹${fmt(amt)}`);

    if (APPLY) {
      await pool.request()
        .input("SourceType", sql.NVarChar(50), found.glSourceType)
        .input("SourceId", sql.Int, row.SourceID)
        .query(`
          UPDATE dbo.GeneralLedgerEntry
          SET IsReversed = 1
          WHERE SourceType = @SourceType AND SourceId = @SourceId AND IsReversed = 0
        `);
    }
  }

  console.log(`\n${reversedCount} bounced source(s) ${APPLY ? "reversed" : "would be reversed"} (~₹${fmt(totalAmount)} total).`);
  if (!APPLY && reversedCount > 0) console.log("Re-run with --apply to write these changes.");

  await closeDB();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
