// backend/services/contractLedger.js
//
// Single source of truth for a Contract's running balance. Nothing else in
// the codebase is allowed to compute or mutate a contract's balance
// directly — every advance received/paid and every automatic adjustment
// applied against an invoice/expense booking is one signed row in
// dbo.ContractLedger (+ve = advance in, -ve = adjustment applied), and the
// running unallocated balance is always exactly SUM(Amount) for that
// ContractId. This is deliberate: a feature whose whole point is "no
// miscalculations, full transparency" cannot have the balance computed two
// different ways in two different places.
//
// All functions here take an existing request-capable object (a plain
// pool or an open transaction) so callers can include ledger writes in
// their own atomic transaction — recording an advance or applying an
// adjustment must never succeed independently of the payment/invoice row
// it's tied to.

const { sql } = require("../db");

/** Sum of all ContractLedger rows for a contract = its unallocated advance balance. */
async function getContractBalance(executor, contractId) {
  const result = await executor
    .request()
    .input("ContractId", sql.Int, contractId)
    .query(
      "SELECT ISNULL(SUM(Amount), 0) AS Balance FROM dbo.ContractLedger WHERE ContractId = @ContractId",
    );
  return Number(result.recordset[0].Balance) || 0;
}

/**
 * Records an advance/token received or paid against a contract, with no
 * invoice/expense booking existing yet. Called from receivedPayment.js /
 * newPayment.js when a payment is tagged with a ContractId but no
 * SourceSaleInvoiceId / PExpenseRef.
 */
async function recordAdvance(executor, { contractId, sourceType, sourceId, sourceDocNo, amount, createdBy, remarks }) {
  if (!contractId || !amount) return;
  await executor
    .request()
    .input("ContractId", sql.Int, contractId)
    .input("SourceType", sql.NVarChar(30), sourceType)
    .input("SourceId", sql.Int, sourceId)
    .input("SourceDocNo", sql.NVarChar(100), sourceDocNo || null)
    .input("Amount", sql.Decimal(18, 2), amount)
    .input("CreatedBy", sql.NVarChar(150), createdBy || null)
    .input("Remarks", sql.NVarChar(500), remarks || `Advance recorded from ${sourceType} ${sourceDocNo || sourceId}`)
    .query(`
      INSERT INTO dbo.ContractLedger (ContractId, TxnType, Amount, SourceType, SourceId, SourceDocNo, Remarks, CreatedBy)
      VALUES (@ContractId, 'Advance', @Amount, @SourceType, @SourceId, @SourceDocNo, @Remarks, @CreatedBy)
    `);
}

/**
 * Automatic FIFO netting: when an invoice (SaleInvoice) or expense booking
 * (ExpenseBooking) is created against a contract, nets the available
 * unallocated advance against it, up to min(documentAmount, available
 * balance). FIFO is implicit here — there is no per-advance "remaining"
 * tracking, just one running balance, so the oldest advance is
 * mathematically always the first to be consumed as the balance depletes.
 *
 * Also checks whether this document would push the contract's total
 * invoiced/booked value past its ContractAmount — over-billing is a
 * WARNING, not a hard block: real contracts get change orders that
 * legitimately exceed the original value, so a hard block would be a
 * support nightmare for a routine, legitimate business situation.
 *
 * Returns { allocatedAmount, remainingBalance, overBilled } so the caller
 * can apply `allocatedAmount` to the document's own paid/received amount
 * and surface `overBilled` as a non-blocking warning.
 */
async function autoAllocateFIFO(executor, { contractId, sourceType, sourceId, sourceDocNo, documentAmount, createdBy }) {
  if (!contractId || !documentAmount) {
    return { allocatedAmount: 0, remainingBalance: 0, overBilled: false };
  }

  const available = await getContractBalance(executor, contractId);
  const allocatedAmount = Math.max(0, Math.min(documentAmount, available));

  if (allocatedAmount > 0) {
    await executor
      .request()
      .input("ContractId", sql.Int, contractId)
      .input("SourceType", sql.NVarChar(30), sourceType)
      .input("SourceId", sql.Int, sourceId)
      .input("SourceDocNo", sql.NVarChar(100), sourceDocNo || null)
      .input("Amount", sql.Decimal(18, 2), -allocatedAmount)
      .input("CreatedBy", sql.NVarChar(150), createdBy || null)
      .input("Remarks", sql.NVarChar(500), `Auto-allocated (FIFO) against ${sourceType} ${sourceDocNo || sourceId}`)
      .query(`
        INSERT INTO dbo.ContractLedger (ContractId, TxnType, Amount, SourceType, SourceId, SourceDocNo, Remarks, CreatedBy)
        VALUES (@ContractId, 'Adjustment', @Amount, @SourceType, @SourceId, @SourceDocNo, @Remarks, @CreatedBy)
      `);
  }

  const contractRow = await executor
    .request()
    .input("ContractId", sql.Int, contractId)
    .query("SELECT ContractAmount FROM dbo.Contract WHERE ContractId = @ContractId");
  const contractValue = Number(contractRow.recordset[0]?.ContractAmount) || 0;

  const totalDocsRow = await executor
    .request()
    .input("ContractId", sql.Int, contractId)
    .query(`
      SELECT
        ISNULL((SELECT SUM(Amount) FROM dbo.SaleInvoices WHERE ContractId = @ContractId AND IsDeleted = 0), 0)
        + ISNULL((SELECT SUM(EAmount) FROM dbo.ExpenseBooking WHERE ContractId = @ContractId), 0) AS TotalDocumented
    `);
  const totalDocumented = Number(totalDocsRow.recordset[0]?.TotalDocumented) || 0;
  const overBilled = contractValue > 0 && totalDocumented > contractValue;

  return {
    allocatedAmount,
    remainingBalance: available - allocatedAmount,
    overBilled,
  };
}

/**
 * Full summary for a contract's detail/ledger view: value, total advance
 * ever recorded, total adjusted against documents so far, current
 * unallocated balance, total documented (invoiced/booked) against it, and
 * the over-billed flag. Every number here is derived live from
 * ContractLedger + the documents themselves — nothing cached, nothing
 * that can drift from the ledger.
 */
async function getContractSummary(executor, contractId) {
  const ledgerRows = await executor
    .request()
    .input("ContractId", sql.Int, contractId)
    .query(`
      SELECT
        ISNULL(SUM(CASE WHEN TxnType = 'Advance' THEN Amount ELSE 0 END), 0) AS TotalAdvance,
        ISNULL(SUM(CASE WHEN TxnType = 'Adjustment' THEN -Amount ELSE 0 END), 0) AS TotalAllocated,
        ISNULL(SUM(Amount), 0) AS UnallocatedBalance
      FROM dbo.ContractLedger
      WHERE ContractId = @ContractId
    `);

  const contractRow = await executor
    .request()
    .input("ContractId", sql.Int, contractId)
    .query("SELECT ContractAmount FROM dbo.Contract WHERE ContractId = @ContractId");
  const contractValue = Number(contractRow.recordset[0]?.ContractAmount) || 0;

  const totalDocsRow = await executor
    .request()
    .input("ContractId", sql.Int, contractId)
    .query(`
      SELECT
        ISNULL((SELECT SUM(Amount) FROM dbo.SaleInvoices WHERE ContractId = @ContractId AND IsDeleted = 0), 0)
        + ISNULL((SELECT SUM(EAmount) FROM dbo.ExpenseBooking WHERE ContractId = @ContractId), 0) AS TotalDocumented
    `);
  const totalDocumented = Number(totalDocsRow.recordset[0]?.TotalDocumented) || 0;

  return {
    ContractValue: contractValue,
    TotalAdvance: Number(ledgerRows.recordset[0].TotalAdvance) || 0,
    TotalAllocated: Number(ledgerRows.recordset[0].TotalAllocated) || 0,
    UnallocatedBalance: Number(ledgerRows.recordset[0].UnallocatedBalance) || 0,
    TotalDocumented: totalDocumented,
    RemainingContractValue: contractValue - totalDocumented,
    OverBilled: contractValue > 0 && totalDocumented > contractValue,
  };
}

module.exports = { getContractBalance, recordAdvance, autoAllocateFIFO, getContractSummary };
