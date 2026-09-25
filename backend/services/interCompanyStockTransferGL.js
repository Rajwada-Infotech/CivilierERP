// backend/services/interCompanyStockTransferGL.js
//
// GL posting for Inter-Company Stock Transfer — replaces the old
// SO->SI->RP->PO->GRN->ExB->Payment commercial-paper chain with a single,
// direct two-sided voucher, mirroring exactly how Inter-Company Loans post
// (routes/loanSanction.js's postLoanToGLInternal): one postVoucher() call
// per company, each balancing on its own.
//
//   Company A's books (sender — goods went out):
//     Dr Inter-Company A/c - {Company B} ....... receivable, A is owed by B
//     Cr Inter-Company Stock Transfer A/c ...... goods-out contra
//
//   Company B's books (receiver — goods came in):
//     Dr Inter-Company Stock Transfer A/c ...... goods-in contra
//     Cr Inter-Company A/c - {Company A} ....... payable, B owes A
//
// No cash ever moves and no Dummy Bank is involved — this is a pure
// inter-company running account, exactly like a loan.

const { sql } = require("../db");
const { postVoucher, hasPosting } = require("./generalLedger");

/**
 * Get-or-create the per-counterparty "Inter-Company A/c" ledger head — one
 * head per company, reused as either the receivable leg (in the sender's
 * books, when that company is owed money) or the payable leg (in the
 * receiver's books, when that company owes money), exactly mirroring
 * loanSanction.js's ensureLoanLedgerHead (a single per-counterparty head
 * used bidirectionally; the CompanyId column on each GeneralLedgerEntry row,
 * not the AccountHeadMaster row itself, is what actually scopes a posting to
 * one company's own books).
 */
async function ensureIctDueHead(pool, counterpartyCompanyId, counterpartyCompanyName, createdBy) {
  const code = `ICT-DUE-${counterpartyCompanyId}`;
  const existing = await pool
    .request()
    .input("code", sql.NVarChar(20), code)
    .query("SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode = @code");
  if (existing.recordset.length) return existing.recordset[0].LHeadId;

  const group = await pool.request().query("SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LOANS AND ADVANCES'");
  const groupId = group.recordset[0]?.AGId ?? null;

  const inserted = await pool
    .request()
    .input("LHeadName", sql.NVarChar(200), `Inter-Company A/c - ${counterpartyCompanyName}`)
    .input("LHeadCode", sql.NVarChar(20), code)
    .input("LHeadAddress", sql.VarChar(300), "N/A")
    .input("LHeadContactPerson", sql.VarChar(100), "N/A")
    .input("LHeadType", sql.VarChar(50), "IC")
    .input("LHeadStatus", sql.Bit, 1)
    .input("LBelongsTo", sql.Int, groupId)
    .input("Status", sql.NVarChar(20), "Approved")
    .input("ApprovedBy", sql.NVarChar(100), createdBy)
    .input("CreatedBy", sql.NVarChar(100), createdBy).query(`
      INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadCode, LHeadAddress, LHeadContactPerson, LHeadType, LHeadStatus, LBelongsTo, Status, ApprovedBy, ApprovedAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.LHeadId
      VALUES
        (@LHeadName, @LHeadCode, @LHeadAddress, @LHeadContactPerson, @LHeadType, @LHeadStatus, @LBelongsTo, @Status, @ApprovedBy, SYSDATETIME(), @CreatedBy, SYSDATETIME())
    `);
  try {
    const { bumpCacheVersion } = require("../redis");
    await bumpCacheVersion("account-head-master");
  } catch { /* best-effort */ }
  return inserted.recordset[0].LHeadId;
}

/**
 * Get-or-create the per-company "Inter-Company Stock Transfer A/c" clearing
 * head — one per company (mirrors ensureCashInHandHead's per-company
 * pattern), used as the goods-out contra when that company is the sender
 * and the goods-in contra when it's the receiver. Filed under COST OF
 * MATERIALS CONSUMED, same group as Purchase A/c — this account represents
 * the same kind of value (cost of material moved), just between two
 * companies' books instead of from an external supplier.
 */
async function ensureIctClearingHead(pool, companyId, companyName, createdBy) {
  const code = `ICT-CLR-${companyId}`;
  const existing = await pool
    .request()
    .input("code", sql.NVarChar(20), code)
    .query("SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode = @code");
  if (existing.recordset.length) return existing.recordset[0].LHeadId;

  const group = await pool.request().query("SELECT AGId FROM dbo.AccountGroup WHERE Name = 'COST OF MATERIALS CONSUMED'");
  const groupId = group.recordset[0]?.AGId ?? null;

  const inserted = await pool
    .request()
    .input("LHeadName", sql.NVarChar(200), `Inter-Company Stock Transfer - ${companyName}`)
    .input("LHeadCode", sql.NVarChar(20), code)
    .input("LHeadAddress", sql.NVarChar(300), "N/A")
    .input("LHeadContactPerson", sql.NVarChar(100), "System Admin")
    .input("LHeadType", sql.VarChar(50), "GL")
    .input("LHeadStatus", sql.Bit, 1)
    .input("LBelongsTo", sql.Int, groupId)
    .input("Status", sql.NVarChar(20), "Approved")
    .input("DisplayName", sql.NVarChar(200), `Inter-Company Stock Transfer — ${companyName}`)
    .input("CompanyName", sql.NVarChar(500), companyName)
    .input("CreatedBy", sql.NVarChar(150), createdBy || "system").query(`
      INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadCode, LHeadAddress, LHeadContactPerson, LHeadType, LHeadStatus,
         LBelongsTo, Status, DisplayName, CompanyName, ApprovedBy, ApprovedAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.LHeadId
      VALUES
        (@LHeadName, @LHeadCode, @LHeadAddress, @LHeadContactPerson, @LHeadType, @LHeadStatus,
         @LBelongsTo, @Status, @DisplayName, @CompanyName, @CreatedBy, SYSDATETIME(), @CreatedBy, SYSDATETIME())
    `);
  try {
    const { bumpCacheVersion } = require("../redis");
    await bumpCacheVersion("account-head-master");
  } catch { /* best-effort */ }
  return inserted.recordset[0].LHeadId;
}

/**
 * Posts the two-sided voucher for an Inter-Company Stock Transfer. Idempotent
 * (hasPosting guard, same as every other poster in this codebase) — safe to
 * call again on an already-posted transfer.
 */
async function postInterCompanyStockTransferToGL(pool, {
  transferId,
  docNo,
  transferDate,
  senderCompanyId,
  senderCompanyName,
  receiverCompanyId,
  receiverCompanyName,
  totalAmount,
  createdBy,
}) {
  if (await hasPosting(pool, "InterCompanyTransfer", transferId))
    return { posted: true, reason: "already posted (idempotent)" };

  if (!(totalAmount > 0))
    return { posted: false, reason: `Inter-company transfer ${transferId} total is ${totalAmount} (<= 0)` };

  const senderClearingHeadId = await ensureIctClearingHead(pool, senderCompanyId, senderCompanyName, createdBy);
  const receiverDueHeadId = await ensureIctDueHead(pool, receiverCompanyId, receiverCompanyName, createdBy);
  const receiverClearingHeadId = await ensureIctClearingHead(pool, receiverCompanyId, receiverCompanyName, createdBy);
  const senderDueHeadId = await ensureIctDueHead(pool, senderCompanyId, senderCompanyName, createdBy);

  // Sender's own books: Dr receivable (owed by receiver) / Cr goods-out contra.
  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: transferDate,
    sourceType: "InterCompanyTransfer",
    sourceId: transferId,
    companyId: senderCompanyId,
    createdBy,
    legs: [
      { lHeadId: receiverDueHeadId, debit: totalAmount, narration: `${docNo} — inter-company stock transfer receivable (goods sent to ${receiverCompanyName})` },
      { lHeadId: senderClearingHeadId, credit: totalAmount, narration: `${docNo} — inter-company stock transfer (goods sent)` },
    ],
  });

  // Receiver's own books: Dr goods-in contra / Cr payable (owed to sender).
  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: transferDate,
    sourceType: "InterCompanyTransfer",
    sourceId: transferId,
    companyId: receiverCompanyId,
    createdBy,
    legs: [
      { lHeadId: receiverClearingHeadId, debit: totalAmount, narration: `${docNo} — inter-company stock transfer (goods received from ${senderCompanyName})` },
      { lHeadId: senderDueHeadId, credit: totalAmount, narration: `${docNo} — inter-company stock transfer payable (goods received)` },
    ],
  });

  return { posted: true };
}

module.exports = { ensureIctDueHead, ensureIctClearingHead, postInterCompanyStockTransferToGL };
