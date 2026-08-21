/**
 * chequeCancellation.js — Finance → Transaction → Cheque Cancellation
 *
 * Lets an operator search a payment by its cheque number, view the full
 * payment it belongs to, and cancel that cheque (single or bulk). On
 * cancellation:
 *   - a permanent dbo.CancelledCheque record is written (blocks the number
 *     from ever being reissued from the same lot again — see the duplicate
 *     checks patched into newPayment.js's /deduct-cheque and
 *     /cheque-numbers/:lotId)
 *   - the originating dbo.NewPayment row is flagged PIsChequeCancelled = 1
 *     (drives the "Cancelled Cheque" badge on the Payment page) and its
 *     PChequeLotId is cleared — detaching/"removing" it from the lot,
 *     while PChequeNo is kept for audit/display traceability.
 */
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const { reversePostingBySource } = require("../services/generalLedger");
const { syncBillStatus } = require("../utils/syncBillStatus");

const requireUserEmail = (req, res) => {
  const email = req.user?.email || req.user?.name;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// Shared SELECT shape for a payment row surfaced by a cheque-number search —
// enough to render "Payment Document" details plus bank/lot context, without
// the heavier joins the main /api/new-payment list carries.
const PAYMENT_SEARCH_SELECT = `
  SELECT
    np.PPaymentID, np.DocNo, np.PPaymentName, np.PRemarks, np.PAmount,
    np.PDate, np.PMode, np.PProject, np.PCompany, np.PExpenseRef, np.Status,
    np.PChequeNo, np.PChequeLotId, np.PChequeLotNumber, np.PChequeDate,
    np.PChequeAccountNumber, np.PChequeIfsc, np.PIsPostDated, np.PBankID,
    np.PIsChequeCancelled,
    ISNULL(bm.LHeadName, np.PBankName)  AS BankName,
    bm.LBranchName                      AS BankBranch,
    cm.ChequeLotNumber                  AS LotNumber,
    cc.CCId                             AS CancelledCheckId
  FROM dbo.NewPayment np
  LEFT JOIN dbo.AccountHeadMaster bm ON bm.LHeadId = np.PBankID
  LEFT JOIN dbo.ChequeMaster cm ON cm.CId = np.PChequeLotId
  LEFT JOIN dbo.CancelledCheque cc ON cc.PaymentId = np.PPaymentID
  WHERE np.PChequeNo = @ChequeNo AND np.Status NOT IN ('Rejected', 'Deleted')
`;

// A cheque number with no dbo.NewPayment row at all (never actually issued
// against a payment) still belongs to a cheque lot/range and should still be
// cancellable — e.g. a leaf torn out, spoiled, or lost before use. This finds
// the active lot whose number range contains it and shapes the result like a
// ChequeSearchResult (PPaymentID: null marks it as payment-less) so the
// frontend can render/cancel it through the same code path as a real
// payment match.
async function findLotFallback(pool, chequeNo) {
  const num = parseInt(chequeNo, 10);
  if (!Number.isFinite(num)) return null;

  const lotRes = await pool
    .request()
    .input("Num", sql.Int, num)
    .query(`
      SELECT TOP 1
        cm.CId, cm.ChequeLotNumber, cm.ChequeStartNumber, cm.ChequeEndNumber,
        cm.BankId, cm.AccountNumber, cm.IFSCCode,
        bm.LHeadName AS BankName, bm.LBranchName AS BankBranch
      FROM dbo.ChequeMaster cm
      LEFT JOIN dbo.AccountHeadMaster bm ON bm.LHeadId = cm.BankId
      WHERE cm.Status = 1 AND cm.ChequeStartNumber <= @Num AND cm.ChequeEndNumber >= @Num
      ORDER BY cm.CId
    `);
  const lot = lotRes.recordset[0];
  if (!lot) return null;

  const cancelledRes = await pool
    .request()
    .input("ChequeLotId", sql.Int, lot.CId)
    .input("ChequeNo", sql.NVarChar(50), chequeNo)
    .query(`SELECT CCId FROM dbo.CancelledCheque WHERE ChequeLotId = @ChequeLotId AND ChequeNo = @ChequeNo`);
  const alreadyCancelled = cancelledRes.recordset.length > 0;

  return {
    PPaymentID: null,
    DocNo: null,
    PPaymentName: null,
    PRemarks: null,
    PAmount: null,
    PDate: null,
    PMode: null,
    PProject: null,
    PCompany: null,
    PExpenseRef: null,
    Status: null,
    PChequeNo: chequeNo,
    PChequeLotId: lot.CId,
    PChequeLotNumber: lot.ChequeLotNumber,
    PChequeDate: null,
    PChequeAccountNumber: lot.AccountNumber,
    PChequeIfsc: lot.IFSCCode,
    PIsPostDated: 0,
    PBankID: lot.BankId,
    PIsChequeCancelled: alreadyCancelled ? 1 : 0,
    BankName: lot.BankName,
    BankBranch: lot.BankBranch,
    LotNumber: lot.ChequeLotNumber,
    CancelledCheckId: null,
  };
}

// ── GET /search?chequeNo=XXXX — find payment entries by cheque number ──────────
router.get("/search", requirePageRight("cheque-cancellation", "view"), async (req, res) => {
  const chequeNo = (req.query.chequeNo || "").toString().trim();
  if (!chequeNo) return res.status(400).json({ error: "chequeNo is required" });

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("ChequeNo", sql.NVarChar(50), chequeNo)
      .query(`${PAYMENT_SEARCH_SELECT} ORDER BY np.PPaymentID DESC`);
    if (result.recordset.length) return res.json(result.recordset);

    // No payment ever used this number — fall back to a payment-less lot
    // match so it can still be cancelled.
    const lotMatch = await findLotFallback(pool, chequeNo);
    res.json(lotMatch ? [lotMatch] : []);
  } catch (err) {
    console.error("CHEQUE CANCELLATION SEARCH ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /bulk-search — same lookup for a batch of cheque numbers ──────────────
// Returns one entry per requested number: the matched payment (or payment-less
// lot match) if any, plus whether it's already cancelled, or found:false when
// nothing matches at all (not a real payment AND not within any active lot's
// range) — the frontend renders that as "no matching payment".
router.post("/bulk-search", requirePageRight("cheque-cancellation", "view"), async (req, res) => {
  const numbers = Array.isArray(req.body.chequeNumbers)
    ? [...new Set(req.body.chequeNumbers.map((n) => String(n).trim()).filter(Boolean))]
    : [];
  if (!numbers.length) return res.status(400).json({ error: "chequeNumbers[] is required" });

  try {
    const pool = getPool();
    const results = [];
    for (const chequeNo of numbers) {
      const r = await pool
        .request()
        .input("ChequeNo", sql.NVarChar(50), chequeNo)
        .query(`${PAYMENT_SEARCH_SELECT} ORDER BY np.PPaymentID DESC`);
      const payment = r.recordset[0] || (await findLotFallback(pool, chequeNo));
      results.push({
        chequeNo,
        found: !!payment,
        alreadyCancelled: !!payment?.PIsChequeCancelled,
        payment,
      });
    }
    res.json(results);
  } catch (err) {
    console.error("CHEQUE CANCELLATION BULK-SEARCH ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cancels one payment's cheque within an existing SQL transaction/request pool —
// shared by the single-cancel and bulk-cancel endpoints.
async function cancelOne(pool, { paymentId, chequeLotId, chequeNo, reason, userEmail }) {
  if (paymentId) {
    return cancelPaymentCheque(pool, { paymentId, chequeNo, reason, userEmail });
  }
  return cancelLotCheque(pool, { chequeLotId, chequeNo, reason, userEmail });
}

// The original path — a cheque that was actually issued against a payment.
//
// Cancelling here is treated as cancelling the *payment* the cheque backs
// (not just detaching the cheque instrument from an otherwise-still-Approved
// payment) — Status flips to 'Cancelled', its GL posting is reversed, and
// the source invoice's outstanding amount is recomputed so it becomes
// payable again. This mirrors syncBillStatus/the invoice-eligibility query
// already excluding anything with Status <> 'Approved', so no changes were
// needed there — flipping Status is what makes this payment stop counting.
async function cancelPaymentCheque(pool, { paymentId, chequeNo, reason, userEmail }) {
  const payRes = await pool
    .request()
    .input("PPaymentID", sql.Int, paymentId)
    .query(`
      SELECT np.PPaymentID, np.PChequeNo, np.PChequeLotId, np.PChequeLotNumber,
             np.PIsChequeCancelled, np.PBankID, np.Status, np.PExpenseRef,
             ISNULL(bm.LHeadName, np.PBankName) AS BankName,
             np.PChequeAccountNumber
      FROM dbo.NewPayment np
      LEFT JOIN dbo.AccountHeadMaster bm ON bm.LHeadId = np.PBankID
      WHERE np.PPaymentID = @PPaymentID
    `);
  const payment = payRes.recordset[0];
  if (!payment) return { ok: false, error: "Payment not found." };
  if (!payment.PChequeNo || (chequeNo && String(payment.PChequeNo) !== String(chequeNo))) {
    return { ok: false, error: "Cheque number does not match this payment." };
  }
  if (payment.PIsChequeCancelled || payment.Status === "Cancelled") {
    return { ok: false, error: "This cheque has already been cancelled." };
  }
  if (!payment.PChequeLotId) {
    return { ok: false, error: "This payment is not linked to a cheque lot." };
  }

  // Guard: matched/cleared in BRS — the bank has already processed this
  // cheque, so the money has (or may have) already moved. Cancelling now
  // would reverse the GL posting and reopen the invoice while the bank still
  // thinks it's settled. Must be unmatched in the BRS first.
  const brsCheck = await pool
    .request()
    .input("PPaymentID", sql.Int, payment.PPaymentID)
    .query(`
      SELECT COUNT(*) AS cnt FROM dbo.BankReconciliation
      WHERE SourceType = 'PAYMENT' AND SourceID = @PPaymentID AND IsMatched = 1
    `);
  if (Number(brsCheck.recordset[0]?.cnt) > 0) {
    return {
      ok: false,
      error: "This cheque is already matched/cleared in the Bank Reconciliation Statement. Unmatch it in the BRS before cancelling.",
    };
  }

  await pool
    .request()
    .input("ChequeLotId", sql.Int, payment.PChequeLotId)
    .input("ChequeLotNumber", sql.NVarChar(100), payment.PChequeLotNumber || null)
    .input("ChequeNo", sql.NVarChar(50), payment.PChequeNo)
    .input("PaymentId", sql.Int, payment.PPaymentID)
    .input("BankId", sql.Int, payment.PBankID || null)
    .input("BankName", sql.NVarChar(200), payment.BankName || null)
    .input("AccountNumber", sql.NVarChar(50), payment.PChequeAccountNumber || null)
    .input("Reason", sql.NVarChar(500), reason || null)
    .input("CancelledBy", sql.NVarChar(150), userEmail).query(`
      INSERT INTO dbo.CancelledCheque
        (ChequeLotId, ChequeLotNumber, ChequeNo, PaymentId, BankId, BankName, AccountNumber, Reason, CancelledBy, CancelledAt)
      VALUES
        (@ChequeLotId, @ChequeLotNumber, @ChequeNo, @PaymentId, @BankId, @BankName, @AccountNumber, @Reason, @CancelledBy, SYSUTCDATETIME())
    `);

  await pool
    .request()
    .input("PPaymentID", sql.Int, payment.PPaymentID)
    .query(`
      UPDATE dbo.NewPayment
      SET PIsChequeCancelled = 1, PChequeLotId = NULL, Status = 'Cancelled'
      WHERE PPaymentID = @PPaymentID
    `);

  // Reverse whatever GL posting this payment made on approval — a no-op if
  // it was never posted (e.g. still Pending) since the underlying UPDATE is
  // scoped to IsReversed = 0 rows for this exact source.
  await reversePostingBySource(pool, "NewPayment", payment.PPaymentID);

  // Recompute the invoice's paid/remaining amount now that this payment no
  // longer counts (Status='Cancelled' is already excluded by syncBillStatus's
  // own query) — this is what makes the invoice payable again.
  if (payment.PExpenseRef) {
    await syncBillStatus(pool, sql, payment.PExpenseRef);
  }

  // This payment may BE a loan repayment (Finance > Payment's Loan EMIs tab
  // creates the NewPayment row first, then links it via
  // LoanPayment.NewPaymentId — migration 340). If so, cancelling its cheque
  // must undo the repayment's effect on the loan too: the EMI(s) it marked
  // paid, the OnAccountLedger entries it posted, and its own GL voucher —
  // otherwise a bounced/cancelled repayment cheque leaves the loan looking
  // paid down when the money never actually arrived.
  const loanReversal = await reverseLoanRepaymentIfLinked(pool, {
    newPaymentId: payment.PPaymentID,
    reason: `Cheque #${payment.PChequeNo} cancelled: ${reason || "no reason given"}`,
  });

  return { ok: true, expenseRef: payment.PExpenseRef || null, loanReversal };
}

// Undoes a LoanPayment's effect when the NewPayment backing it gets its
// cheque cancelled. No-ops (returns null) if this NewPayment was never
// linked to a loan repayment. Never deletes the LoanPayment row itself —
// same "flag, don't delete" convention as GeneralLedgerEntry.IsReversed —
// it stays as the historical record that this repayment was attempted and
// later reversed.
async function reverseLoanRepaymentIfLinked(pool, { newPaymentId, reason }) {
  const lpRes = await pool
    .request()
    .input("NewPaymentId", sql.Int, newPaymentId)
    .query(`
      SELECT PaymentId, LoanId, PrincipalInterestAmount, ExcessCredited, IsReversed
      FROM dbo.LoanPayment WHERE NewPaymentId = @NewPaymentId
    `);
  const loanPayment = lpRes.recordset[0];
  if (!loanPayment || loanPayment.IsReversed) return null;

  // Un-mark whichever EMIs this payment covered — they go back to unpaid,
  // available to be paid again for real.
  await pool
    .request()
    .input("PaymentId", sql.Int, loanPayment.PaymentId)
    .query(`
      UPDATE dbo.LoanEMISchedule
      SET IsPaid = 0, PaidDate = NULL, PaidBy = NULL, PaymentId = NULL
      WHERE PaymentId = @PaymentId
    `);

  // Compensating entries for whatever this repayment posted to
  // OnAccountLedger (see loanSanction.js POST /:id/pay) — a DEBIT reducing
  // the borrower's balance, and if there was an early-closure overpayment,
  // a CREDIT to the lender's balance. Insert the opposite entry rather
  // than deleting the original, so the ledger keeps a full audit trail of
  // both the original posting and its reversal.
  const oaRows = await pool
    .request()
    .input("RefId", sql.Int, loanPayment.PaymentId)
    .query(`
      SELECT LedgerId, PartyId, PartyType, TxnType, Amount, RefType, RefDocNo, CompanyId
      FROM dbo.OnAccountLedger WHERE RefType IN ('LoanPayment', 'LoanOverpayment') AND RefId = @RefId
    `);
  for (const row of oaRows.recordset) {
    const reversedTxnType = row.TxnType === "DEBIT" ? "CREDIT" : "DEBIT";
    const balanceOp = reversedTxnType === "CREDIT" ? "+" : "-";
    await pool
      .request()
      .input("PartyId", sql.Int, row.PartyId)
      .input("PartyType", sql.NVarChar(20), row.PartyType)
      .input("TxnType", sql.NVarChar(10), reversedTxnType)
      .input("Amount", sql.Decimal(18, 2), row.Amount)
      .input("RefType", sql.NVarChar(30), `${row.RefType}Reversal`)
      .input("RefDocNo", sql.NVarChar(100), row.RefDocNo)
      .input("RefId", sql.Int, loanPayment.PaymentId)
      .input("CompanyId", sql.Int, row.CompanyId)
      .input("Notes", sql.NVarChar(500), reason)
      .input("CreatedBy", sql.NVarChar(150), "system").query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, RefId, CompanyId, Notes, CreatedBy)
        VALUES
          (@PartyId, @PartyType, SYSUTCDATETIME(), @TxnType, @Amount, @RefType, @RefDocNo, @RefId, @CompanyId, @Notes, @CreatedBy);
        UPDATE dbo.AccountHeadMaster
          SET OnAccountBalance = ISNULL(OnAccountBalance, 0) ${balanceOp} @Amount
          WHERE LHeadId = @PartyId;
      `);
  }

  // Reverse whatever GL voucher(s) this repayment posted — same SourceType
  // (LoanRepayment) / SourceId (the LoanPayment's own PK) every repayment
  // posting path in loanSanction.js uses.
  await reversePostingBySource(pool, "LoanRepayment", loanPayment.PaymentId);

  await pool
    .request()
    .input("PaymentId", sql.Int, loanPayment.PaymentId)
    .input("Reason", sql.NVarChar(500), reason)
    .query(`
      UPDATE dbo.LoanPayment
      SET IsReversed = 1, ReversedAt = SYSDATETIME(), ReversedReason = @Reason
      WHERE PaymentId = @PaymentId
    `);

  return { loanId: loanPayment.LoanId, loanPaymentId: loanPayment.PaymentId };
}

// The new path — a cheque number that was never issued against any payment.
// Validated straight against its lot (must exist, be active, and have the
// number within its range) rather than against dbo.NewPayment. PaymentId is
// stored NULL on the CancelledCheque row (the column is nullable precisely
// for this case).
async function cancelLotCheque(pool, { chequeLotId, chequeNo, reason, userEmail }) {
  if (!chequeLotId || !chequeNo) {
    return { ok: false, error: "Cheque number not found." };
  }

  const lotRes = await pool
    .request()
    .input("CId", sql.Int, chequeLotId)
    .query(`
      SELECT cm.CId, cm.ChequeLotNumber, cm.ChequeStartNumber, cm.ChequeEndNumber,
             cm.BankId, cm.AccountNumber, bm.LHeadName AS BankName
      FROM dbo.ChequeMaster cm
      LEFT JOIN dbo.AccountHeadMaster bm ON bm.LHeadId = cm.BankId
      WHERE cm.CId = @CId AND cm.Status = 1
    `);
  const lot = lotRes.recordset[0];
  if (!lot) return { ok: false, error: "Cheque lot not found or inactive." };

  const num = parseInt(chequeNo, 10);
  const start = Number(lot.ChequeStartNumber);
  const end = Number(lot.ChequeEndNumber);
  if (!Number.isFinite(num) || num < start || num > end) {
    return { ok: false, error: "Cheque number is out of this lot's range." };
  }

  // Guards against a race where the cheque got issued against a payment
  // between search and cancel — that case belongs to cancelPaymentCheque.
  const usedRes = await pool
    .request()
    .input("PChequeLotId", sql.Int, chequeLotId)
    .input("PChequeNo", sql.NVarChar(50), String(chequeNo))
    .query(`
      SELECT TOP 1 PPaymentID FROM dbo.NewPayment
      WHERE PChequeLotId = @PChequeLotId AND PChequeNo = @PChequeNo AND Status NOT IN ('Rejected', 'Deleted')
    `);
  if (usedRes.recordset.length) {
    return { ok: false, error: "This cheque number is now linked to a payment — search again to cancel it." };
  }

  const dupRes = await pool
    .request()
    .input("ChequeLotId", sql.Int, chequeLotId)
    .input("ChequeNo", sql.NVarChar(50), String(chequeNo))
    .query(`SELECT CCId FROM dbo.CancelledCheque WHERE ChequeLotId = @ChequeLotId AND ChequeNo = @ChequeNo`);
  if (dupRes.recordset.length) {
    return { ok: false, error: "This cheque has already been cancelled." };
  }

  await pool
    .request()
    .input("ChequeLotId", sql.Int, lot.CId)
    .input("ChequeLotNumber", sql.NVarChar(100), lot.ChequeLotNumber || null)
    .input("ChequeNo", sql.NVarChar(50), String(chequeNo))
    .input("PaymentId", sql.Int, null)
    .input("BankId", sql.Int, lot.BankId || null)
    .input("BankName", sql.NVarChar(200), lot.BankName || null)
    .input("AccountNumber", sql.NVarChar(50), lot.AccountNumber || null)
    .input("Reason", sql.NVarChar(500), reason || null)
    .input("CancelledBy", sql.NVarChar(150), userEmail).query(`
      INSERT INTO dbo.CancelledCheque
        (ChequeLotId, ChequeLotNumber, ChequeNo, PaymentId, BankId, BankName, AccountNumber, Reason, CancelledBy, CancelledAt)
      VALUES
        (@ChequeLotId, @ChequeLotNumber, @ChequeNo, @PaymentId, @BankId, @BankName, @AccountNumber, @Reason, @CancelledBy, SYSUTCDATETIME())
    `);

  return { ok: true };
}

// ── POST / — cancel a single cheque ─────────────────────────────────────────────
router.post("/", requirePageRight("cheque-cancellation", "create"), async (req, res) => {
  const userEmail = requireUserEmail(req, res);
  if (!userEmail) return;

  const { paymentId, chequeLotId, chequeNo, reason } = req.body;
  if (!paymentId && !(chequeLotId && chequeNo)) {
    return res.status(400).json({ error: "paymentId, or chequeLotId and chequeNo, is required" });
  }

  try {
    const pool = getPool();
    const result = await cancelOne(pool, {
      paymentId: paymentId ? parseInt(paymentId, 10) : null,
      chequeLotId: chequeLotId ? parseInt(chequeLotId, 10) : null,
      chequeNo,
      reason,
      userEmail,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });

    await bumpCacheVersion("new-payment");
    await bumpCacheVersion("cheque-cancellation");
    if (result.expenseRef) await bumpCacheVersion("expense-booking");
    if (result.loanReversal) await bumpCacheVersion("loan-sanction");
    res.json({ message: "Cheque cancelled successfully." });
  } catch (err) {
    console.error("CHEQUE CANCELLATION ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /bulk — cancel every valid entry in a batch ────────────────────────────
router.post("/bulk", requirePageRight("cheque-cancellation", "create"), async (req, res) => {
  const userEmail = requireUserEmail(req, res);
  if (!userEmail) return;

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const reason = req.body.reason || null;
  if (!items.length) return res.status(400).json({ error: "items[] is required" });

  try {
    const pool = getPool();
    const cancelled = [];
    const skipped = [];
    let anyExpenseRef = false;
    let anyLoanReversal = false;
    for (const item of items) {
      const paymentId = item.paymentId ? parseInt(item.paymentId, 10) : null;
      const chequeLotId = item.chequeLotId ? parseInt(item.chequeLotId, 10) : null;
      if (!paymentId && !chequeLotId) {
        skipped.push({ chequeNo: item.chequeNo, error: "No matching payment or cheque lot." });
        continue;
      }
      const result = await cancelOne(pool, {
        paymentId,
        chequeLotId,
        chequeNo: item.chequeNo,
        reason,
        userEmail,
      });
      if (result.ok) {
        cancelled.push(item.chequeNo);
        if (result.expenseRef) anyExpenseRef = true;
        if (result.loanReversal) anyLoanReversal = true;
      } else {
        skipped.push({ chequeNo: item.chequeNo, error: result.error });
      }
    }

    if (cancelled.length) {
      await bumpCacheVersion("new-payment");
      await bumpCacheVersion("cheque-cancellation");
      if (anyExpenseRef) await bumpCacheVersion("expense-booking");
      if (anyLoanReversal) await bumpCacheVersion("loan-sanction");
    }
    res.json({ cancelled, skipped });
  } catch (err) {
    console.error("CHEQUE CANCELLATION BULK ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list cancelled cheques (Cancelled Cheques page + Reports source) ───
router.get("/", requirePageRight("cheque-cancellation", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 1000);
    const offset = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : "";

    const request = pool.request();
    let whereClause = "";
    if (search) {
      whereClause = `WHERE (cc.ChequeNo LIKE @search OR cc.ChequeLotNumber LIKE @search
        OR cc.BankName LIKE @search OR np.DocNo LIKE @search OR np.PPaymentName LIKE @search)`;
      request.input("search", sql.NVarChar(200), `%${search}%`);
    }

    const countResult = await request.query(
      `SELECT COUNT(*) AS total FROM dbo.CancelledCheque cc
       LEFT JOIN dbo.NewPayment np ON np.PPaymentID = cc.PaymentId
       ${whereClause}`,
    );
    const total = parseInt(countResult.recordset[0].total);

    const dataRequest = pool.request().input("offset", sql.Int, offset).input("limit", sql.Int, limit);
    if (search) dataRequest.input("search", sql.NVarChar(200), `%${search}%`);

    const result = await dataRequest.query(`
      SELECT
        cc.CCId, cc.ChequeLotId, cc.ChequeLotNumber, cc.ChequeNo, cc.PaymentId,
        cc.BankId, cc.BankName, cc.AccountNumber, cc.Reason, cc.CancelledBy, cc.CancelledAt,
        np.DocNo, np.PPaymentName, np.PAmount, np.PDate, np.PProject, np.PCompany,
        ISNULL(ec.name, np.PCompany) AS PCompanyName
      FROM dbo.CancelledCheque cc
      LEFT JOIN dbo.NewPayment np ON np.PPaymentID = cc.PaymentId
      LEFT JOIN dbo.enterprise ec ON ec.id = TRY_CAST(np.PCompany AS INT) AND ec.business_type = 'C'
      ${whereClause}
      ORDER BY cc.CancelledAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({ data: result.recordset, page, limit, total, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("CHEQUE CANCELLATION LIST ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// Exposed for one-off backfill/repair scripts (e.g.
// scripts/cancelDuplicatePayment.js) that need to run the exact same
// cancellation logic the API route uses, rather than reimplementing it.
module.exports.cancelPaymentCheque = cancelPaymentCheque;
