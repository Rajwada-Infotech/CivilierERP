// One-off correction for CrmOnAccountPayment rows whose GL debit leg landed
// on "CRM Collections A/c" instead of a real bank — the same
// missing-DepositBankId bug fixed for CrmOnAccountPayment Id 1 (Rohit Saha,
// manually) and self-healed going forward in postCrmOnAccountToGL (see
// backend/services/crmLedger.js). This script finds every OTHER affected
// row, backfills CrmOnAccountPayment.DepositBankId/DepositBankName from the
// source ReceivedPayment's RPDepositBankId/RPDepositBankName, reverses the
// old wrong-bank posting (flips IsReversed — audit-trail-preserving, same
// pattern as repostLegacyIntercompanyLoans.js), and reposts fresh with the
// correct bank. The credit leg to "Advance from Customers" is unaffected —
// it was already correct; only the debit (asset) side gets moved.
//
// Rows whose source ReceivedPayment has no bank on file either are
// reported and skipped, not guessed at.
//
// Dry-run by default — prints what it WOULD do without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/reclassifyCrmOnAccountBank.js
//   node backend/scripts/reclassifyCrmOnAccountBank.js --apply

require("../config/env").loadEnv();
const { connectDB, getPool, sql, closeDB } = require("../db");
const { reversePostingBySource } = require("../services/generalLedger");
const { postCrmOnAccountToGL } = require("../services/crmLedger");
const { recordGLPosting } = require("../services/approvalService");
const { bumpCacheVersion } = require("../redis");

const APPLY = process.argv.includes("--apply");
const ACTOR = "reclassify-crm-on-account-bank-script";

async function findCandidates(pool) {
  const head = await pool.request().query(`
    SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'CRM Collections A/c'
  `);
  const collectionsHeadId = head.recordset[0]?.LHeadId;
  if (!collectionsHeadId) return [];

  const result = await pool.request().input("id", sql.Int, collectionsHeadId).query(`
    SELECT
      oa.Id AS OnAccountId, oa.ReceiptNo, oa.Amount, oa.DepositBankId AS OaBankId,
      oa.SourceReceivedPaymentId,
      rp.RPDepositBankId, rp.RPDepositBankName
    FROM dbo.GeneralLedgerEntry gle
    JOIN dbo.CrmOnAccountPayment oa ON oa.Id = gle.SourceId AND gle.SourceType = 'CrmOnAccountPayment'
    LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = oa.SourceReceivedPaymentId
    WHERE gle.LHeadId = @id AND gle.IsReversed = 0 AND gle.DebitAmount > 0
    ORDER BY oa.Id ASC
  `);
  return result.recordset;
}

async function reclassify(pool, row) {
  // Backfill the snapshot even if a later run of the self-healing logic
  // inside postCrmOnAccountToGL would also do this — explicit here so the
  // script doesn't depend on which backend version is actually deployed.
  await pool.request()
    .input("id", sql.Int, row.OnAccountId)
    .input("bkid", sql.Int, row.RPDepositBankId)
    .input("bkname", sql.NVarChar(200), row.RPDepositBankName || null)
    .query(`UPDATE dbo.CrmOnAccountPayment SET DepositBankId = @bkid, DepositBankName = @bkname WHERE Id = @id`);

  await reversePostingBySource(pool, "CrmOnAccountPayment", row.OnAccountId);

  const outcome = await postCrmOnAccountToGL(pool, row.OnAccountId, ACTOR);
  await recordGLPosting("crm-on-account-payment", row.OnAccountId, outcome, ACTOR);
  return outcome;
}

async function main() {
  await connectDB();
  const pool = getPool();

  const candidates = await findCandidates(pool);
  if (candidates.length === 0) {
    console.log("No CrmOnAccountPayment rows currently debited to 'CRM Collections A/c'. Nothing to do.");
    await closeDB();
    return;
  }

  const ready = candidates.filter((r) => r.RPDepositBankId);
  const blocked = candidates.filter((r) => !r.RPDepositBankId);

  console.log(`Found ${candidates.length} row(s) debited to 'CRM Collections A/c'.\n`);

  if (blocked.length) {
    console.log("Blocked — source Received Payment has no bank on file either, add one there first:");
    for (const r of blocked) {
      console.log(`  ${r.ReceiptNo} (OnAccountId ${r.OnAccountId}, ₹${amtFmt(r.Amount)}) — SourceReceivedPaymentId ${r.SourceReceivedPaymentId ?? "none"}`);
    }
    console.log("");
  }

  if (ready.length === 0) {
    console.log("No rows are eligible to reclassify right now.");
    await closeDB();
    return;
  }

  console.log(`${ready.length} row(s) eligible to reverse + repost against the correct bank:`);
  for (const r of ready) {
    console.log(`  ${r.ReceiptNo} (OnAccountId ${r.OnAccountId}) — ₹${amtFmt(r.Amount)} → ${r.RPDepositBankName || `LHeadId ${r.RPDepositBankId}`}`);
  }

  if (!APPLY) {
    console.log("\n(dry run — pass --apply to reverse the wrong-bank posting and repost against the correct bank)");
    await closeDB();
    return;
  }

  console.log("");
  const summary = { done: 0, errored: 0 };
  for (const r of ready) {
    try {
      const outcome = await reclassify(pool, r);
      console.log(`  reclassified: ${r.ReceiptNo} (OnAccountId ${r.OnAccountId}) — ${outcome.posted ? "posted OK" : `not posted: ${outcome.reason}`}`);
      summary.done++;
    } catch (err) {
      console.error(`  ERROR: ${r.ReceiptNo} (OnAccountId ${r.OnAccountId}) — ${err.message}`);
      summary.errored++;
    }
  }

  await bumpCacheVersion("trial-balance");
  await bumpCacheVersion("general-ledger");
  await bumpCacheVersion("on-account");
  await bumpCacheVersion("bank-master");
  await bumpCacheVersion("balance-sheet");

  console.log(`\nDone. Reclassified ${summary.done}, errored ${summary.errored}.`);
  await closeDB();
}

function amtFmt(n) {
  return Number(n).toLocaleString("en-IN");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
