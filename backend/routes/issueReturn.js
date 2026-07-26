const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

// ── GET / — list all issue returns ───────────────────────────────────────────
router.get("/", requirePageRight("material-issue-return", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { companyId, projectId, status } = req.query;
    const conditions = ["1=1"];
    const request = pool.request();
    if (companyId) { conditions.push("ir.CompanyId = @CompanyId"); request.input("CompanyId", sql.Int, parseInt(companyId)); }
    if (projectId) { conditions.push("ir.ProjectId = @ProjectId"); request.input("ProjectId", sql.Int, parseInt(projectId)); }
    if (status)    { conditions.push("ir.Status = @Status"); request.input("Status", sql.NVarChar(20), status); }

    const result = await request.query(`
      SELECT ir.ReturnId, ir.DocNo, ir.ReturnDate, ir.Status,
             ir.IssueId, mi.DocNo AS IssueDocNo,
             ir.Reason, ir.Remarks, ir.CreatedAt,
             co.name AS CompanyName, pr.name AS ProjectName,
             u.name AS CreatedByName
      FROM dbo.MaterialIssueReturn ir
      LEFT JOIN dbo.MaterialIssues mi ON mi.IssueId = ir.IssueId
      LEFT JOIN dbo.enterprise co ON co.id = ir.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = ir.ProjectId
      LEFT JOIN dbo.users u ON u.id = ir.CreatedBy
      WHERE ${conditions.join(" AND ")}
      ORDER BY ir.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[issueReturn] GET /:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /issues — list approved issues available for return ───────────────────
router.get("/issues", requirePageRight("material-issue-return", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { companyId, projectId } = req.query;
    const conditions = ["mi.Status = 'Approved'"];
    const request = pool.request();
    if (companyId) { conditions.push("mi.CompanyId = @CompanyId"); request.input("CompanyId", sql.Int, parseInt(companyId)); }
    if (projectId) { conditions.push("mi.ProjectId = @ProjectId"); request.input("ProjectId", sql.Int, parseInt(projectId)); }

    const result = await request.query(`
      SELECT mi.IssueId, mi.DocNo, mi.Date AS IssueDate, mi.Reason,
             co.name AS CompanyName, pr.name AS ProjectName
      FROM dbo.MaterialIssues mi
      LEFT JOIN dbo.enterprise co ON co.id = mi.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = mi.ProjectId
      WHERE ${conditions.join(" AND ")}
      ORDER BY mi.Date DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[issueReturn] GET /issues:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /issues/:id/items — items of a specific issue ────────────────────────
router.get("/issues/:id/items", requirePageRight("material-issue-return", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await pool.request().input("IssueId", sql.Int, id).query(`
      SELECT
        mii.IssueItemId AS ItemId,
        mii.ItemId      AS M_Id,
        img.M_Name      AS ItemName,
        mii.Quantity,
        uom.Symbol      AS UOMSymbol
      FROM dbo.MaterialIssueItems mii
      LEFT JOIN dbo.Item_Master_Group img
        ON CONVERT(NVARCHAR(100), img.M_Id) = mii.ItemId
      LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = mii.UOMCode
      WHERE mii.IssueId = @IssueId
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[issueReturn] GET /issues/:id/items:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /:id — single return ──────────────────────────────────────────────────
router.get("/:id", requirePageRight("material-issue-return", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const [header, items] = await Promise.all([
      pool.request().input("ReturnId", sql.Int, id).query(`
        SELECT ir.*, mi.DocNo AS IssueDocNo,
               co.name AS CompanyName, pr.name AS ProjectName
        FROM dbo.MaterialIssueReturn ir
        LEFT JOIN dbo.MaterialIssues mi ON mi.IssueId = ir.IssueId
        LEFT JOIN dbo.enterprise co ON co.id = ir.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = ir.ProjectId
        WHERE ir.ReturnId = @ReturnId
      `),
      pool.request().input("ReturnId", sql.Int, id).query(`
        SELECT * FROM dbo.MaterialIssueReturnItems WHERE ReturnId = @ReturnId
      `),
    ]);
    if (!header.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json({ ...header.recordset[0], items: items.recordset });
  } catch (err) {
    console.error("[issueReturn] GET /:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST / — create a return ──────────────────────────────────────────────────
router.post("/", requirePageRight("material-issue-return", "create"), async (req, res) => {
  const { IssueId, ReturnDate, CompanyId, ProjectId, GodownId, Reason, Remarks, items } = req.body;
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "At least one item is required" });

  try {
    const pool = getPool();

    // Generate next doc number
    const lastResult = await pool.request().query(`
      SELECT TOP 1 DocNo FROM dbo.MaterialIssueReturn
      WHERE DocNo LIKE 'IRN-%'
      ORDER BY ReturnId DESC
    `);
    let nextNum = 1;
    if (lastResult.recordset.length) {
      const lastNo = lastResult.recordset[0].DocNo;
      const m = lastNo.match(/(\d+)$/);
      if (m) nextNum = parseInt(m[1], 10) + 1;
    }
    const docNo = `IRN-${String(nextNum).padStart(5, "0")}`;

    const tx = pool.transaction();
    await tx.begin();
    try {
      const headerResult = await tx.request()
        .input("DocNo", sql.NVarChar(50), docNo)
        .input("ReturnDate", sql.Date, ReturnDate)
        .input("IssueId", sql.Int, IssueId ? parseInt(IssueId) : null)
        .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId) : null)
        .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId) : null)
        .input("GodownId", sql.Int, GodownId ? parseInt(GodownId) : null)
        .input("Reason", sql.NVarChar(500), Reason || null)
        .input("Remarks", sql.NVarChar(1000), Remarks || null)
        .input("CreatedBy", sql.Int, req.user?.userId || null)
        .query(`
          INSERT INTO dbo.MaterialIssueReturn
            (DocNo, ReturnDate, IssueId, CompanyId, ProjectId, GodownId, Reason, Remarks, Status, CreatedBy, CreatedAt)
          OUTPUT INSERTED.ReturnId
          VALUES (@DocNo, @ReturnDate, @IssueId, @CompanyId, @ProjectId, @GodownId, @Reason, @Remarks, 'Draft', @CreatedBy, SYSDATETIME())
        `);

      const returnId = headerResult.recordset[0].ReturnId;

      const validItems = items.filter(i => {
        const qty = parseFloat(i.Quantity ?? i.quantity);
        return (i.M_Id || i.itemName || i.ItemName) && Number.isFinite(qty) && qty > 0;
      });
      if (validItems.length === 0) {
        await tx.rollback();
        return res.status(400).json({ error: "At least one item with a valid positive quantity is required" });
      }

      for (const item of validItems) {
        await tx.request()
          .input("ReturnId", sql.Int, returnId)
          .input("OrigIssueItemId", sql.Int, item.origIssueItemId || null)
          .input("M_Id", sql.NVarChar(100), String(item.M_Id || ""))
          .input("ItemName", sql.NVarChar(500), item.ItemName || item.itemName || "")
          .input("Quantity", sql.Decimal(18, 4), parseFloat(item.Quantity ?? item.quantity))
          .input("UOMSymbol", sql.NVarChar(30), item.UOMSymbol || item.uomSymbol || null)
          .query(`
            INSERT INTO dbo.MaterialIssueReturnItems (ReturnId, OrigIssueItemId, M_Id, ItemName, Quantity, UOMSymbol)
            VALUES (@ReturnId, @OrigIssueItemId, @M_Id, @ItemName, @Quantity, @UOMSymbol)
          `);
      }

      await tx.commit();
      res.status(201).json({ message: "Issue return created", id: returnId, docNo });
    } catch (innerErr) {
      await tx.rollback();
      throw innerErr;
    }
  } catch (err) {
    console.error("[issueReturn] POST /:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /:id — update a Draft return ─────────────────────────────────────────
router.put("/:id", requirePageRight("material-issue-return", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const { ReturnDate, IssueId, CompanyId, ProjectId, GodownId, Reason, Remarks, items } = req.body;
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "At least one item is required" });

  try {
    const pool = getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.MaterialIssueReturn WHERE ReturnId = @id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Not found" });
    if (existing.recordset[0].Status !== "Draft")
      return res.status(400).json({ error: "Only Draft returns can be edited" });

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request()
        .input("id", sql.Int, id)
        .input("ReturnDate", sql.Date, ReturnDate)
        .input("IssueId", sql.Int, IssueId ? parseInt(IssueId) : null)
        .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId) : null)
        .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId) : null)
        .input("GodownId", sql.Int, GodownId ? parseInt(GodownId) : null)
        .input("Reason", sql.NVarChar(500), Reason || null)
        .input("Remarks", sql.NVarChar(1000), Remarks || null)
        .query(`
          UPDATE dbo.MaterialIssueReturn SET
            ReturnDate=@ReturnDate, IssueId=@IssueId, CompanyId=@CompanyId,
            ProjectId=@ProjectId, GodownId=@GodownId, Reason=@Reason,
            Remarks=@Remarks, UpdatedAt=SYSDATETIME()
          WHERE ReturnId=@id
        `);

      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.MaterialIssueReturnItems WHERE ReturnId=@id");

      const validItems = items.filter(i => {
        const qty = parseFloat(i.Quantity ?? i.quantity);
        return (i.M_Id || i.itemName || i.ItemName) && Number.isFinite(qty) && qty > 0;
      });
      if (validItems.length === 0) {
        await tx.rollback();
        return res.status(400).json({ error: "At least one item with a valid positive quantity is required" });
      }

      for (const item of validItems) {
        await tx.request()
          .input("ReturnId", sql.Int, id)
          .input("OrigIssueItemId", sql.Int, item.origIssueItemId || null)
          .input("M_Id", sql.NVarChar(100), String(item.M_Id || ""))
          .input("ItemName", sql.NVarChar(500), item.ItemName || item.itemName || "")
          .input("Quantity", sql.Decimal(18, 4), parseFloat(item.Quantity ?? item.quantity))
          .input("UOMSymbol", sql.NVarChar(30), item.UOMSymbol || item.uomSymbol || null)
          .query(`
            INSERT INTO dbo.MaterialIssueReturnItems (ReturnId, OrigIssueItemId, M_Id, ItemName, Quantity, UOMSymbol)
            VALUES (@ReturnId, @OrigIssueItemId, @M_Id, @ItemName, @Quantity, @UOMSymbol)
          `);
      }

      await tx.commit();
      res.json({ message: "Issue return updated" });
    } catch (innerErr) {
      await tx.rollback();
      throw innerErr;
    }
  } catch (err) {
    console.error("[issueReturn] PUT /:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /:id/submit ───────────────────────────────────────────────────────────
router.put("/:id/submit", requirePageRight("material-issue-return", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.MaterialIssueReturn SET Status='Pending', UpdatedAt=SYSDATETIME()
      WHERE ReturnId=@id AND Status='Draft'
    `);
    res.json({ message: "Submitted for approval" });
  } catch (err) {
    console.error("[issueReturn] PUT /:id/submit:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /:id/approve ──────────────────────────────────────────────────────────
router.put("/:id/approve", requirePageRight("material-issue-return", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();

    // Fetch header + items before updating status
    const [headerRes, itemsRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`
        SELECT ReturnId, DocNo, GodownId, Status FROM dbo.MaterialIssueReturn WHERE ReturnId=@id
      `),
      pool.request().input("id", sql.Int, id).query(`
        SELECT M_Id, Quantity, UOMSymbol FROM dbo.MaterialIssueReturnItems WHERE ReturnId=@id
      `),
    ]);
    if (!headerRes.recordset.length) return res.status(404).json({ error: "Not found" });
    if (headerRes.recordset[0].Status !== "Pending")
      return res.status(400).json({ error: "Return is not in Pending status" });

    const { DocNo, GodownId } = headerRes.recordset[0];
    const returnItems = itemsRes.recordset;

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("id", sql.Int, id).query(`
        UPDATE dbo.MaterialIssueReturn SET Status='Approved', UpdatedAt=SYSDATETIME()
        WHERE ReturnId=@id
      `);

      // Credit stock back — one IN entry per item
      for (const item of returnItems) {
        const qty = Number(item.Quantity);
        if (!qty || qty <= 0) continue;
        await tx.request()
          .input("ItemID", sql.NVarChar(50), String(item.M_Id))
          .input("Qty", sql.Decimal(18, 4), qty)
          .input("UOM", sql.NVarChar(20), item.UOMSymbol || null)
          .input("Type", sql.NVarChar(10), "IN")
          .input("RefType", sql.NVarChar(20), "IRN")
          .input("RefID", sql.Int, id)
          .input("DocNo", sql.NVarChar(100), DocNo)
          .input("GodownID", sql.Int, GodownId || null)
          .query(`
            INSERT INTO dbo.StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, DocNo, GodownID, CreatedDate)
            VALUES (@ItemID, @Qty, @UOM, @Type, @RefType, @RefID, @DocNo, @GodownID, GETDATE())
          `);
      }

      await tx.commit();
      res.json({ message: "Approved" });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[issueReturn] PUT /:id/approve:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /:id/reject ───────────────────────────────────────────────────────────
router.put("/:id/reject", requirePageRight("material-issue-return", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.MaterialIssueReturn SET Status='Rejected', UpdatedAt=SYSDATETIME()
      WHERE ReturnId=@id AND Status='Pending'
    `);
    if (!result.rowsAffected[0]) return res.status(400).json({ error: "Return is not in Pending status" });
    res.json({ message: "Rejected" });
  } catch (err) {
    console.error("[issueReturn] PUT /:id/reject:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("material-issue-return", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.MaterialIssueReturn WHERE ReturnId=@id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Not found" });
    if (!["Draft", "Rejected"].includes(existing.recordset[0].Status))
      return res.status(400).json({ error: "Only Draft or Rejected returns can be deleted" });

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.MaterialIssueReturnItems WHERE ReturnId=@id");
      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.MaterialIssueReturn WHERE ReturnId=@id");
      await tx.commit();
      res.json({ message: "Deleted" });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[issueReturn] DELETE /:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
