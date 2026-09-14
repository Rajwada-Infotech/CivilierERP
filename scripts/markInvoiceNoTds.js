// Marks a specific invoice as "no TDS due" so it can be paid without
// hitting resolveInvoiceLinkedTds's block ("TDS is due on this invoice but
// none was selected — please correct the invoice before paying it.").
//
// Doesn't touch the supplier's IsTdsApplicable flag (that would affect
// every other invoice for that supplier too) — instead ensures a shared
// 0%/"No TDS Applicable" TDSMaster row exists (creating it once if it
// doesn't) and tags the invoice with it. TDSId stays non-null (satisfying
// the block's only real check) while TDSAmount computes to 0, so the
// payment goes through deducting nothing — a real, auditable "TDS
// considered and found not due" record instead of erasing the fact that
// this supplier is TDS-applicable.
//
// Reusable for any invoice with the same block — pass its EDocNo.
//
// Dry-run by default — prints what it WOULD change without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/markInvoiceNoTds.js "DINV/000124/2025-2026"
//   node backend/scripts/markInvoiceNoTds.js "DINV/000124/2025-2026" --apply

const { connectDB, getPool, closeDB, sql } = require("../db");

const APPLY = process.argv.includes("--apply");
const docNo = process.argv.slice(2).find((a) => !a.startsWith("--"));

const NO_TDS_NATURE = "NO TDS APPLICABLE";
const NO_TDS_NAME = "No TDS Applicable @ 0%";

async function main() {
  if (!docNo) {
    console.error('Usage: node backend/scripts/markInvoiceNoTds.js "<EDocNo>" [--apply]');
    process.exit(1);
  }

  await connectDB();
  const pool = getPool();

  const ebRes = await pool.request().input("EDocNo", sql.NVarChar(100), docNo).query(`
    SELECT Eid, EDocNo, EAmount, TDSId, TDSNature, TDSName, TDSPercentage, TDSAmount
    FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo
  `);
  const eb = ebRes.recordset[0];
  if (!eb) {
    console.error(`ExpenseBooking "${docNo}" not found.`);
    await closeDB();
    process.exit(1);
  }

  if (eb.TDSId) {
    console.log(`${eb.EDocNo} (Eid ${eb.Eid}) already has TDSId=${eb.TDSId} (${eb.TDSName}) — nothing to do.`);
    await closeDB();
    return;
  }

  let noTdsRes = await pool.request().query(`
    SELECT TDSId, Nature, Name, GLHeadId FROM dbo.TDSMaster WHERE Percentage = 0 AND Status = 1
  `);
  let noTds = noTdsRes.recordset[0];

  if (!noTds) {
    const glHeadRes = await pool.request().query(`SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode = 'TDSPAY'`);
    const glHeadId = glHeadRes.recordset[0]?.LHeadId ?? null;
    if (!glHeadId) {
      console.error('Could not find the system "TDS Payable A/c" head (LHeadCode=TDSPAY) — cannot create the 0% TDS record.');
      await closeDB();
      process.exit(1);
    }
    console.log(`No 0%/"No TDS" TDSMaster row exists yet. ${APPLY ? "Creating" : "Would create"}: Nature="${NO_TDS_NATURE}", Name="${NO_TDS_NAME}", Percentage=0, GLHeadId=${glHeadId}`);
    if (APPLY) {
      const insertRes = await pool.request()
        .input("Nature", sql.NVarChar(200), NO_TDS_NATURE)
        .input("Name", sql.NVarChar(200), NO_TDS_NAME)
        .input("Percentage", sql.Decimal(5, 2), 0)
        .input("GLHeadId", sql.Int, glHeadId)
        .query(`
          INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, GLHeadId, CreatedAt)
          OUTPUT INSERTED.TDSId, INSERTED.Nature, INSERTED.Name
          VALUES (@Nature, @Name, @Percentage, 1, @GLHeadId, GETDATE())
        `);
      noTds = insertRes.recordset[0];
      console.log(`  → created TDSId ${noTds.TDSId}`);
    } else {
      noTds = { TDSId: "(new)", Nature: NO_TDS_NATURE, Name: NO_TDS_NAME };
    }
  } else {
    console.log(`Using existing 0% TDS record: TDSId ${noTds.TDSId} (${noTds.Name})`);
  }

  console.log(`\n${eb.EDocNo} (Eid ${eb.Eid}, base ₹${Number(eb.EAmount).toLocaleString("en-IN")}): TDSId null → ${noTds.TDSId} (${noTds.Name}), TDSAmount → 0.00`);

  if (APPLY) {
    await pool.request()
      .input("Eid", sql.Int, eb.Eid)
      .input("TDSId", sql.Int, noTds.TDSId)
      .input("TDSNature", sql.NVarChar(200), noTds.Nature)
      .input("TDSName", sql.NVarChar(200), noTds.Name)
      .query(`
        UPDATE dbo.ExpenseBooking
        SET TDSId = @TDSId, TDSNature = @TDSNature, TDSName = @TDSName, TDSPercentage = 0, TDSAmount = 0
        WHERE Eid = @Eid
      `);
    console.log("  → updated. This invoice can now be paid.");
  } else {
    console.log("\nRe-run with --apply to write this change.");
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
