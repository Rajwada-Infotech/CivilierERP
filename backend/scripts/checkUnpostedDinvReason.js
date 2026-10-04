// Read-only diagnostic — no writes. For every "payment posted, invoice
// never posted" case (see auditVendorLedgerBalances.js Pattern 1), works
// out WHY postExpenseBookingApproval never successfully posted the
// invoice — most likely candidates for a non-GRN-sourced booking:
//   1. eb.EName doesn't exactly match any AccountHeadMaster.LHeadName
//      (getHeadIdByName does an exact string match — a rename, typo, or
//      trailing whitespace anywhere breaks this silently, posted:false,
//      no error surfaced to the user).
//   2. eb.ENetAmount/EAmount is 0 or null.
//   3. The invoice's EStatus never actually reached the approval
//      transition that triggers auto-posting (still shows "Approved" in
//      the booking's own workflow but the GL-posting hook never fired).
//
// Usage: node backend/scripts/checkUnpostedDinvReason.js
const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  const rowsRes = await pool.request().query(`
    SELECT eb.Eid, eb.EDocNo, eb.EName, eb.EAmount, eb.ENetAmount, eb.ESourceType, eb.EStatus, eb.ECompanyId
    FROM dbo.ExpenseBooking eb
    WHERE eb.ESourceType NOT IN ('GRN')
      AND NOT EXISTS (
        SELECT 1 FROM dbo.GeneralLedgerEntry gle
        WHERE gle.SourceType IN ('ExpenseBooking', 'InvoicePosting') AND gle.SourceId = eb.Eid AND gle.IsReversed = 0
      )
      AND EXISTS (
        SELECT 1 FROM dbo.NewPayment np
        WHERE np.PExpenseRef = eb.EDocNo
          AND EXISTS (
            SELECT 1 FROM dbo.GeneralLedgerEntry g2
            WHERE g2.SourceType IN ('NewPayment', 'PaymentPosting') AND g2.SourceId = np.PPaymentID AND g2.IsReversed = 0
          )
      )
    ORDER BY eb.EName, eb.Eid
  `);

  console.log(`Found ${rowsRes.recordset.length} unposted invoice(s) with a posted payment against them.\n`);

  for (const eb of rowsRes.recordset) {
    const headRes = await pool.request().input("Name", eb.EName).query(
      `SELECT LHeadId, LHeadName, LHeadStatus FROM dbo.AccountHeadMaster WHERE LHeadName = @Name`,
    );
    const exactMatch = headRes.recordset[0];

    const fuzzyRes = await pool.request().input("Name", `%${(eb.EName || "").trim()}%`).query(
      `SELECT TOP 3 LHeadId, LHeadName, LHeadType, LHeadStatus FROM dbo.AccountHeadMaster WHERE LHeadName LIKE @Name`,
    );

    console.log(`${eb.EDocNo} (Eid ${eb.Eid}) — EName: "${eb.EName}", ENetAmount: ${eb.ENetAmount}, EAmount: ${eb.EAmount}, ESourceType: ${eb.ESourceType}, EStatus: ${eb.EStatus}`);
    if (exactMatch) {
      console.log(`    Exact AccountHeadMaster match found (LHeadId ${exactMatch.LHeadId}, status ${exactMatch.LHeadStatus}) — EName resolution is NOT the problem here, check other reasons.`);
    } else {
      console.log(`    ⚠ NO exact AccountHeadMaster.LHeadName match for "${eb.EName}" — this is why postExpenseBookingApproval silently failed (getHeadIdByName found nothing).`);
      if (fuzzyRes.recordset.length) {
        console.log(`    Similar heads that DO exist:`);
        for (const f of fuzzyRes.recordset) console.log(`      - "${f.LHeadName}" (LHeadId ${f.LHeadId}, type ${f.LHeadType}, status ${f.LHeadStatus})`);
      } else {
        console.log(`    No similar heads found at all either.`);
      }
    }
    console.log("");
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
