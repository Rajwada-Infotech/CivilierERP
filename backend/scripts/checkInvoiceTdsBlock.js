// Read-only diagnostic: DINV/000124/2025-2026's payment attempt is failing
// (reported as a TDS-related glitch). resolveInvoiceLinkedTds
// (services/tds.js) throws "TDS is due on this invoice but none was
// selected" when: the resolved supplier/contractor has IsTdsApplicable=1,
// the yearly-cumulative/single-bill threshold is met, AND the invoice's own
// TDSId is null. This checks exactly that chain for this one invoice.
//
// Usage:
//   node backend/scripts/checkInvoiceTdsBlock.js

const { connectDB, getPool, closeDB, sql } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  const { expenseBookingSupplierSql } = require("../utils/expenseBookingSupplier");
  const ebSup = expenseBookingSupplierSql("eb", "chk");

  const ebRes = await pool.request().input("EDocNo", sql.NVarChar(100), "DINV/000124/2025-2026").query(`
    SELECT eb.Eid, eb.EDocNo, eb.EDocDate, eb.EAmount, eb.ENetAmount, eb.EStatus, eb.ESourceType,
           eb.ECompanyId, eb.LHeadId,
           eb.TDSId, eb.TDSNature, eb.TDSName, eb.TDSPercentage,
           (${ebSup.idExpr}) AS ResolvedSupplierId,
           sup.LHeadName AS SupplierName, sup.IsTdsApplicable, sup.TdsLimitApplicable
    FROM dbo.ExpenseBooking eb
    ${ebSup.joins}
    OUTER APPLY (SELECT LHeadId, LHeadName, IsTdsApplicable, TdsLimitApplicable FROM dbo.AccountHeadMaster WHERE LHeadId = (${ebSup.idExpr})) sup
    WHERE eb.EDocNo = @EDocNo
  `);

  const eb = ebRes.recordset[0];
  if (!eb) {
    console.log("ExpenseBooking DINV/000124/2025-2026 not found.");
    await closeDB();
    return;
  }
  console.log("ExpenseBooking:", eb);

  if (!eb.IsTdsApplicable) {
    console.log("\nSupplier's IsTdsApplicable is 0/false — resolveInvoiceLinkedTds would return 'not eligible' immediately, no block. Not the cause.");
    await closeDB();
    return;
  }

  const { resolveThresholdStatus, resolveFinYearId } = require("../services/tds");
  const finYearId = await resolveFinYearId(pool, sql, eb.EDocDate);
  const { thresholdMet, cumulativeAmount } = await resolveThresholdStatus(pool, sql, {
    tdsLimitApplicable: !!eb.TdsLimitApplicable,
    billAmount: eb.EAmount,
    partyHeadId: eb.ResolvedSupplierId,
    companyId: eb.ECompanyId,
    finYearId,
  });

  console.log(`\nfinYearId=${finYearId}, thresholdMet=${thresholdMet}, cumulativeAmount=${cumulativeAmount}, billAmount=${eb.EAmount}, TdsLimitApplicable=${eb.TdsLimitApplicable}`);

  if (thresholdMet && !eb.TDSId) {
    console.log("\n⚠ CONFIRMED: threshold is met, supplier IsTdsApplicable=1, but this invoice's TDSId is NULL.");
    console.log("This is exactly what throws 'TDS is due on this invoice but none was selected — please correct the invoice before paying it.'");
  } else if (!thresholdMet) {
    console.log("\nThreshold NOT met — resolveInvoiceLinkedTds would return eligible:true, thresholdMet:false, no block. Not the cause (something else is failing).");
  } else {
    console.log("\nTDSId is already set on this invoice — should not be blocked by this path.");
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
