const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
// Approve/reject is gated to admin/super_admin/dba via this shared engine —
// same mechanism BOQ/Purchase Orders/etc. use — instead of any editor being
// able to self-approve brokerage on this page.
const { transition: approvalTransition, recordGLPosting } = require("../services/approvalService");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { postCrmBrokerPaymentToGL } = require("../services/crmLedger");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const BROKERAGE_SELECT = `
  SELECT br.*, b.BookingNo, b.UnitNo, b.TotalValue, a.ApplicantName,
         ahm.LHeadName AS BrokerMasterName, ahm.LHeadPhone AS BrokerMasterPhone,
         m.MilestoneName
  FROM dbo.CrmBrokerageMaster br
  JOIN dbo.CrmBooking b ON b.Id = br.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = br.BrokerId
  LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = br.MilestoneId
`;

// GET / — all brokerage records. Staff/internal only — never exposed to crm-portal.
router.get("/", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); conds.push("br.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${BROKERAGE_SELECT} ${where} ORDER BY br.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-brokerage] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /payments — every broker payment across all brokerage records, for the
// dedicated Broker Payment page (distinct from Broker Master and Brokerage).
router.get("/payments", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); conds.push("br.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
      SELECT p.Id, p.BrokerageId, p.Amount, p.PaidDate, p.PaymentMode, p.TransactionRef, p.Notes, p.CreatedAt,
             br.RateType, br.RateValue, br.ComputedAmount, br.Status AS BrokerageStatus,
             br.BrokerName, br.BrokerFirm, b.BookingNo, b.UnitNo, a.ApplicantName,
             cu.name AS CreatedByName
      FROM dbo.CrmBrokerPayment p
      JOIN dbo.CrmBrokerageMaster br ON br.Id = p.BrokerageId
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.Users cu ON cu.id = p.CreatedBy
      ${where}
      ORDER BY p.PaidDate DESC, p.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-brokerage] GET /payments error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [brRes, payRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${BROKERAGE_SELECT} WHERE br.Id = @id`),
      pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmBrokerPayment WHERE BrokerageId = @id ORDER BY PaidDate DESC"),
    ]);
    if (!brRes.recordset[0]) return res.status(404).json({ error: "Brokerage record not found" });
    res.json({ brokerage: brRes.recordset[0], payments: payRes.recordset });
  } catch (e) {
    console.error("[crm-brokerage] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — record broker involvement for a booking. Broker must be picked
// from the Broker Master (an AccountHeadMaster row, LHeadType='BR') — the
// same pattern Contractors use — not free-typed.
//
// Workflow guard: the spec's own ordering is explicit — "...DATE OF
// AGREEMENT -> MILESTONE => BROKERAGE MASTER..." — brokerage is recorded
// once the deal is actually confirmed (agreement executed), not while it's
// still being negotiated.
router.post("/", requirePageRight("crm-brokerage", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    if (!b.BrokerId) return res.status(400).json({ error: "Broker is required — select one from Broker Master" });

    const activeErr = await requireActiveBooking(pool, parseInt(b.BookingId));
    if (activeErr) return res.status(400).json({ error: activeErr });

    const agr = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT Status FROM dbo.CrmAgreement WHERE BookingId = @bid");
    if (!agr.recordset.length || !["Executed", "Registered"].includes(agr.recordset[0].Status)) {
      return res.status(400).json({ error: "Brokerage requires the agreement to be Executed first" });
    }

    const broker = await pool.request().input("bid", sql.Int, parseInt(b.BrokerId))
      .query("SELECT LHeadId, LHeadName, LHeadPhone FROM dbo.AccountHeadMaster WHERE LHeadId = @bid AND LHeadType = 'BR' AND LHeadStatus = 1");
    if (!broker.recordset.length) return res.status(400).json({ error: "Selected broker does not exist or is inactive" });

    const rateType = b.RateType === "Amount" ? "Amount" : "Percentage";
    const rateValue = parseFloat(b.RateValue);
    if (!rateValue || rateValue <= 0) return res.status(400).json({ error: "RateValue must be greater than 0" });

    const bk = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT TotalValue FROM dbo.CrmBooking WHERE Id = @bid");
    const totalValue = bk.recordset[0]?.TotalValue || 0;
    const computedAmount = rateType === "Percentage" ? Math.round(totalValue * rateValue) / 100 : rateValue;

    const result = await pool.request()
      .input("bid",   sql.Int,           parseInt(b.BookingId))
      .input("brid",  sql.Int,           broker.recordset[0].LHeadId)
      .input("name",  sql.NVarChar(200), broker.recordset[0].LHeadName)
      .input("firm",  sql.NVarChar(200), b.BrokerFirm || null)
      .input("con",   sql.NVarChar(20),  broker.recordset[0].LHeadPhone || null)
      .input("rt",    sql.NVarChar(20),  rateType)
      .input("rv",    sql.Decimal(18,2),rateValue)
      .input("camt",  sql.Decimal(18,2),computedAmount)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmBrokerageMaster
          (BookingId, BrokerId, BrokerName, BrokerFirm, BrokerContact, RateType, RateValue, ComputedAmount, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @brid, @name, @firm, @con, @rt, @rv, @camt, 'Pending', @notes, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Brokerage already recorded for this booking" });
    console.error("[crm-brokerage] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — edit brokerage terms/notes only. Status is never settable here —
// Approved goes through /:id/approve, Paid is derived automatically from
// payments, so this endpoint can't be used to skip either gate.
router.put("/:id", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    await pool.request()
      .input("id", sql.Int, id)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmBrokerageMaster SET
          Notes = @notes, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-brokerage] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/dba only, enforced inside
// approvalTransition(). Only reachable from the Admin Approval Inbox —
// approve/reject no longer live on this page at all. A brokerage record
// must be Approved here before any payment can be recorded against it.
router.put("/:id/submit", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-brokerage", id, "Pending", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-brokerage] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put("/:id/approve", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    // Each tranche stays locked until its own milestone is Paid/Waived (see
    // maybeUnlockBrokerageMilestoneTranche) — can't be approved (or, by
    // extension, paid) before then.
    const pool = getPool();
    const locked = await pool.request().input("id", sql.Int, id)
      .query("SELECT IsLocked, MilestoneNo FROM dbo.CrmBrokerageMaster WHERE Id = @id");
    if (locked.recordset[0]?.IsLocked) {
      return res.status(400).json({ error: `This tranche unlocks once Milestone #${locked.recordset[0].MilestoneNo ?? "?"} is paid` });
    }

    const result = await approvalTransition("crm-brokerage", id, "Approved", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-brokerage] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — admin/super_admin/dba only.
router.put("/:id/reject", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-brokerage", id, "Rejected", userEmail, req.user?.role, req.body?.note || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-brokerage] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// POST /:id/payments — record broker payout. Requires the brokerage record to
// already be Approved (blocks paying an unapproved broker) and rejects any
// amount that would overpay past ComputedAmount.
router.post("/:id/payments", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const brokerageId = parseInt(req.params.id);
    const b = req.body;
    const amount = parseFloat(b.Amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const br = await pool.request().input("id", sql.Int, brokerageId).query(`
      SELECT br.Status, br.ComputedAmount, br.IsLocked, br.MilestoneNo,
             (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id) AS TotalPaid
      FROM dbo.CrmBrokerageMaster br WHERE br.Id = @id
    `);
    if (!br.recordset.length) return res.status(404).json({ error: "Brokerage record not found" });
    const row = br.recordset[0];

    if (row.IsLocked) {
      return res.status(400).json({ error: `This tranche unlocks once Milestone #${row.MilestoneNo ?? "?"} is paid` });
    }

    if (row.Status !== "Approved") {
      return res.status(400).json({ error: `This brokerage record must be Approved before a payment can be recorded (currently '${row.Status}')` });
    }

    const remaining = Number(row.ComputedAmount) - Number(row.TotalPaid);
    if (amount > remaining + 0.01) {
      return res.status(400).json({ error: `Amount exceeds the outstanding brokerage balance of ₹${remaining.toLocaleString("en-IN")}` });
    }

    const insResult = await pool.request()
      .input("bid",  sql.Int,           brokerageId)
      .input("amt",  sql.Decimal(18,2), amount)
      .input("pd",   sql.Date,          b.PaidDate || null)
      .input("mode", sql.NVarChar(50),  b.PaymentMode || null)
      .input("tref", sql.NVarChar(200), b.TransactionRef || null)
      .input("notes",sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmBrokerPayment (BrokerageId, Amount, PaidDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @amt, ISNULL(@pd, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @notes, @cb, SYSDATETIME())
      `);
    const paymentId = insResult.recordset[0].Id;

    // Mark as Paid once total payments reach the computed amount
    await pool.request().input("id", sql.Int, brokerageId).query(`
      UPDATE dbo.CrmBrokerageMaster SET
        Status = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmBrokerPayment WHERE BrokerageId = @id) >= ComputedAmount
                       THEN 'Paid' ELSE Status END,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

    // Post to the core Finance GL — money actually paid out. Never allowed
    // to fail the payment record itself.
    const actorEmail = req.user?.email || req.user?.name || null;
    try {
      const outcome = await postCrmBrokerPaymentToGL(pool, paymentId, actorEmail);
      await recordGLPosting("crm-broker-payment", paymentId, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-broker-payment", paymentId, { failed: true, reason: glErr.message }, actorEmail);
    }

    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-brokerage] POST /:id/payments error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
