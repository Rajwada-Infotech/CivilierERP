// Read-only diagnostic — no writes. Finds live On Account activity created
// by CreatedBy = 'dummy@civiliererp.in' (case-insensitive): both
// dbo.OnAccountLedger rows and dbo.GeneralLedgerEntry legs with
// SourceType = 'OnAccountAdjustment'.
//
// Usage: node backend/scripts/diagnoseDummyUserOnAccountAdjustments.js
//   --email=<other@address> to check a different account instead.

const { connectDB, getPool, closeDB } = require("../db");

const emailArg = process.argv.find((a) => a.startsWith("--email="));
const EMAIL = emailArg ? emailArg.split("=")[1] : "dummy@civiliererp.in";

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  console.log(`Checking for On Account activity created by "${EMAIL}"...\n`);

  const oalRes = await pool.request().input("email", EMAIL).query(`
    SELECT oal.OAId, oal.PartyId, oal.PartyType, oal.TxnDate, oal.TxnType, oal.Amount,
           oal.RefType, oal.RefDocNo, oal.Notes, oal.CreatedBy,
           ah.LHeadName AS PartyName
    FROM dbo.OnAccountLedger oal
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = oal.PartyId
    WHERE LOWER(oal.CreatedBy) = LOWER(@email)
    ORDER BY oal.TxnDate DESC
  `);

  console.log(`=== dbo.OnAccountLedger rows (${oalRes.recordset.length}) ===`);
  if (!oalRes.recordset.length) console.log("None found.");
  for (const r of oalRes.recordset) {
    console.log(
      `OAId ${r.OAId}  ${r.TxnType}  ₹${fmt(r.Amount)}  Party: ${r.PartyName || r.PartyId} (${r.PartyType})  ` +
      `Ref: ${r.RefType || "-"} ${r.RefDocNo || ""}  Date: ${r.TxnDate?.toISOString?.().slice(0, 10) ?? r.TxnDate}  ` +
      `Notes: "${r.Notes || ""}"`,
    );
  }

  const glRes = await pool.request().input("email", EMAIL).query(`
    SELECT gle.EntryId, gle.SourceId AS OAId, gle.VoucherNo, gle.VoucherDate, gle.LHeadId,
           gle.DebitAmount, gle.CreditAmount, gle.IsReversed, gle.CreatedAt,
           ah.LHeadName
    FROM dbo.GeneralLedgerEntry gle
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
    WHERE gle.SourceType = 'OnAccountAdjustment' AND LOWER(gle.CreatedBy) = LOWER(@email)
    ORDER BY gle.VoucherDate DESC
  `);

  console.log(`\n=== dbo.GeneralLedgerEntry legs, SourceType='OnAccountAdjustment' (${glRes.recordset.length}) ===`);
  if (!glRes.recordset.length) console.log("None found.");
  const liveByOAId = new Map();
  for (const r of glRes.recordset) {
    const side = Number(r.DebitAmount) > 0 ? `DR ₹${fmt(r.DebitAmount)}` : `CR ₹${fmt(r.CreditAmount)}`;
    console.log(
      `EntryId ${r.EntryId}  OAId ${r.OAId}  ${r.VoucherNo}  ${side}  ${r.LHeadName || r.LHeadId}  ` +
      `Date: ${r.VoucherDate?.toISOString?.().slice(0, 10) ?? r.VoucherDate}  ` +
      `${r.IsReversed ? "REVERSED" : "LIVE"}`,
    );
    if (!r.IsReversed) liveByOAId.set(r.OAId, true);
  }

  console.log(
    `\n${oalRes.recordset.length} OnAccountLedger row(s), ${glRes.recordset.length} GL leg(s) ` +
    `(${liveByOAId.size} distinct still-LIVE OnAccountAdjustment voucher(s)) created by "${EMAIL}".`,
  );
  console.log("This is diagnostic only — nothing was changed.");

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
