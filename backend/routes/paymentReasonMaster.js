const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

// GET /options — active reasons for dropdowns
router.get("/options", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ReasonId AS id, ReasonName AS name, ReasonDesc AS description
      FROM dbo.PaymentReasonMaster
      WHERE IsActive = 1
      ORDER BY ReasonName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / — full list for management UI
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ReasonId AS id, ReasonName AS name, ReasonDesc AS description,
             IsActive AS isActive, CreatedBy AS createdBy, CreatedAt AS createdAt,
             UpdatedBy AS updatedBy, UpdatedAt AS updatedAt
      FROM dbo.PaymentReasonMaster
      ORDER BY ReasonName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — create
router.post("/", authMiddleware, requirePageRight("payment-reason-master", "create"), async (req, res) => {
  const { name, description, isActive = true } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  const rName = cleanStr(name, 200);
  if (!rName) return res.status(400).json({ error: "Reason Name is required" });

  try {
    const pool = await getPool();
    const dup = await pool.request()
      .input("name", sql.NVarChar(200), rName)
      .query(`SELECT ReasonId FROM dbo.PaymentReasonMaster WHERE ReasonName = @name`);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: "A reason with this name already exists" });

    const result = await pool.request()
      .input("name",      sql.NVarChar(200),  rName)
      .input("desc",      sql.NVarChar(sql.MAX), cleanStr(description, 2000) || null)
      .input("isActive",  sql.Bit,            isActive ? 1 : 0)
      .input("createdBy", sql.NVarChar(200),  actor)
      .query(`
        INSERT INTO dbo.PaymentReasonMaster (ReasonName, ReasonDesc, IsActive, CreatedBy)
        OUTPUT INSERTED.ReasonId AS id
        VALUES (@name, @desc, @isActive, @createdBy)
      `);
    res.status(201).json({ success: true, id: result.recordset[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update
router.put("/:id", authMiddleware, requirePageRight("payment-reason-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { name, description, isActive } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  const rName = cleanStr(name, 200);
  if (!rName) return res.status(400).json({ error: "Reason Name is required" });

  try {
    const pool = await getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query(`SELECT ReasonId FROM dbo.PaymentReasonMaster WHERE ReasonId = @id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Reason not found" });

    const dup = await pool.request()
      .input("name", sql.NVarChar(200), rName)
      .input("id",   sql.Int,           id)
      .query(`SELECT ReasonId FROM dbo.PaymentReasonMaster WHERE ReasonName = @name AND ReasonId != @id`);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: "Another reason with this name already exists" });

    await pool.request()
      .input("id",        sql.Int,            id)
      .input("name",      sql.NVarChar(200),  rName)
      .input("desc",      sql.NVarChar(sql.MAX), cleanStr(description, 2000) || null)
      .input("isActive",  sql.Bit,            isActive !== undefined ? (isActive ? 1 : 0) : 1)
      .input("updatedBy", sql.NVarChar(200),  actor)
      .query(`
        UPDATE dbo.PaymentReasonMaster SET
          ReasonName = @name, ReasonDesc = @desc, IsActive = @isActive,
          UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
        WHERE ReasonId = @id
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — soft delete (deactivate)
router.delete("/:id", authMiddleware, requirePageRight("payment-reason-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query(`SELECT ReasonId FROM dbo.PaymentReasonMaster WHERE ReasonId = @id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Reason not found" });

    await pool.request()
      .input("id",        sql.Int,           id)
      .input("updatedBy", sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.PaymentReasonMaster SET IsActive = 0, UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
        WHERE ReasonId = @id
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id/permanent — real removal from the database. dbo.NewPayment
// links to a reason by NAME (PPaymentName), not a FK, so a hard delete can
// never leave a broken reference — but it can silently orphan a name that's
// still showing up in historical payments, so we block it and point the
// caller at the ordinary Deactivate action instead.
router.delete("/:id/permanent", authMiddleware, requirePageRight("payment-reason-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = await getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query(`SELECT ReasonId, ReasonName FROM dbo.PaymentReasonMaster WHERE ReasonId = @id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Reason not found" });
    const { ReasonName } = existing.recordset[0];

    const inUse = await pool.request()
      .input("name", sql.NVarChar(200), ReasonName)
      .query(`SELECT TOP 1 PPaymentID FROM dbo.NewPayment WHERE PPaymentName = @name`);
    if (inUse.recordset.length > 0) {
      return res.status(409).json({
        error: `"${ReasonName}" is used by existing payments and cannot be permanently deleted. Deactivate it instead.`,
      });
    }

    await pool.request().input("id", sql.Int, id)
      .query(`DELETE FROM dbo.PaymentReasonMaster WHERE ReasonId = @id`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /report — payments grouped/filterable by Payment Reason. Reasons link
// to dbo.NewPayment by name (PPaymentName), not a FK, so the join is a text
// match against the live reason list (dropped reasons still surface if a
// payment references their old name).
router.get("/report", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const reason   = req.query.reason   ? String(req.query.reason).trim()   : "";
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : "";
    const dateTo   = req.query.dateTo   ? String(req.query.dateTo).trim()   : "";

    const conditions = [];
    const request = pool.request();
    if (reason) {
      conditions.push("np.PPaymentName = @reason");
      request.input("reason", sql.NVarChar(200), reason);
    }
    if (dateFrom) {
      conditions.push("np.PDate >= @dateFrom");
      request.input("dateFrom", sql.Date, dateFrom);
    }
    if (dateTo) {
      conditions.push("np.PDate <= @dateTo");
      request.input("dateTo", sql.Date, dateTo);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        np.PPaymentID   AS id,
        np.PPaymentName AS ReasonName,
        np.PCompany     AS Company,
        np.PProject     AS Project,
        np.PAmount      AS Amount,
        np.PMode        AS Mode,
        np.PDate        AS Date,
        np.DocNo        AS DocNo
      FROM dbo.NewPayment np
      ${whereClause}
      ORDER BY np.PPaymentName ASC, np.PDate DESC
    `);

    const summary = new Map();
    for (const row of result.recordset) {
      const key = row.ReasonName || "(No reason)";
      const s = summary.get(key) ?? { ReasonName: key, count: 0, totalAmount: 0 };
      s.count += 1;
      s.totalAmount += Number(row.Amount) || 0;
      summary.set(key, s);
    }

    res.json({
      data: result.recordset,
      summary: Array.from(summary.values()).sort((a, b) => a.ReasonName.localeCompare(b.ReasonName)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
