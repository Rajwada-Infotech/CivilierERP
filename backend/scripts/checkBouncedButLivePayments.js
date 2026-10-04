// Read-only diagnostic: finds every payment/received-payment/fund-transfer
// marked as bounced in BankReconciliation whose GL posting is still live
// (never reversed) — the gap that brs.js's PUT /:sourceType/:sourceId/bounce
// used to leave open (it only wrote BankReconciliation, never touched
// GeneralLedgerEntry). The endpoint itself is now fixed for BOUNCE actions
// going forward; this script finds the historical backlog that predates the
// fix and still needs a one-time reversal.
//
// Usage:
//   node backend/scripts/checkBouncedButLivePayments.js

const { connectDB, getPool, closeDB, sql } = require("../db");

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

  console.log(`Found ${bouncedRes.recordset.length} row(s) marked IsBounced=1.\n`);

  let stillLiveCount = 0;
  let totalLiveAmount = 0;

  for (const row of bouncedRes.recordset) {
    const candidates = GL_SOURCE_TYPES[row.SourceType];
    if (!candidates) {
      console.log(`${row.SourceType} ${row.SourceID}: no GL mapping (skipped — needs manual check)`);
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
    if (found) {
      stillLiveCount++;
      const amt = found.legs.reduce((s, l) => s + (Number(l.DebitAmount) || Number(l.CreditAmount) || 0), 0) / 2;
      totalLiveAmount += amt;
      console.log(`⚠ ${row.SourceType} ${row.SourceID} (bounced ${row.BounceDate ? new Date(row.BounceDate).toISOString().slice(0,10) : "?"}, reason: ${row.BounceReason}) — STILL LIVE in GL under ${found.glSourceType}, ${found.legs.length} leg(s), ~₹${fmt(amt)}`);
    } else {
      console.log(`✓ ${row.SourceType} ${row.SourceID} — already reversed or never posted`);
    }
  }

  console.log(`\n${stillLiveCount} bounced source(s) still have a live GL posting, totaling ~₹${fmt(totalLiveAmount)}.`);

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
