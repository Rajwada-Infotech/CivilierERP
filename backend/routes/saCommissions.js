const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin } = require("../services/saAccess");
const { postSaCommissionToGL } = require("../services/saLedger");
const { recordGLPosting } = require("../services/approvalService");
const { assertNoChannelPartnerBrokerageConflict } = require("../services/saCommissionGuards");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const COMMISSION_SELECT = `
  SELECT
    c.Id, c.LeadId, c.BookingId, c.BookingValue,
    c.SalespersonId, c.TeamLeadId, c.ChannelPartnerId,
    c.SpRate, c.SpAmount, c.TlRate, c.TlAmount, c.CpRate, c.CpAmount,
    c.Status, c.ApprovedBy, c.ApprovedAt, c.PaidAt, c.Notes,
    c.CreatedAt, c.UpdatedAt,
    sp.name  AS SalespersonName,
    tl.name  AS TeamLeadName,
    cp.Name  AS ChannelPartnerName,
    ab.name  AS ApprovedByName,
    l.LeadUid, l.CustomerName
  FROM dbo.SaCommission c
  LEFT JOIN dbo.Users sp ON sp.id = c.SalespersonId
  LEFT JOIN dbo.Users tl ON tl.id = c.TeamLeadId
  LEFT JOIN dbo.SaChannelPartner cp ON cp.Id = c.ChannelPartnerId
  LEFT JOIN dbo.Users ab ON ab.id = c.ApprovedBy
  LEFT JOIN dbo.SaLead l ON l.Id = c.LeadId
`;

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasChannelPartnerPayout(channelPartnerId, cpRate, cpAmount) {
  return !!channelPartnerId || Number(cpRate || 0) > 0 || Number(cpAmount || 0) > 0;
}

// GET / — all commissions (admin) or own commissions (SP/TL)
router.get("/", requirePageRight("sa-commissions", "view"), async (req, res) => {
  try {
    const pool   = getPool();
    const actor  = actorId(req);
    const isAdmin = isSaAdmin(req);
    const { status } = req.query;

    const req0 = pool.request();
    const conditions = [];

    if (!isAdmin && actor) {
      req0.input("actorId", sql.Int, actor);
      conditions.push("(c.SalespersonId = @actorId OR c.TeamLeadId = @actorId)");
    }
    if (status) { req0.input("status", sql.NVarChar(20), status); conditions.push("c.Status = @status"); }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const result = await req0.query(`${COMMISSION_SELECT} ${where} ORDER BY c.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-commissions] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create commission record (called automatically on booking or manually)
router.post("/", requirePageRight("sa-commissions", "create"), async (req, res) => {
  try {
    const pool  = getPool();
    const b     = req.body;

    const spRate   = toNullableNumber(b.SpRate);
    const tlRate   = toNullableNumber(b.TlRate);
    const cpRate   = toNullableNumber(b.CpRate);
    const bv       = toNullableNumber(b.BookingValue);
    const spAmount = spRate != null && bv != null ? Math.round(bv * spRate) / 100 : null;
    const tlAmount = tlRate != null && bv != null ? Math.round(bv * tlRate) / 100 : null;
    const cpAmount = cpRate != null && bv != null ? Math.round(bv * cpRate) / 100 : null;
    const bookingId = b.BookingId ? parseInt(b.BookingId) : null;
    const channelPartnerId = b.ChannelPartnerId ? parseInt(b.ChannelPartnerId) : null;

    if (hasChannelPartnerPayout(channelPartnerId, cpRate, cpAmount)) {
      return res.status(400).json({ error: "Channel partner payouts must be handled through CRM Brokerage, not SA Commissions." });
    }
    await assertNoChannelPartnerBrokerageConflict(pool, bookingId, channelPartnerId, cpAmount);

    const result = await pool.request()
      .input("lid",   sql.Int,           b.LeadId   ? parseInt(b.LeadId)   : null)
      .input("bid",   sql.Int,           bookingId)
      .input("spid",  sql.Int,           b.SalespersonId ? parseInt(b.SalespersonId) : null)
      .input("tlid",  sql.Int,           b.TeamLeadId    ? parseInt(b.TeamLeadId)    : null)
      .input("cpid",  sql.Int,           channelPartnerId)
      .input("bv",    sql.Decimal(18,2), bv)
      .input("spRate",sql.Decimal(5,2),  spRate)
      .input("spAmt", sql.Decimal(18,2), spAmount)
      .input("tlRate",sql.Decimal(5,2),  tlRate)
      .input("tlAmt", sql.Decimal(18,2), tlAmount)
      .input("cpRate",sql.Decimal(5,2),  cpRate)
      .input("cpAmt", sql.Decimal(18,2), cpAmount)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .query(`
        INSERT INTO dbo.SaCommission
          (LeadId, BookingId, SalespersonId, TeamLeadId, ChannelPartnerId,
           BookingValue, SpRate, SpAmount, TlRate, TlAmount, CpRate, CpAmount, Notes)
        OUTPUT INSERTED.Id
        VALUES (@lid, @bid, @spid, @tlid, @cpid,
                @bv, @spRate, @spAmt, @tlRate, @tlAmt, @cpRate, @cpAmt, @notes)
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[sa-commissions] POST error:", e.message);
    res.status(e.statusCode || 500).json({ error: e.message, conflict: e.conflict });
  }
});

// PUT /:id — update rates / approve / mark paid
router.put("/:id", requirePageRight("sa-commissions", "edit"), async (req, res) => {
  try {
    const pool  = getPool();
    const b     = req.body;
    const actor = actorId(req);
    const id    = parseInt(req.params.id);

    const spRate   = toNullableNumber(b.SpRate);
    const tlRate   = toNullableNumber(b.TlRate);
    const cpRate   = toNullableNumber(b.CpRate);
    const bv       = toNullableNumber(b.BookingValue);
    const spAmount = spRate != null && bv != null ? Math.round(bv * spRate) / 100 : null;
    const tlAmount = tlRate != null && bv != null ? Math.round(bv * tlRate) / 100 : null;
    const cpAmount = cpRate != null && bv != null ? Math.round(bv * cpRate) / 100 : null;

    const current = await pool.request()
      .input("id", sql.Int, id)
      .query("SELECT BookingId, ChannelPartnerId, CpAmount FROM dbo.SaCommission WHERE Id = @id");
    if (!current.recordset.length) return res.status(404).json({ error: "Commission not found" });
    const cur = current.recordset[0];
    if (hasChannelPartnerPayout(cur.ChannelPartnerId, cpRate, cpAmount != null ? cpAmount : cur.CpAmount)) {
      return res.status(400).json({ error: "Channel partner payouts must be handled through CRM Brokerage, not SA Commissions." });
    }
    await assertNoChannelPartnerBrokerageConflict(
      pool,
      cur.BookingId,
      cur.ChannelPartnerId,
      cpAmount != null ? cpAmount : cur.CpAmount,
    );

    const approveClause = b.Status === "Approved"
      ? ", ApprovedBy = @actor, ApprovedAt = SYSDATETIME()"
      : b.Status === "Paid"
        ? ", PaidAt = SYSDATETIME()"
        : "";

    await pool.request()
      .input("id",    sql.Int,            id)
      .input("bv",    sql.Decimal(18,2),  bv)
      .input("spRate",sql.Decimal(5,2),   spRate)
      .input("spAmt", sql.Decimal(18,2),  spAmount)
      .input("tlRate",sql.Decimal(5,2),   tlRate)
      .input("tlAmt", sql.Decimal(18,2),  tlAmount)
      .input("cpRate",sql.Decimal(5,2),   cpRate)
      .input("cpAmt", sql.Decimal(18,2),  cpAmount)
      .input("status",sql.NVarChar(20),   b.Status || null)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("actor", sql.Int,            actor)
      .query(`
        UPDATE dbo.SaCommission SET
          BookingValue = ISNULL(@bv, BookingValue),
          SpRate       = ISNULL(@spRate, SpRate),
          SpAmount     = ISNULL(@spAmt, SpAmount),
          TlRate       = ISNULL(@tlRate, TlRate),
          TlAmount     = ISNULL(@tlAmt, TlAmount),
          CpRate       = ISNULL(@cpRate, CpRate),
          CpAmount     = ISNULL(@cpAmt, CpAmount),
          Status       = ISNULL(@status, Status),
          Notes        = ISNULL(@notes, Notes),
          UpdatedBy    = @actor, UpdatedAt = SYSDATETIME()
          ${approveClause}
        WHERE Id = @id
      `);

    // "PAID -> REAL DISBURSEMENT" — a commission being marked Paid is real
    // cash leaving the company; post it to GL instead of leaving it as a
    // dead-end status flag. Never blocks the status update if GL posting
    // fails — same try/catch + recordGLPosting pattern used across CRM.
    if (b.Status === "Paid") {
      const actorEmail = req.user?.name || req.user?.email || "system";
      try {
        const outcome = await postSaCommissionToGL(pool, id, actorEmail);
        await recordGLPosting("sa-commission", id, outcome, actorEmail);
      } catch (glErr) {
        console.error("[sa-commissions] GL posting failed:", glErr.message);
        await recordGLPosting("sa-commission", id, { failed: true, reason: glErr.message }, actorEmail);
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[sa-commissions] PUT error:", e.message);
    res.status(e.statusCode || 500).json({ error: e.message, conflict: e.conflict });
  }
});

module.exports = router;
