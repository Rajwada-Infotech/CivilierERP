const express = require("express");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { checkPermissionForMethod } = require("../middleware/routePermission");
router.use(authMiddleware);
router.use(apiRateLimit);
router.use(checkPermissionForMethod("Followup", "Log"));
const { getPool, sql } = require("../db");

const LOG_TYPES = ["email", "call", "sms", "note", "payment"];

function mapLog(row) {
  return {
    id: String(row.Id),
    date: row.LogDate ? new Date(row.LogDate).toISOString().split("T")[0] : "",
    type: row.LogType,
    module: row.Module || "",
    customer: row.Customer,
    amount: row.Amount == null ? null : Number(row.Amount),
    refId: row.RefId == null ? null : Number(row.RefId),
    notes: row.Notes || "",
    user: row.CreatedBy || "",
    createdAt: row.CreatedAt ? new Date(row.CreatedAt).toISOString() : "",
  };
}

router.get("/", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const type = typeof req.query.type === "string" ? req.query.type.trim().toLowerCase() : "";
    const module = typeof req.query.module === "string" ? req.query.module.trim().toLowerCase() : "";
    const refId =
      req.query.refId == null || req.query.refId === ""
        ? null
        : Number(req.query.refId);

    if (refId !== null && Number.isNaN(refId)) {
      return res.status(400).json({ error: "refId must be numeric" });
    }

    const filters = ["IsDeleted = 0"];
    const request = getPool().request();

    if (search) {
      filters.push("(Customer LIKE @search OR Notes LIKE @search)");
      request.input("search", sql.NVarChar(255), `%${search}%`);
    }

    if (type) {
      filters.push("LogType = @type");
      request.input("type", sql.NVarChar(20), type);
    }

    if (module) {
      filters.push("LOWER(ISNULL(Module, '')) = @module");
      request.input("module", sql.NVarChar(100), module);
    }

    if (refId !== null) {
      filters.push("RefId = @refId");
      request.input("refId", sql.Int, refId);
    }

    const result = await request.query(`
      SELECT
        Id,
        LogDate,
        LogType,
        Module,
        Customer,
        Amount,
        RefId,
        Notes,
        CreatedBy,
        CreatedAt
      FROM dbo.FollowupLog
      WHERE ${filters.join(" AND ")}
      ORDER BY CreatedAt DESC, Id DESC
    `);

    res.json(result.recordset.map(mapLog));
  } catch (err) {
    console.error("FOLLOWUP LOG GET ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch follow-up log" });
  }
});

router.post("/", async (req, res) => {
  const {
    date,
    type = "note",
    module,
    customer,
    amount,
    refId,
    notes,
  } = req.body || {};

  const normalizedType = String(type).trim().toLowerCase();
  const createdBy = req.user?.name || req.user?.email || null;

  if (!customer || !String(customer).trim()) {
    return res.status(400).json({ error: "customer is required" });
  }

  if (!LOG_TYPES.includes(normalizedType)) {
    return res
      .status(400)
      .json({ error: `type must be one of: ${LOG_TYPES.join(", ")}` });
  }

  const normalizedModule =
    module == null ? null : String(module).trim().toLowerCase() || null;

  const normalizedAmount =
    amount == null || amount === "" ? null : Number(amount);
  const normalizedRefId =
    refId == null || refId === "" ? null : Number(refId);

  if (normalizedAmount !== null && Number.isNaN(normalizedAmount)) {
    return res.status(400).json({ error: "amount must be numeric" });
  }

  if (normalizedRefId !== null && Number.isNaN(normalizedRefId)) {
    return res.status(400).json({ error: "refId must be numeric" });
  }

  try {
    const result = await getPool()
      .request()
      .input("LogDate", sql.Date, date ? new Date(date) : null)
      .input("LogType", sql.NVarChar(20), normalizedType)
      .input("Module", sql.NVarChar(100), normalizedModule)
      .input("Customer", sql.NVarChar(255), String(customer).trim())
      .input("Amount", sql.Decimal(18, 2), normalizedAmount)
      .input("RefId", sql.Int, normalizedRefId)
      .input("Notes", sql.NVarChar(sql.MAX), notes ? String(notes).trim() : null)
      .input("CreatedBy", sql.NVarChar(100), createdBy)
      .query(`
        INSERT INTO dbo.FollowupLog
          (LogDate, LogType, Module, Customer, Amount, RefId, Notes, CreatedBy)
        OUTPUT
          INSERTED.Id,
          INSERTED.LogDate,
          INSERTED.LogType,
          INSERTED.Module,
          INSERTED.Customer,
          INSERTED.Amount,
          INSERTED.RefId,
          INSERTED.Notes,
          INSERTED.CreatedBy,
          INSERTED.CreatedAt
        VALUES
          (ISNULL(@LogDate, CAST(SYSDATETIME() AS DATE)), @LogType, @Module, @Customer, @Amount, @RefId, @Notes, @CreatedBy)
      `);

    res.status(201).json(mapLog(result.recordset[0]));
  } catch (err) {
    console.error("FOLLOWUP LOG CREATE ERROR:", err.message);
    res.status(500).json({ error: "Failed to create follow-up log entry" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  try {
    const updatedBy = req.user?.name || req.user?.email || null;
    const result = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), updatedBy)
      .query(`
        UPDATE dbo.FollowupLog
        SET IsDeleted = 1,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    if (!result.rowsAffected[0]) {
      return res.status(404).json({ error: "Log entry not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("FOLLOWUP LOG DELETE ERROR:", err.message);
    res.status(500).json({ error: "Failed to delete follow-up log entry" });
  }
});

module.exports = router;




