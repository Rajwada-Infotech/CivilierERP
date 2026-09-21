// Payment-mode ("how did the money settle") handling for documents that aren't
// a Payment themselves but still record one — currently Journal Voucher.
// Mirrors Fund Transfer's mode rules (Cash / Cheque / Post-Dated Cheque /
// NEFT / UPI / RTGS / IMPS / Card) and draws cheque leaves from the same
// dbo.ChequeMaster lots as Payment, Fund Transfer and Loan Sanction, so one
// physical leaf can never be claimed twice across modules.

const { sql } = require("../db");

const VALID_MODES = ["Cash", "Cheque", "Post-Dated Cheque", "NEFT", "UPI", "RTGS", "IMPS", "Card"];
const CHEQUE_MODES = ["Cheque", "Post-Dated Cheque"];

const isChequeMode = (mode) => CHEQUE_MODES.includes(mode);

/** The mode is optional (a plain journal has none). Returns an error string or null. */
function validateSettlementMode(b) {
  const mode = b.Mode || null;
  if (!mode) return null;
  if (!VALID_MODES.includes(mode)) return "Invalid payment Mode.";
  if (isChequeMode(mode)) {
    if (!parseInt(b.BankId, 10)) return "Select the bank account the cheque is drawn on.";
    if (!parseInt(b.ChequeLotId, 10) || !b.ChequeNo) return "Select a cheque lot and cheque number for this mode.";
    if (!b.ChequeDate) return "Cheque date is required for this mode.";
  }
  return null;
}

/** Only the fields relevant to the chosen mode survive — switching from Cheque
 *  to Cash must not leave a stale leaf claimed on the row. */
function normalizeSettlementMode(b) {
  const mode = VALID_MODES.includes(b.Mode) ? b.Mode : null;
  const cheque = isChequeMode(mode);
  const digital = !!mode && !cheque && mode !== "Cash";
  return {
    Mode: mode,
    BankId: cheque || digital ? parseInt(b.BankId, 10) || null : null,
    ChequeLotId: cheque ? parseInt(b.ChequeLotId, 10) || null : null,
    ChequeNo: cheque ? String(b.ChequeNo) : null,
    ChequeDate: cheque ? b.ChequeDate || null : null,
    IsPostDated: mode === "Post-Dated Cheque" ? 1 : 0,
    DigitalRefNumber: digital ? (b.DigitalRefNumber ? String(b.DigitalRefNumber).trim() || null : null) : null,
  };
}

const conflict = (message) => Object.assign(new Error(message), { status: 409 });

/**
 * Confirms the (lot, number) leaf can be claimed by a Journal Voucher: the lot
 * is active and belongs to the chosen bank, the number is inside the lot's
 * range, and no Payment / Fund Transfer / Loan Sanction / other Journal
 * Voucher holds it (Rejected/Deleted ones don't count) and it wasn't cancelled.
 * `executor` is a pool or a transaction. Returns the lot's ChequeLotNumber.
 */
async function assertChequeLeafFree(executor, { lotId, chequeNo, bankId, excludeJVId = null }) {
  const lot = await executor
    .request()
    .input("lot", sql.Int, lotId)
    .query(
      "SELECT ChequeLotNumber, BankId, ChequeStartNumber, ChequeEndNumber FROM dbo.ChequeMaster WHERE CId = @lot AND Status = 1",
    );
  if (!lot.recordset.length) throw Object.assign(new Error("Cheque lot not found or inactive."), { status: 400 });
  const row = lot.recordset[0];
  if (bankId && Number(row.BankId) !== Number(bankId)) {
    throw Object.assign(new Error("That cheque lot doesn't belong to the selected bank account."), { status: 400 });
  }
  const n = Number(chequeNo);
  if (!Number.isFinite(n) || n < Number(row.ChequeStartNumber) || n > Number(row.ChequeEndNumber)) {
    throw Object.assign(new Error("Cheque number is outside the selected lot's range."), { status: 400 });
  }

  const used = await executor
    .request()
    .input("lot", sql.Int, lotId)
    .input("no", sql.NVarChar(50), String(chequeNo))
    .input("exclude", sql.Int, excludeJVId).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.NewPayment WHERE PChequeLotId = @lot AND PChequeNo = @no
           AND Status NOT IN ('Rejected', 'Deleted')) AS pay,
        (SELECT COUNT(*) FROM dbo.FundTransfer WHERE ChequeLotId = @lot AND ChequeNo = @no
           AND Status NOT IN ('Rejected', 'Deleted')) AS ft,
        (SELECT COUNT(*) FROM dbo.LoanSanction WHERE ChequeLotId = @lot AND ChequeNo = @no
           AND Status NOT IN ('Rejected', 'Deleted')) AS ls,
        (SELECT COUNT(*) FROM dbo.JournalVoucher WHERE ChequeLotId = @lot AND ChequeNo = @no
           AND Status NOT IN ('Rejected', 'Deleted')
           AND (@exclude IS NULL OR JVID <> @exclude)) AS jv,
        (SELECT COUNT(*) FROM dbo.CancelledCheque WHERE ChequeLotId = @lot AND ChequeNo = @no) AS cancelled
    `);
  const u = used.recordset[0];
  if (u.pay > 0) throw conflict("Cheque number already used in a Payment.");
  if (u.ft > 0) throw conflict("Cheque number already used in a Fund Transfer.");
  if (u.ls > 0) throw conflict("Cheque number already used in a Loan Sanction.");
  if (u.jv > 0) throw conflict("Cheque number already used in another Journal Voucher.");
  if (u.cancelled > 0) throw conflict("This cheque number has been cancelled and cannot be reissued.");
  return row.ChequeLotNumber;
}

module.exports = {
  VALID_MODES,
  CHEQUE_MODES,
  isChequeMode,
  validateSettlementMode,
  normalizeSettlementMode,
  assertChequeLeafFree,
};
