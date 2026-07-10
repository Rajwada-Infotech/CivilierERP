const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
// Approve/reject is gated to admin/super_admin/marketing_head via this shared
// engine — same mechanism BOQ/Purchase Orders/etc. use — instead of any
// editor being able to self-approve a NOC on this page.
const { transition: approvalTransition } = require("../services/approvalService");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const NOC_TYPES = ["Organisation", "Bank"];

const NOC_SELECT = `
  SELECT n.*, b.BookingNo, b.UnitNo, a.ApplicantName, a.Mobile
  FROM dbo.CrmNoc n
  JOIN dbo.CrmBooking b ON b.Id = n.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
`;

// GET / — all NOCs
router.get("/", requirePageRight("crm-noc", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { type, status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (type)   { req0.input("t",  sql.NVarChar(30), type);   conds.push("n.NocType = @t"); }
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("n.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${NOC_SELECT} ${where} ORDER BY n.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-noc] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — request a NOC
router.post("/", requirePageRight("crm-noc", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const nocType = NOC_TYPES.includes(b.NocType) ? b.NocType : "Organisation";
    const nocNo = await getNextDocNumber(pool, "NOC", "NOC");

    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  nocNo)
      .input("bid",  sql.Int,           parseInt(b.BookingId))
      .input("type", sql.NVarChar(30),  nocType)
      .input("dt",   sql.Date,          b.NocDate || null)
      .input("reason", sql.NVarChar(500), b.Reason || null)
      .input("bank", sql.NVarChar(255), b.BankName || null)
      .input("acc",  sql.NVarChar(100), b.LoanAccountNo || null)
      .input("lamt", sql.Decimal(18,2), b.LoanAmount != null ? parseFloat(b.LoanAmount) : null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmNoc
          (NocNo, BookingId, NocType, NocDate, Reason, BankName, LoanAccountNo, LoanAmount, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @type, @dt, @reason, @bank, @acc, @lamt, 'Pending', @note, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, NocNo: nocNo });
  } catch (e) {
    console.error("[crm-noc] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update bank loan tracking fields/notes only. Status is never
// settable here — Approved/Rejected go through the endpoints below, Issued
// through /:id/mark-issued.
router.put("/:id", requirePageRight("crm-noc", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    await pool.request()
      .input("id",    sql.Int,  id)
      .input("lss",   sql.NVarChar(50),  b.LoanSanctionStatus || null)
      .input("lsd",   sql.Date, b.LoanSanctionDate || null)
      .input("lds",   sql.NVarChar(50),  b.LoanDisbursementStatus || null)
      .input("ldd",   sql.Date, b.LoanDisbursementDate || null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",    sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmNoc SET
          LoanSanctionStatus = ISNULL(@lss, LoanSanctionStatus), LoanSanctionDate = ISNULL(@lsd, LoanSanctionDate),
          LoanDisbursementStatus = ISNULL(@lds, LoanDisbursementStatus), LoanDisbursementDate = ISNULL(@ldd, LoanDisbursementDate),
          Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-noc] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — Rejected -> Pending (resubmit)
router.put("/:id/submit", requirePageRight("crm-noc", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-noc", id, "Pending", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-noc] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/marketing_head only, enforced inside
// approvalTransition().
router.put("/:id/approve", requirePageRight("crm-noc", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-noc", id, "Approved", userEmail, req.user?.role);
    await getPool().request()
      .input("id", sql.Int, id)
      .query("UPDATE dbo.CrmNoc SET ApprovalDate = ISNULL(ApprovalDate, CAST(SYSDATETIME() AS DATE)) WHERE Id = @id");
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-noc] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — admin/super_admin/marketing_head only.
router.put("/:id/reject", requirePageRight("crm-noc", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-noc", id, "Rejected", userEmail, req.user?.role, req.body?.Remarks || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-noc] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/mark-issued — a business action (recording physical issuance),
// not an approval decision — any editor can do this once Approved.
router.put("/:id/mark-issued", requirePageRight("crm-noc", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmNoc WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "NOC not found" });
    if (cur.recordset[0].Status !== "Approved") {
      return res.status(400).json({ error: `Cannot mark issued — NOC must be Approved (currently '${cur.recordset[0].Status}')` });
    }

    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmNoc SET Status = 'Issued', IssuedDate = CAST(SYSDATETIME() AS DATE), UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-noc] mark-issued error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
