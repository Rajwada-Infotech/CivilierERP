/**
 * backend/routes/materialIssues.js
 *
 * Material / Stock Issue routes.
 *
 * Document numbering:
 *   Normal issue  →  ISS-YYYY-NNNNN      (e.g. ISS-2026-00012)
 *   Under ExB     →  ExB-ISS-YYYY-NNNNN  (e.g. ExB-ISS-2026-00005)
 *
 * The prefix is determined by:
 *   - If req.body.rootExBDocNo is present → use "ExB-ISS"
 *   - Otherwise → use "ISS"
 */

"use strict";

const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { authenticateToken } = require("../middleware/auth");
const {
  lockNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
  previewNextDocNumber,
} = require("../utils/docNumberLock");

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveIssueDocTypeId(pool, rootExBDocNo) {
  const prefix = rootExBDocNo ? "ExB-ISS" : "ISS";
  return resolveDocTypeId(pool, sql, prefix);
}

// ── GET /item-options ─────────────────────────────────────────────────────────
router.get("/item-options", authenticateToken, async (req, res) => {
  try {
    const pool = await sql.connect();
    const result = await pool.request().query(`
      SELECT M_Id, M_Name, M_Group
      FROM   Item_Master_Group
      WHERE  M_IdentityCode = 1
      ORDER  BY M_Name
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// ── GET /next-number — preview (no lock) ──────────────────────────────────────
// ?exb=true  →  preview ExB-ISS number
router.get("/next-number", authenticateToken, async (req, res) => {
  try {
    const pool = await sql.connect();
    const prefix = req.query.exb === "true" ? "ExB-ISS" : "ISS";
    const docTypeId = await resolveDocTypeId(pool, sql, prefix);
    const preview = await previewNextDocNumber(pool, sql, docTypeId);
    res.json(preview);
  } catch (error) {
    res.status(500).json({ error: "Failed to preview next ISS number" });
  }
});

// ── GET / — paginated list ────────────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = await sql.connect();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const request = pool.request();
    let whereClause = "";

    if (search) {
      whereClause = `
        WHERE mi.DocNo LIKE @search
           OR mi.IssueNo LIKE @search
           OR c.label LIKE @search
           OR p.label LIKE @search
           OR i.M_Name LIKE @search
      `;
      request.input("search", sql.VarChar, `%${search}%`);
    }

    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);

    const countResult = await request.query(`
      SELECT COUNT(*) AS total
      FROM   MaterialIssues mi
      LEFT JOIN Enterprise c ON mi.CompanyId = c.id
      LEFT JOIN Enterprise p ON mi.ProjectId = p.id
      LEFT JOIN Item_Master_Group i ON mi.ItemId = i.M_Id
      ${whereClause}
    `);

    const result = await request.query(`
      SELECT
        mi.*,
        c.label  AS CompanyName,
        p.label  AS ProjectName,
        i.M_Name AS ItemName
      FROM MaterialIssues mi
      LEFT JOIN Enterprise c ON mi.CompanyId = c.id
      LEFT JOIN Enterprise p ON mi.ProjectId = p.id
      LEFT JOIN Item_Master_Group i ON mi.ItemId = i.M_Id
      ${whereClause}
      ORDER BY mi.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      data: result.recordset,
      total: countResult.recordset[0].total,
      page,
      limit,
      totalPages: Math.ceil(countResult.recordset[0].total / limit),
    });
  } catch (error) {
    console.error("Error fetching material issues:", error);
    res.status(500).json({ error: "Failed to fetch material issues" });
  }
});

// ── GET /:id — single record ──────────────────────────────────────────────────
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = await sql.connect();
    const request = pool.request();
    request.input("id", sql.Int, parseInt(req.params.id));

    const result = await request.query(`
      SELECT mi.*, c.label AS CompanyName, p.label AS ProjectName, i.M_Name AS ItemName
      FROM   MaterialIssues mi
      LEFT JOIN Enterprise c ON mi.CompanyId = c.id
      LEFT JOIN Enterprise p ON mi.ProjectId = p.id
      LEFT JOIN Item_Master_Group i ON mi.ItemId = i.M_Id
      WHERE  mi.IssueId = @id
    `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Issue not found" });

    res.json(result.recordset[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch issue" });
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post("/", authenticateToken, async (req, res) => {
  try {
    const pool = await sql.connect();
    const {
      CompanyId,
      ProjectId,
      Date: IssueDate,
      ItemId,
      UOMId,
      Quantity,
      Remarks,
      Reason,
      ParentDocNo = null,
      RootExBDocNo = null,
    } = req.body;

    const userId = req.user?.id || null;
    const issuedBy = req.user?.email || null;

    // 1. Resolve doc type: ISS or ExB-ISS
    const docTypeId = await resolveIssueDocTypeId(pool, RootExBDocNo);

    // 2. Lock next number
    const docNo = await lockNextDocNumber(pool, sql, {
      docTypeId,
      tableName: "MaterialIssues",
      docNoColumn: "DocNo",
      issuedBy,
      parentDocNo: ParentDocNo,
      rootExBDocNo: RootExBDocNo,
    });

    // 3. Parse year + serial from docNo (PREFIX-YYYY-NNNNN)
    const parts = docNo.split("-");
    const docYear = parseInt(parts[parts.length - 2], 10) || null;
    const docSerial = parseInt(parts[parts.length - 1], 10) || null;

    // 4. Insert record
    const insertReq = pool.request();
    insertReq.input("IssueNo", sql.VarChar(100), docNo);
    insertReq.input("DocNo", sql.NVarChar(100), docNo);
    insertReq.input("DocTypeId", sql.Int, docTypeId);
    insertReq.input("DocYear", sql.SmallInt, docYear);
    insertReq.input("DocSerial", sql.Int, docSerial);
    insertReq.input("ParentDocNo", sql.NVarChar(100), ParentDocNo);
    insertReq.input("RootExBDocNo", sql.NVarChar(100), RootExBDocNo);
    insertReq.input("CompanyId", sql.Int, CompanyId);
    insertReq.input("ProjectId", sql.Int, ProjectId);
    insertReq.input("Date", sql.Date, IssueDate);
    insertReq.input("ItemId", sql.VarChar(100), ItemId);
    insertReq.input("UOMId", sql.VarChar(50), UOMId);
    insertReq.input("Quantity", sql.Decimal(18, 2), Quantity);
    insertReq.input("Remarks", sql.NVarChar(sql.MAX), Remarks || null);
    insertReq.input("Reason", sql.NVarChar(sql.MAX), Reason);
    insertReq.input("CreatedBy", sql.Int, userId);

    const result = await insertReq.query(`
      INSERT INTO dbo.MaterialIssues
        (IssueNo, DocNo, DocTypeId, DocYear, DocSerial,
         ParentDocNo, RootExBDocNo,
         CompanyId, ProjectId, Date, ItemId, UOMId,
         Quantity, Remarks, Reason, CreatedBy)
      OUTPUT INSERTED.*
      VALUES
        (@IssueNo, @DocNo, @DocTypeId, @DocYear, @DocSerial,
         @ParentDocNo, @RootExBDocNo,
         @CompanyId, @ProjectId, @Date, @ItemId, @UOMId,
         @Quantity, @Remarks, @Reason, @CreatedBy)
    `);

    const newRecord = result.recordset[0];

    // 5. Back-patch RecordId into DocNumberSequence
    await backPatchRecordId(
      pool,
      sql,
      docNo,
      "MaterialIssues",
      newRecord.IssueId,
    );

    res.status(201).json(newRecord);
  } catch (error) {
    console.error("Error creating material issue:", error);
    res.status(500).json({ error: "Failed to create material issue" });
  }
});

// ── PUT /:id — update (DocNo is immutable after creation) ────────────────────
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = await sql.connect();
    const id = parseInt(req.params.id);
    const {
      CompanyId,
      ProjectId,
      Date: IssueDate,
      ItemId,
      UOMId,
      Quantity,
      Remarks,
      Reason,
    } = req.body;

    const request = pool.request();
    request.input("Id", sql.Int, id);
    request.input("CompanyId", sql.Int, CompanyId);
    request.input("ProjectId", sql.Int, ProjectId);
    request.input("Date", sql.Date, IssueDate);
    request.input("ItemId", sql.VarChar(100), ItemId);
    request.input("UOMId", sql.VarChar(50), UOMId);
    request.input("Quantity", sql.Decimal(18, 2), Quantity);
    request.input("Remarks", sql.NVarChar(sql.MAX), Remarks || null);
    request.input("Reason", sql.NVarChar(sql.MAX), Reason);

    await request.query(`
      UPDATE dbo.MaterialIssues
      SET    CompanyId = @CompanyId, ProjectId = @ProjectId, Date = @Date,
             ItemId = @ItemId, UOMId = @UOMId, Quantity = @Quantity,
             Remarks = @Remarks, Reason = @Reason, UpdatedAt = GETDATE()
      WHERE  IssueId = @Id
    `);

    res.json({ message: "Issue updated successfully" });
  } catch (error) {
    console.error("Error updating material issue:", error);
    res.status(500).json({ error: "Failed to update material issue" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = await sql.connect();
    const request = pool.request();
    request.input("id", sql.Int, parseInt(req.params.id));
    await request.query("DELETE FROM dbo.MaterialIssues WHERE IssueId = @id");
    res.json({ message: "Issue deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete issue" });
  }
});

module.exports = router;
