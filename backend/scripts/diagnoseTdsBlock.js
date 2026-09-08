/**
 * Diagnoses why paying a given invoice is blocked with:
 *   "TDS is due on this invoice but none was selected — please correct
 *    the invoice before paying it."
 *
 * Reuses the exact same resolver (expenseBookingSupplierSql) and TDS
 * functions (services/tds.js) the live payment flow calls, so the answer
 * here is guaranteed to match production's actual reasoning — no
 * hand-guessed SQL involved.
 *
 * Usage:
 *   node backend/scripts/diagnoseTdsBlock.js "DINV/000124/2025-2026"
 *
 * Run this against the SAME database your production app server points
 * at (its .env), read-only — it makes no writes.
 */

require("../config/env").loadEnv();
const { connectDB, getPool, sql } = require("../db");
const { expenseBookingSupplierSql } = require("../utils/expenseBookingSupplier");
const {
  resolveFinYearId,
  getYearlyCumulativeAmount,
  isThresholdMet,
  SINGLE_BILL_THRESHOLD,
  YEARLY_CUMULATIVE_THRESHOLD,
} = require("../services/tds");

const docNo = process.argv[2];
if (!docNo) {
  console.error("Usage: node diagnoseTdsBlock.js <EDocNo>");
  process.exit(1);
}

(async () => {
  await connectDB();
  const pool = getPool();

  const ebSup = expenseBookingSupplierSql("eb", "diag");
  const ebRes = await pool.request().input("EDocNo", sql.NVarChar(100), docNo).query(`
    SELECT eb.Eid, eb.EDocNo, eb.EAmount, eb.ENetAmount, eb.ECompanyId, eb.EDocDate, eb.EStatus,
           eb.TDSId, eb.TDSAmount, eb.ESourceType, eb.ESourceId,
           (${ebSup.idExpr}) AS ResolvedSupplierId
    ${ebSup.joins ? "" : ""}
    FROM dbo.ExpenseBooking eb
    ${ebSup.joins}
    WHERE eb.EDocNo = @EDocNo
  `);
  const eb = ebRes.recordset[0];
  if (!eb) {
    console.log(`No invoice found with EDocNo = '${docNo}'`);
    process.exit(1);
  }
  console.log("── Invoice ──────────────────────────────────────────");
  console.log(eb);

  if (!eb.ResolvedSupplierId) {
    console.log("\nCould not resolve a supplier/contractor for this invoice — that alone would be a bug (the TDS check has nothing to evaluate against).");
    process.exit(0);
  }

  const supRes = await pool.request().input("Id", sql.Int, eb.ResolvedSupplierId).query(`
    SELECT LHeadId, LHeadName, LHeadType, IsTdsApplicable, TdsLimitApplicable
    FROM dbo.AccountHeadMaster WHERE LHeadId = @Id
  `);
  const sup = supRes.recordset[0];
  console.log("\n── Resolved Supplier/Contractor ────────────────────");
  console.log(sup);

  if (!sup?.IsTdsApplicable) {
    console.log("\nIsTdsApplicable is OFF for this supplier — the block should NOT be firing from this invoice. If it still is, something else is resolving a different/stale supplier id at payment time than this script found — worth comparing against resolvePaymentSupplierHeadId's own resolution for this exact PExpenseRef.");
    process.exit(0);
  }

  const finYearId = await resolveFinYearId(pool, sql, eb.EDocDate);
  console.log("\nFinYearId for invoice date:", finYearId);

  const cumulative = await getYearlyCumulativeAmount(pool, sql, {
    partyHeadId: eb.ResolvedSupplierId,
    companyId: eb.ECompanyId,
    finYearId,
  });

  const singleBillOver = Number(eb.EAmount) > SINGLE_BILL_THRESHOLD;
  const yearlyOver = cumulative > YEARLY_CUMULATIVE_THRESHOLD;
  const thresholdMetIgnoringLimitFlag = isThresholdMet(eb.EAmount, cumulative);

  console.log("\n── Threshold evaluation ─────────────────────────────");
  console.log({
    invoiceEAmount: eb.EAmount,
    singleBillThreshold: SINGLE_BILL_THRESHOLD,
    singleBillOver,
    yearlyCumulativeAmount: cumulative,
    yearlyCumulativeThreshold: YEARLY_CUMULATIVE_THRESHOLD,
    yearlyOver,
    TdsLimitApplicable_onSupplier: !!sup.TdsLimitApplicable,
    note: sup.TdsLimitApplicable === false
      ? "TdsLimitApplicable is OFF — threshold is bypassed entirely, TDS is due on every eligible bill regardless of amount."
      : undefined,
    thresholdMet_asUsedByPaymentFlow: sup.TdsLimitApplicable === false ? true : thresholdMetIgnoringLimitFlag,
  });

  console.log("\n── Verdict ──────────────────────────────────────────");
  const effectivelyMet = sup.TdsLimitApplicable === false || thresholdMetIgnoringLimitFlag;
  if (!effectivelyMet) {
    console.log("Threshold is NOT met by this script's calculation — if the live app is still blocking payment, that's a genuine discrepancy (bug) worth investigating further (e.g. a different companyId/finYearId being passed at payment time than the invoice's own).");
  } else if (eb.TDSId) {
    console.log("Threshold IS met, but this invoice already HAS a TDSId — the live block should not be firing. If it still is, that's a bug.");
  } else {
    console.log("Threshold IS met and this invoice has NO TDSId — the block is working as designed. Fix: edit this invoice, select the applicable TDS record, save, then retry the payment.");
  }

  process.exit(0);
})().catch((e) => {
  console.error("DIAGNOSTIC FAILED:", e);
  process.exit(1);
});
