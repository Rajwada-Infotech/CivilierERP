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

/**
 * A party's own TDS limits (AccountHeadMaster.TdsSingleBillLimit / TdsYearlyLimit, migration 635), set on Vendor /
 * Contractor / Broker Master for parties whose limit differs from the standard. Blank = the standard ₹30k / ₹1L.
 */
async function getTdsLimits(pool, sql, partyHeadId) {
  const limits = { singleBill: SINGLE_BILL_THRESHOLD, yearly: YEARLY_CUMULATIVE_THRESHOLD };
  if (!partyHeadId) return limits;
  try {
    const r = await pool.request().input("Id", sql.Int, partyHeadId)
      .query("SELECT TdsSingleBillLimit, TdsYearlyLimit FROM dbo.AccountHeadMaster WHERE LHeadId = @Id");
    const row = r.recordset[0];
    if (row?.TdsSingleBillLimit != null && Number(row.TdsSingleBillLimit) > 0) limits.singleBill = Number(row.TdsSingleBillLimit);
    if (row?.TdsYearlyLimit != null && Number(row.TdsYearlyLimit) > 0) limits.yearly = Number(row.TdsYearlyLimit);
  } catch (_) { /* columns not there yet (migration 635 pending): standard limits */ }
  return limits;
}

function isThresholdMet(billAmount, cumulativeAmount, limits = { singleBill: SINGLE_BILL_THRESHOLD, yearly: YEARLY_CUMULATIVE_THRESHOLD }) {
  return Number(billAmount) > limits.singleBill || Number(cumulativeAmount) > limits.yearly;
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
  const limits = await getTdsLimits(pool, sql, partyHeadId);
  if (tdsLimitApplicable === false) {
    return { thresholdMet: true, cumulativeAmount: 0, singleBillLimit: limits.singleBill, yearlyLimit: limits.yearly };
  }
  const cumulativeAmount = await getYearlyCumulativeAmount(pool, sql, { partyHeadId, companyId, finYearId });
  return {
    thresholdMet: isThresholdMet(billAmount, cumulativeAmount, limits),
    cumulativeAmount,
    singleBillLimit: limits.singleBill,
    yearlyLimit: limits.yearly,
  };
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
          SELECT SUM(np.PAmount + ISNULL(np.TDSAmount, 0))
          FROM dbo.NewPayment np
          WHERE np.PPartyId = @PartyHeadId
            -- PCompany is the enterprise id on older rows, the company name on newer ones
            AND (TRY_CAST(np.PCompany AS INT) = @CompanyId
                 OR np.PCompany = (SELECT TOP 1 name FROM dbo.enterprise WHERE id = @CompanyId))
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
           eb.TDSId, eb.TDSNature, eb.TDSName, eb.TDSPercentage, ISNULL(eb.TDSAdvanceCovered, 0) AS TDSAdvanceCovered,
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

  // TDS was already deducted on advances covering this whole invoice: nothing left to deduct (computeAdvanceTdsCover).
  const tdsBase = Math.max(0, (Number(eb.EAmount) || 0) - (Number(eb.TDSAdvanceCovered) || 0));
  if (tdsBase <= 0) return { ...empty, eligible: true, thresholdMet: true };

  if (!eb.TDSId) {
    const err = new Error("TDS is due on this invoice but none was selected — please correct the invoice before paying it.");
    err.status = 400;
    throw err;
  }

  return {
    eligible: true,
    thresholdMet: true,
    tdsId: eb.TDSId,
    tdsAmount: calculateTds(tdsBase, eb.TDSPercentage),
    tdsNature: eb.TDSNature,
    tdsName: eb.TDSName,
    tdsPercentage: Number(eb.TDSPercentage) || 0,
  };
}

/**
 * The ledger a payment's own TDS is credited to: the GL head of the TDS picked on the payment (TDSMaster.GLHeadId,
 * e.g. "TDS 194C A/c"), or the common "TDS Payable A/c" when that TDS has no head set.
 */
async function getPaymentTdsHeadId(pool, sql, tdsId) {
  if (tdsId) {
    const r = await pool.request().input("TDSId", sql.Int, tdsId).query(`
      SELECT TOP 1 tm.GLHeadId FROM dbo.TDSMaster tm
      JOIN dbo.AccountHeadMaster h ON h.LHeadId = tm.GLHeadId
      WHERE tm.TDSId = @TDSId`);
    if (r.recordset[0]?.GLHeadId) return r.recordset[0].GLHeadId;
  }
  const { getGLHeadId } = require("./generalLedger");
  return getGLHeadId(pool, GL_ACCOUNTS.TDS_PAYABLE).catch(() => null);
}

/**
 * Advance payments that already had TDS deducted, not yet used up by an invoice.
 *
 * An advance (a payment to the party with no invoice and no JV line) with TDS on it already withheld tax on its gross
 * amount (PAmount is gross on such a payment). When an invoice for that party is booked later, TDS must only be
 * deducted on the part of the invoice the advance doesn't cover. Each invoice records how much of these advances it
 * used (ExpenseBooking.TDSAdvanceCovered), so one advance is never counted against two invoices.
 * Same company, same financial year (the year the given date falls in).
 */
async function getAdvanceTdsAvailable(newRequest, sql, { partyHeadId, companyId, date, excludeEid }) {
  if (!partyHeadId || !companyId || !date) return 0;
  const { expenseBookingSupplierSql } = require("../utils/expenseBookingSupplier");
  const ebSup = expenseBookingSupplierSql("eb", "tdsadv");
  const r = await newRequest()
    .input("PartyHeadId", sql.Int, partyHeadId)
    .input("CompanyId", sql.Int, companyId)
    .input("Date", sql.Date, date)
    .input("ExcludeEid", sql.Int, excludeEid || 0).query(`
      DECLARE @FStart DATE, @FEnd DATE;
      SELECT TOP 1 @FStart = FStartDate, @FEnd = FEndDate FROM dbo.FinYear
      WHERE @Date >= FStartDate AND @Date <= FEndDate ORDER BY FStartDate DESC;
      SELECT
        ISNULL((
          SELECT SUM(np.PAmount)
          FROM dbo.NewPayment np
          WHERE np.PPartyId = @PartyHeadId
            AND (TRY_CAST(np.PCompany AS INT) = @CompanyId
                 OR np.PCompany = (SELECT TOP 1 name FROM dbo.enterprise WHERE id = @CompanyId))
            AND np.PDate BETWEEN @FStart AND @FEnd
            AND ISNULL(np.PExpenseRef, '') = '' AND np.JVLineId IS NULL
            AND ISNULL(np.TDSAmount, 0) > 0
            AND ISNULL(np.Status, '') NOT IN ('Rejected', 'Deleted', 'Cancelled')
            AND ISNULL(np.PIsChequeCancelled, 0) = 0
        ), 0)
        -
        ISNULL((
          SELECT SUM(eb.TDSAdvanceCovered)
          FROM dbo.ExpenseBooking eb
          ${ebSup.joins}
          WHERE eb.ECompanyId = @CompanyId
            AND eb.EDocDate BETWEEN @FStart AND @FEnd
            AND eb.Eid <> @ExcludeEid
            AND ISNULL(eb.TDSAdvanceCovered, 0) > 0
            AND ISNULL(eb.EStatus, '') NOT IN ('Rejected', 'Deleted')
            AND (${ebSup.idExpr}) = @PartyHeadId
        ), 0) AS Available`);
  return Math.max(0, Number(r.recordset[0]?.Available) || 0);
}

/**
 * How much of an invoice is covered by TDS-deducted advances, and the TDS left to deduct on the rest.
 * Reads the invoice's party (and, unless overridden, its amount / company / date / TDS rate) from the saved row, so it
 * works both right after an insert (inside its transaction) and before an edit is written (with the edit's values as
 * overrides). `blocked` = a TDS was picked but the advances cover the whole invoice: there is nothing left to deduct on.
 *
 * @returns {{ covered: number, base: number, tdsAmount: number, blocked: boolean }}
 */
async function computeAdvanceTdsCover(newRequest, sql, eid, overrides = {}) {
  const { expenseBookingSupplierSql } = require("../utils/expenseBookingSupplier");
  const ebSup = expenseBookingSupplierSql("eb", "tdscov");
  const row = (await newRequest().input("Eid", sql.Int, eid).query(`
    SELECT eb.EAmount, eb.ECompanyId, eb.EDocDate, eb.ESourceType, eb.TDSId, eb.TDSPercentage,
           (${ebSup.idExpr}) AS SupplierId
    FROM dbo.ExpenseBooking eb ${ebSup.joins}
    WHERE eb.Eid = @Eid`)).recordset[0];
  if (!row) return { covered: 0, base: 0, tdsAmount: 0, blocked: false };

  const has = (k) => overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== "";
  const amount = Number(has("amount") ? overrides.amount : row.EAmount) || 0;
  const companyId = has("companyId") ? parseInt(overrides.companyId, 10) : row.ECompanyId;
  const date = has("date") ? overrides.date : row.EDocDate;
  const tdsId = "tdsId" in overrides ? overrides.tdsId : row.TDSId;
  const pct = "tdsPercentage" in overrides ? overrides.tdsPercentage : row.TDSPercentage;
  // A direct booking's party is the one picked on the form, which an edit may change.
  const isDirect = !["GRN", "PO", "WO_PO", "WORK_DONE", "WO"].includes(row.ESourceType);
  const supplierId = isDirect && has("lHeadId") ? parseInt(overrides.lHeadId, 10) : row.SupplierId;

  let covered = 0;
  if (supplierId) {
    const sup = (await newRequest().input("Id", sql.Int, supplierId)
      .query("SELECT ISNULL(IsTdsApplicable, 0) AS IsTdsApplicable FROM dbo.AccountHeadMaster WHERE LHeadId = @Id")).recordset[0];
    if (sup?.IsTdsApplicable) {
      const available = await getAdvanceTdsAvailable(newRequest, sql, { partyHeadId: supplierId, companyId, date, excludeEid: eid });
      covered = Math.round(Math.min(amount, available) * 100) / 100;
    }
  }
  const base = Math.max(0, Math.round((amount - covered) * 100) / 100);
  return {
    covered,
    base,
    tdsAmount: tdsId ? calculateTds(base, pct) : 0,
    blocked: !!tdsId && covered > 0 && base <= 0,
  };
}

module.exports = {
  GL_ACCOUNTS,
  getPaymentTdsHeadId,
  getAdvanceTdsAvailable,
  computeAdvanceTdsCover,
  SINGLE_BILL_THRESHOLD,
  YEARLY_CUMULATIVE_THRESHOLD,
  calculateTds,
  getTdsLimits,
  isThresholdMet,
  resolveFinYearId,
  getYearlyCumulativeAmount,
  resolveThresholdStatus,
  resolveTds,
  resolveInvoiceLinkedTds,
};
