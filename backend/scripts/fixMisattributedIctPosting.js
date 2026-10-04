// One-off fix for Inter-Company Stock Transfers approved before the
// loadStoredTransferContext company-override fix (routes/interCompanyTransfer.js):
// GL posted under the sending/receiving PROJECT's primary company instead of
// the cross-tag override already stored on dbo.InterCompanyTransfer
// (SenderCompanyId/ReceiverCompanyId) — e.g. ICT-2026-00003 posted under
// "Yashvi Construction" (Pristine Enclave's primary company) instead of
// "Delta Gardens" (the company it's actually tagged/transacting as).
//
// For every Completed transfer whose live GL legs' CompanyId set doesn't
// match {SenderCompanyId, ReceiverCompanyId} exactly:
//   1. Reverses the existing (wrong-company) voucher via reversePostingBySource
//      (IsReversed=1 on both companies' legs — same as every other reversal
//      in this codebase; nothing is deleted).
//   2. Reposts with postInterCompanyStockTransferToGL using the stored,
//      correct SenderCompanyId/ReceiverCompanyId — same voucher amount,
//      same DocNo, same date.
//
// Dry-run by default — prints what it WOULD fix without touching the
// database. Pass --apply to actually reverse + repost.
//
// Usage:
//   node backend/scripts/fixMisattributedIctPosting.js
//   node backend/scripts/fixMisattributedIctPosting.js --apply
//   node backend/scripts/fixMisattributedIctPosting.js --apply --id=<ICTId>   (one transfer only)

const { connectDB, getPool, sql, closeDB } = require("../db");
const { reversePostingBySource } = require("../services/generalLedger");
const { postInterCompanyStockTransferToGL } = require("../services/interCompanyStockTransferGL");

const APPLY = process.argv.includes("--apply");
const idArg = process.argv.find((a) => a.startsWith("--id="));
const ONLY_ID = idArg ? parseInt(idArg.split("=")[1], 10) : null;

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const ictReq = pool.request();
  if (ONLY_ID) ictReq.input("onlyId", sql.Int, ONLY_ID);
  const ictRes = await ictReq.query(`
    SELECT ict.ICTId, ict.DocNo, ict.TransferDate, ict.SenderCompanyId, ict.ReceiverCompanyId,
           ict.TotalAmount, ict.TotalGstAmount, ict.TotalAmountInclGst, ict.Status,
           sc.name AS SenderCompanyName, rc.name AS ReceiverCompanyName
    FROM dbo.InterCompanyTransfer ict
    LEFT JOIN dbo.enterprise sc ON sc.id = ict.SenderCompanyId
    LEFT JOIN dbo.enterprise rc ON rc.id = ict.ReceiverCompanyId
    WHERE ict.Status = 'Completed'
    ${ONLY_ID ? "AND ict.ICTId = @onlyId" : ""}
    ORDER BY ict.ICTId
  `);

  console.log(`Checking ${ictRes.recordset.length} Completed Inter-Company Transfer(s)...\n`);

  let mismatched = 0;
  for (const ict of ictRes.recordset) {
    const legsRes = await pool.request().input("id", sql.Int, ict.ICTId).query(`
      SELECT DISTINCT CompanyId FROM dbo.GeneralLedgerEntry
      WHERE SourceType = 'InterCompanyTransfer' AND SourceId = @id AND IsReversed = 0
    `);
    const postedCompanyIds = new Set(legsRes.recordset.map((r) => r.CompanyId));
    const expected = new Set([ict.SenderCompanyId, ict.ReceiverCompanyId]);
    const matches = postedCompanyIds.size === expected.size && [...expected].every((id) => postedCompanyIds.has(id));
    if (matches) continue;

    mismatched++;
    console.log(`⚠ ${ict.DocNo} (ICTId ${ict.ICTId}): posted under CompanyId {${[...postedCompanyIds].join(", ")}}, should be Sender=${ict.SenderCompanyName} (${ict.SenderCompanyId}) / Receiver=${ict.ReceiverCompanyName} (${ict.ReceiverCompanyId}). Amount ₹${fmt(ict.TotalAmountInclGst ?? ict.TotalAmount)}.`);

    if (!APPLY) continue;

    await reversePostingBySource(pool, "InterCompanyTransfer", ict.ICTId);
    const result = await postInterCompanyStockTransferToGL(pool, {
      transferId: ict.ICTId,
      docNo: ict.DocNo,
      transferDate: ict.TransferDate,
      senderCompanyId: ict.SenderCompanyId,
      senderCompanyName: ict.SenderCompanyName,
      receiverCompanyId: ict.ReceiverCompanyId,
      receiverCompanyName: ict.ReceiverCompanyName,
      totalAmount: Number(ict.TotalAmountInclGst ?? ict.TotalAmount),
      createdBy: "fixMisattributedIctPosting.js",
    });
    console.log(`    ${result.posted ? "Reposted correctly." : `Repost failed: ${result.reason}`}`);
  }

  console.log(`\n${mismatched} of ${ictRes.recordset.length} Completed transfer(s) were posted under the wrong company.`);
  if (!APPLY && mismatched > 0) console.log("Dry run. Re-run with --apply to reverse and repost the ones listed above.");
  if (APPLY) {
    console.log("\nDon't forget to bump caches: trial-balance, general-ledger, balance-sheet, account-head-master, stock-transfers.");
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Fix failed:", err);
  process.exit(1);
});
