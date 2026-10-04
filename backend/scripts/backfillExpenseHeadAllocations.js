// One-off backfill: reverses and reposts every live SourceType='ExpenseBooking'
// (auto-post path) voucher whose booking has dbo.ExpenseHeadAllocation rows
// (migration 303 — a direct/TOD booking's own chosen GL head(s), e.g.
// "Director or Partner Remunaration" instead of the generic Purchase A/c)
// but whose posted legs still show the generic Purchase A/c debit instead
// — the bug fixed in services/generalLedger.js's postExpenseBookingApproval
// (it used to ignore ExpenseHeadAllocation entirely and always debit
// Purchase A/c). The manual 'InvoicePosting' path already respected
// allocations, so this only ever affects SourceType='ExpenseBooking' rows.
//
// GL entries are never edited in place — reverses the existing voucher
// (IsReversed=1) and reposts a corrected one with the SAME VoucherDate,
// using the exact same allocation-aware leg construction the (now-fixed)
// live posting function uses.
//
// Dry-run by default — prints what it WOULD change without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/backfillExpenseHeadAllocations.js
//   node backend/scripts/backfillExpenseHeadAllocations.js --apply

const { connectDB, getPool, closeDB, sql } = require("../db");
const { getAllocations } = require("../services/expenseHeadAllocation");
const { postVoucher, reversePostingBySource } = require("../services/generalLedger");

const APPLY = process.argv.includes("--apply");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  // Every ExpenseBooking with allocation rows AND a live SourceType=
  // 'ExpenseBooking' posting (the auto-post path this bug affected —
  // InvoicePosting already handled allocations correctly).
  const candidatesRes = await pool.request().query(`
    SELECT DISTINCT eb.Eid, eb.EDocNo, eb.EDocDate, eb.EAmount, eb.ENetAmount, eb.LHeadId,
           gle.VoucherNo AS OldVoucherNo, gle.CompanyId, gle.ProjectId
    FROM dbo.ExpenseBooking eb
    JOIN dbo.ExpenseHeadAllocation eha ON eha.SourceType = 'ExpenseBooking' AND eha.SourceId = eb.Eid
    JOIN dbo.GeneralLedgerEntry gle ON gle.SourceType = 'ExpenseBooking' AND gle.SourceId = eb.Eid AND gle.IsReversed = 0
    ORDER BY eb.Eid
  `);

  console.log(`Found ${candidatesRes.recordset.length} candidate booking(s) with allocation rows and a live ExpenseBooking-type posting. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  let changedCount = 0;

  for (const eb of candidatesRes.recordset) {
    const netAmount = Number(eb.ENetAmount ?? eb.EAmount) || 0;
    const allocations = await getAllocations(pool, sql, "ExpenseBooking", eb.Eid);
    const allocSum = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    if (Math.abs(allocSum - netAmount) >= 0.5) {
      console.log(`⚠ ${eb.EDocNo} (Eid ${eb.Eid}): allocation sum (${fmt(allocSum)}) doesn't match net amount (${fmt(netAmount)}) — skipping, needs manual review.`);
      continue;
    }

    const existingLegsRes = await pool.request().input("SrcId", sql.Int, eb.Eid).query(`
      SELECT EntryId, LHeadId, DebitAmount, CreditAmount, Narration
      FROM dbo.GeneralLedgerEntry WHERE SourceType = 'ExpenseBooking' AND SourceId = @SrcId AND IsReversed = 0
      ORDER BY EntryId
    `);
    const existingLegs = existingLegsRes.recordset;

    // Already correctly split across the allocation heads (no debit leg on
    // a head outside the allocation set) — nothing to fix.
    const allocHeadIds = new Set(allocations.map((a) => a.lHeadId));
    const alreadyCorrect = existingLegs
      .filter((l) => Number(l.DebitAmount) > 0)
      .every((l) => allocHeadIds.has(l.LHeadId));
    if (alreadyCorrect) continue;

    changedCount++;
    console.log(`${eb.EDocNo} (Eid ${eb.Eid}), currently ${eb.OldVoucherNo}:`);
    console.log(`  Current debit legs: ${existingLegs.filter((l) => Number(l.DebitAmount) > 0).map((l) => `LHeadId ${l.LHeadId}: ${fmt(l.DebitAmount)}`).join(", ")}`);
    console.log(`  Should be: ${allocations.map((a) => `${a.lHeadName} (${a.lHeadId}): ${fmt(a.amount)}`).join(", ")}`);

    if (APPLY) {
      const creditLeg = existingLegs.find((l) => Number(l.CreditAmount) > 0);
      await reversePostingBySource(pool, "ExpenseBooking", eb.Eid);
      const newVoucherNo = `${eb.OldVoucherNo}-BF`;
      await postVoucher(pool, {
        voucherNo: newVoucherNo,
        voucherDate: eb.EDocDate,
        sourceType: "ExpenseBooking",
        sourceId: eb.Eid,
        companyId: eb.CompanyId ?? null,
        projectId: eb.ProjectId ?? null,
        createdBy: "backfill-expense-head-allocations",
        legs: [
          ...allocations.map((a) => ({
            lHeadId: a.lHeadId,
            debit: a.amount,
            narration: `${eb.EDocNo} — ${a.lHeadName || "expense booked"}`,
          })),
          {
            lHeadId: creditLeg ? creditLeg.LHeadId : eb.LHeadId,
            credit: netAmount,
            narration: `${eb.EDocNo} — supplier/contractor liability`,
          },
        ],
      });
      console.log(`  → reversed ${eb.OldVoucherNo}, reposted as ${newVoucherNo}`);
    }
    console.log("");
  }

  console.log(`${changedCount} booking(s) ${APPLY ? "reclassified" : "would be reclassified"}.`);
  if (!APPLY && changedCount > 0) console.log("Re-run with --apply to write these changes.");

  await closeDB();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
