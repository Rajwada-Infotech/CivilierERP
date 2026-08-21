const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { ensureBrokerForChannelPartner } = require("../services/channelPartnerBrokerBridge");

router.use(authMiddleware);
router.use(apiRateLimit);

// GET / — all active channel partners
router.get("/", requirePageRight("sa-channel-partners", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        cp.Id, cp.PartnerCode, cp.Name, cp.Mobile, cp.Email,
        cp.FirmName, cp.Region, cp.CommissionRate, cp.CrmBrokerLHeadId,
        br.LHeadName AS CrmBrokerName,
        cp.Notes, cp.IsActive,
        cp.CreatedAt, cp.UpdatedAt,
        COUNT(l.Id) AS TotalLeads,
        SUM(CASE WHEN l.Status = 'Booked' THEN 1 ELSE 0 END) AS TotalBookings
      FROM dbo.SaChannelPartner cp
      LEFT JOIN dbo.AccountHeadMaster br ON br.LHeadId = cp.CrmBrokerLHeadId
      LEFT JOIN dbo.SaLead l ON l.ChannelPartnerId = cp.Id AND l.IsActive = 1
      WHERE cp.IsActive = 1
      GROUP BY cp.Id, cp.PartnerCode, cp.Name, cp.Mobile, cp.Email,
               cp.FirmName, cp.Region, cp.CommissionRate, cp.CrmBrokerLHeadId, br.LHeadName,
               cp.Notes, cp.IsActive,
               cp.CreatedAt, cp.UpdatedAt
      ORDER BY cp.Name
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-channel-partners] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — single partner with their leads
router.get("/:id", requirePageRight("sa-channel-partners", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [cpResult, leadsResult] = await Promise.all([
      pool.request().input("id", sql.Int, id)
        .query("SELECT * FROM dbo.SaChannelPartner WHERE Id = @id AND IsActive = 1"),
      pool.request().input("id", sql.Int, id).query(`
        SELECT l.Id, l.LeadUid, l.CustomerName, l.Mobile, l.Status,
               l.Classification, l.CreatedAt
        FROM dbo.SaLead l
        WHERE l.ChannelPartnerId = @id AND l.IsActive = 1
        ORDER BY l.CreatedAt DESC
      `),
    ]);
    if (!cpResult.recordset[0]) return res.status(404).json({ error: "Partner not found" });
    res.json({ partner: cpResult.recordset[0], leads: leadsResult.recordset });
  } catch (e) {
    console.error("[sa-channel-partners] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create partner
router.post("/", requirePageRight("sa-channel-partners", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;

    // System-assigned unique partner code if not supplied
    const code = b.PartnerCode?.trim() || await getNextDocNumber(pool, "CP", "CP");

    const inserted = await pool.request()
      .input("code",  sql.NVarChar(20),  code)
      .input("name",  sql.NVarChar(200), b.Name || null)
      .input("mob",   sql.NVarChar(20),  b.Mobile || null)
      .input("em",    sql.NVarChar(200), b.Email || null)
      .input("firm",  sql.NVarChar(200), b.FirmName || null)
      .input("reg",   sql.NVarChar(200), b.Region || null)
      .input("rate",  sql.Decimal(5, 2), b.CommissionRate != null ? parseFloat(b.CommissionRate) : null)
      .input("bank",  sql.NVarChar(sql.MAX), b.BankDetails || null)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.SaChannelPartner
          (PartnerCode, Name, Mobile, Email, FirmName, Region, CommissionRate, BankDetails, Notes, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@code, @name, @mob, @em, @firm, @reg, @rate, @bank, @notes, 1, @cb, SYSDATETIME())
      `);
    const bridge = await ensureBrokerForChannelPartner(pool, inserted.recordset[0].Id, actorId(req));
    res.status(201).json({ success: true, brokerId: bridge?.brokerId || null });
  } catch (e) {
    if (e.message?.includes("UQ_SaChannelPartner_Code"))
      return res.status(409).json({ error: "Partner code already exists" });
    console.error("[sa-channel-partners] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update partner
router.put("/:id", requirePageRight("sa-channel-partners", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    await pool.request()
      .input("id",   sql.Int,           id)
      .input("name", sql.NVarChar(200), b.Name || null)
      .input("mob",  sql.NVarChar(20),  b.Mobile || null)
      .input("em",   sql.NVarChar(200), b.Email || null)
      .input("firm", sql.NVarChar(200), b.FirmName || null)
      .input("reg",  sql.NVarChar(200), b.Region || null)
      .input("rate", sql.Decimal(5, 2), b.CommissionRate != null ? parseFloat(b.CommissionRate) : null)
      .input("bank", sql.NVarChar(sql.MAX), b.BankDetails || null)
      .input("notes",sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.SaChannelPartner SET
          Name = @name, Mobile = @mob, Email = @em, FirmName = @firm, Region = @reg,
          CommissionRate = @rate, BankDetails = @bank, Notes = @notes,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND IsActive = 1
      `);
    const bridge = await ensureBrokerForChannelPartner(pool, id, actorId(req));
    res.json({ success: true, brokerId: bridge?.brokerId || null });
  } catch (e) {
    console.error("[sa-channel-partners] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — soft delete
router.delete("/:id", requirePageRight("sa-channel-partners", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, parseInt(req.params.id))
      .input("ub", sql.Int, actorId(req))
      .query("UPDATE dbo.SaChannelPartner SET IsActive = 0, UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-channel-partners] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
