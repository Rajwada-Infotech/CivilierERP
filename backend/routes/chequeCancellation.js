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
    ISNULL(bm.BName, np.PBankName)  AS BankName,
    bm.BBranch                      AS BankBranch,
    cm.ChequeLotNumber              AS LotNumber,
    cc.CCId                         AS CancelledCheckId
  FROM dbo.NewPayment np
  LEFT JOIN dbo.BankMaster bm ON bm.BId = np.PBankID
  LEFT JOIN dbo.ChequeMaster cm ON cm.CId = np.PChequeLotId
  LEFT JOIN dbo.CancelledCheque cc ON cc.PaymentId = np.PPaymentID
  WHERE np.PChequeNo = @ChequeNo AND np.Status NOT IN ('Rejected', 'Deleted')
`;

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
    res.json(result.recordset);
  } catch (err) {
    console.error("CHEQUE CANCELLATION SEARCH ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /bulk-search — same lookup for a batch of cheque numbers ──────────────
// Returns one entry per requested number: the matched payment (if any) plus
// whether it's already cancelled, or found:false when nothing matches — the
// frontend renders that as "no corresponding payment entry".
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
      const payment = r.recordset[0] || null;
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
async function cancelOne(pool, { paymentId, chequeNo, reason, userEmail }) {
  const payRes = await pool
    .request()
    .input("PPaymentID", sql.Int, paymentId)
    .query(`
      SELECT np.PPaymentID, np.PChequeNo, np.PChequeLotId, np.PChequeLotNumber,
             np.PIsChequeCancelled, np.PBankID,
             ISNULL(bm.BName, np.PBankName) AS BankName,
             np.PChequeAccountNumber
      FROM dbo.NewPayment np
      LEFT JOIN dbo.BankMaster bm ON bm.BId = np.PBankID
      WHERE np.PPaymentID = @PPaymentID
    `);
  const payment = payRes.recordset[0];
  if (!payment) return { ok: false, error: "Payment not found." };
  if (!payment.PChequeNo || (chequeNo && String(payment.PChequeNo) !== String(chequeNo))) {
    return { ok: false, error: "Cheque number does not match this payment." };
  }
  if (payment.PIsChequeCancelled) {
    return { ok: false, error: "This cheque has already been cancelled." };
  }
  if (!payment.PChequeLotId) {
    return { ok: false, error: "This payment is not linked to a cheque lot." };
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
      SET PIsChequeCancelled = 1, PChequeLotId = NULL
      WHERE PPaymentID = @PPaymentID
    `);

  return { ok: true };
}

// ── POST / — cancel a single cheque ─────────────────────────────────────────────
router.post("/", requirePageRight("cheque-cancellation", "create"), async (req, res) => {
  const userEmail = requireUserEmail(req, res);
  if (!userEmail) return;

  const { paymentId, chequeNo, reason } = req.body;
  if (!paymentId) return res.status(400).json({ error: "paymentId is required" });

  try {
    const pool = getPool();
    const result = await cancelOne(pool, { paymentId: parseInt(paymentId, 10), chequeNo, reason, userEmail });
    if (!result.ok) return res.status(400).json({ error: result.error });

    await bumpCacheVersion("new-payment");
    await bumpCacheVersion("cheque-cancellation");
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
    for (const item of items) {
      const paymentId = parseInt(item.paymentId, 10);
      if (!paymentId) {
        skipped.push({ chequeNo: item.chequeNo, error: "No matching payment." });
        continue;
      }
      const result = await cancelOne(pool, {
        paymentId,
        chequeNo: item.chequeNo,
        reason,
        userEmail,
      });
      if (result.ok) cancelled.push(item.chequeNo);
      else skipped.push({ chequeNo: item.chequeNo, error: result.error });
    }

    if (cancelled.length) {
      await bumpCacheVersion("new-payment");
      await bumpCacheVersion("cheque-cancellation");
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
