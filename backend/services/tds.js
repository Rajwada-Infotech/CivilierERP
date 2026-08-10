/**
 * tds.js — shared TDS (Tax Deducted at Source) calculation and threshold
 * logic, used identically by ExpenseBooking (invoice-time TDS selection)
 * and NewPayment (direct-payment TDS selection; invoice-linked payments
 * inherit the invoice's own stored snapshot instead of calling this).
 *
 * Kept in one place per the spec: "keep the calculation in one common
 * function rather than implementing separate calculations in invoice and
 * payment screens."
 */

const GL_ACCOUNTS = { TDS_PAYABLE: "TDS Payable A/c" };

const SINGLE_BILL_THRESHOLD = 30000;
const YEARLY_CUMULATIVE_THRESHOLD = 100000;

/** Same lookup as newPayment.js's local resolveFinYearId (not exported
 *  there) — which dbo.FinYear row a given date falls into. */
async function resolveFinYearId(pool, sql, date) {
  if (!date) return null;
  const result = await pool.request().input("Date", sql.Date, date).query(`
    SELECT TOP 1 FId FROM dbo.FinYear
    WHERE @Date >= FStartDate AND @Date <= FEndDate
    ORDER BY FStartDate DESC
  `);
  return result.recordset[0]?.FId ?? null;
}

/** Pure TDS math — baseAmount x percentage / 100, paisa-rounded. */
function calculateTds(baseAmount, percentage) {
  const base = Number(baseAmount) || 0;
  const pct = Number(percentage) || 0;
  return Math.round(((base * pct) / 100) * 100) / 100;
}

function isThresholdMet(billAmount, cumulativeAmount) {
  return Number(billAmount) > SINGLE_BILL_THRESHOLD || Number(cumulativeAmount) > YEARLY_CUMULATIVE_THRESHOLD;
}

/**
 * Whether the ₹30k/₹1L threshold actually gates TDS for this bill, per the
 * Supplier/Contractor's own TdsLimitApplicable toggle (migration 306):
 *   ON  (default) — normal Section 13 behaviour, threshold decides.
 *   OFF            — threshold check is skipped entirely; TDS deducts on
 *                     every eligible bill unconditionally (thresholdMet is
 *                     always true, cumulative is never even queried).
 */
async function resolveThresholdStatus(pool, sql, { tdsLimitApplicable, billAmount, partyHeadId, companyId, finYearId }) {
  if (tdsLimitApplicable === false) {
    return { thresholdMet: true, cumulativeAmount: 0 };
  }
  const cumulativeAmount = await getYearlyCumulativeAmount(pool, sql, { partyHeadId, companyId, finYearId });
  return { thresholdMet: isThresholdMet(billAmount, cumulativeAmount), cumulativeAmount };
}

/**
 * Sum of everything already invoiced/paid to this exact supplier/contractor
 * (AccountHeadMaster row), within one company, within one financial year —
 * used for the yearly-cumulative threshold (Section 13.2). Evaluated
 * per-company: each company is its own TDS deductor.
 *
 * Sums ExpenseBooking.EAmount (the pre-GST taxable base — same base TDS
 * itself is calculated on) for every non-Draft/non-Rejected booking whose
 * resolved supplier/contractor is this head, plus NewPayment.PAmount for
 * every non-Rejected direct payment (no linked invoice — a linked
 * payment's amount is already counted via its invoice, so it's excluded
 * here to avoid double-counting the same money twice).
 */
async function getYearlyCumulativeAmount(pool, sql, { partyHeadId, companyId, finYearId }) {
  if (!partyHeadId || !companyId || !finYearId) return 0;

  const fy = await pool.request().input("FId", sql.Int, finYearId)
    .query("SELECT FStartDate, FEndDate FROM dbo.FinYear WHERE FId = @FId");
  const range = fy.recordset[0];
  if (!range) return 0;

  const { expenseBookingSupplierSql } = require("../utils/expenseBookingSupplier");
  const ebSup = expenseBookingSupplierSql("eb", "tdscum");

  const result = await pool
    .request()
    .input("PartyHeadId", sql.Int, partyHeadId)
    .input("CompanyId", sql.Int, companyId)
    .input("FStart", sql.Date, range.FStartDate)
    .input("FEnd", sql.Date, range.FEndDate).query(`
      SELECT
        ISNULL((
          SELECT SUM(eb.EAmount)
          FROM dbo.ExpenseBooking eb
          ${ebSup.joins}
          WHERE eb.ECompanyId = @CompanyId
            AND eb.EDocDate BETWEEN @FStart AND @FEnd
            AND ISNULL(eb.EStatus, '') NOT IN ('Draft', 'Rejected')
            AND (${ebSup.idExpr}) = @PartyHeadId
        ), 0)
        +
        ISNULL((
          SELECT SUM(np.PAmount)
          FROM dbo.NewPayment np
          WHERE np.PPartyId = @PartyHeadId
            AND TRY_CAST(np.PCompany AS INT) = @CompanyId
            AND np.PDate BETWEEN @FStart AND @FEnd
            AND ISNULL(np.PExpenseRef, '') = ''
            AND np.Status <> 'Rejected'
        ), 0) AS CumulativeAmount
    `);

  return Number(result.recordset[0]?.CumulativeAmount) || 0;
}

/**
 * Full Section 14 validator, for the cases that resolve TDS fresh (invoice
 * creation, or a direct/no-invoice payment). Invoice-linked payments skip
 * this entirely and just read the invoice's own stored snapshot (Section 8
 * — read-only inheritance) — see routes/newPayment.js.
 *
 * @returns {{
 *   eligible: boolean,          // false => tdsApplicableFlag was off; nothing else runs
 *   thresholdMet: boolean,
 *   tdsId: number|null,
 *   tdsAmount: number,
 *   tdsNature: string|null,
 *   tdsName: string|null,
 *   tdsPercentage: number|null,
 * }}
 */
async function resolveTds(pool, sql, { partyHeadId, tdsApplicableFlag, tdsLimitApplicable, billAmount, companyId, finYearId, selectedTdsId }) {
  const empty = { eligible: false, thresholdMet: false, tdsId: null, tdsAmount: 0, tdsNature: null, tdsName: null, tdsPercentage: null };
  if (!tdsApplicableFlag) return empty;

  const { thresholdMet } = await resolveThresholdStatus(pool, sql, { tdsLimitApplicable, billAmount, partyHeadId, companyId, finYearId });
  if (!thresholdMet) return { ...empty, eligible: true, thresholdMet: false };

  if (!selectedTdsId) {
    const err = new Error("TDS is due on this bill — please select a TDS.");
    err.status = 400;
    throw err;
  }

  const tdsRes = await pool.request().input("TDSId", sql.Int, selectedTdsId)
    .query("SELECT TDSId, Nature, Name, Percentage, Status FROM dbo.TDSMaster WHERE TDSId = @TDSId");
  const tds = tdsRes.recordset[0];
  if (!tds || !tds.Status) {
    const err = new Error("Selected TDS is not a valid, active TDS record.");
    err.status = 400;
    throw err;
  }

  const tdsAmount = calculateTds(billAmount, tds.Percentage);
  return {
    eligible: true,
    thresholdMet: true,
    tdsId: tds.TDSId,
    tdsAmount,
    tdsNature: tds.Nature,
    tdsName: tds.Name,
    tdsPercentage: Number(tds.Percentage) || 0,
  };
}

/**
 * Invoice-linked payment path (Section 8 — read-only inheritance, not
 * re-selected). Looks up the referenced ExpenseBooking (handling the
 * "{parentDocNo}-EMI-{n}" ref shape the same way resolvePaymentSupplierHeadId
 * does), re-confirms eligibility + threshold as of right now (Section 17 —
 * an invoice's own TDSId can only ever be trusted once the threshold is
 * actually met; it's not gated at invoice-creation time), and either
 * inherits the invoice's exact TDS snapshot or throws a blocking error if
 * TDS is due but the invoice was never tagged.
 *
 * @returns TDS snapshot shape identical to resolveTds's success case.
 */
async function resolveInvoiceLinkedTds(pool, sql, { expenseRef, companyId, finYearId }) {
  const empty = { eligible: false, thresholdMet: false, tdsId: null, tdsAmount: 0, tdsNature: null, tdsName: null, tdsPercentage: null };
  if (!expenseRef) return empty;

  const { expenseBookingSupplierSql } = require("../utils/expenseBookingSupplier");
  const ebSup = expenseBookingSupplierSql("eb", "tdsinv");

  const isEmiRef = /-EMI-\d+$/.test(expenseRef);
  const lookupRef = isEmiRef ? expenseRef.replace(/-EMI-\d+$/i, "") : expenseRef;

  const ebRes = await pool.request().input("EDocNo", sql.NVarChar(100), lookupRef).query(`
    SELECT TOP 1 eb.Eid, eb.EAmount, eb.ECompanyId,
           eb.TDSId, eb.TDSNature, eb.TDSName, eb.TDSPercentage,
           (${ebSup.idExpr}) AS ResolvedSupplierId,
           ISNULL(sup.IsTdsApplicable, 0) AS IsTdsApplicable,
           ISNULL(sup.TdsLimitApplicable, 1) AS TdsLimitApplicable
    FROM dbo.ExpenseBooking eb
    ${ebSup.joins}
    OUTER APPLY (SELECT IsTdsApplicable, TdsLimitApplicable FROM dbo.AccountHeadMaster WHERE LHeadId = (${ebSup.idExpr})) sup
    WHERE eb.EDocNo = @EDocNo
  `);
  const eb = ebRes.recordset[0];
  if (!eb || !eb.IsTdsApplicable) return empty;

  const effectiveCompanyId = companyId || eb.ECompanyId;
  const { thresholdMet } = await resolveThresholdStatus(pool, sql, {
    tdsLimitApplicable: !!eb.TdsLimitApplicable,
    billAmount: eb.EAmount,
    partyHeadId: eb.ResolvedSupplierId,
    companyId: effectiveCompanyId,
    finYearId,
  });
  if (!thresholdMet) return { ...empty, eligible: true, thresholdMet: false };

  if (!eb.TDSId) {
    const err = new Error("TDS is due on this invoice but none was selected — please correct the invoice before paying it.");
    err.status = 400;
    throw err;
  }

  return {
    eligible: true,
    thresholdMet: true,
    tdsId: eb.TDSId,
    tdsAmount: calculateTds(eb.EAmount, eb.TDSPercentage),
    tdsNature: eb.TDSNature,
    tdsName: eb.TDSName,
    tdsPercentage: Number(eb.TDSPercentage) || 0,
  };
}

module.exports = {
  GL_ACCOUNTS,
  SINGLE_BILL_THRESHOLD,
  YEARLY_CUMULATIVE_THRESHOLD,
  calculateTds,
  isThresholdMet,
  resolveFinYearId,
  getYearlyCumulativeAmount,
  resolveThresholdStatus,
  resolveTds,
  resolveInvoiceLinkedTds,
};
