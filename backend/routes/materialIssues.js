const express = require("express");
const router = express.Router();
const sql = require("mssql");
const authenticateToken = require("../middleware/auth");

// Get item options
router.get("/item-options", authenticateToken, async (req, res) => {
  try {
    const result = await sql.query(`
      SELECT
        M_Id,
        M_Name,
        M_Group
      FROM Item_Master_Group
      WHERE M_IdentityCode = 1
      ORDER BY M_Name
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// Get all material issues
router.get("/", authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const request = new sql.Request();

    let whereClause = "";
    if (search) {
      whereClause = `
        WHERE mi.IssueNo LIKE @search
        OR c.label LIKE @search
        OR p.label LIKE @search
        OR i.M_Name LIKE @search
      `;
      request.input("search", sql.VarChar, `%${search}%`);
    }

    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);

    const countQuery = `
      SELECT COUNT(*) as total
      FROM MaterialIssues mi
      LEFT JOIN Enterprise c ON mi.CompanyId = c.id
      LEFT JOIN Enterprise p ON mi.ProjectId = p.id
      LEFT JOIN Item_Master_Group i ON mi.ItemId = i.M_Id
      ${whereClause}
    `;

    const query = `
      SELECT
        mi.*,
        c.label as CompanyName,
        p.label as ProjectName,
        i.M_Name as ItemName
      FROM MaterialIssues mi
      LEFT JOIN Enterprise c ON mi.CompanyId = c.id
      LEFT JOIN Enterprise p ON mi.ProjectId = p.id
      LEFT JOIN Item_Master_Group i ON mi.ItemId = i.M_Id
      ${whereClause}
      ORDER BY mi.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    const countResult = await request.query(countQuery);
    const total = countResult.recordset[0].total;

    const result = await request.query(query);

    res.json({
      data: result.recordset,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching material issues:", error);
    res.status(500).json({ error: "Failed to fetch material issues" });
  }
});

// Get issue by id
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const request = new sql.Request();
    request.input("id", sql.Int, parseInt(req.params.id));

    const result = await request.query(`
      SELECT mi.*, c.label as CompanyName, p.label as ProjectName, i.M_Name as ItemName
      FROM MaterialIssues mi
      LEFT JOIN Enterprise c ON mi.CompanyId = c.id
      LEFT JOIN Enterprise p ON mi.ProjectId = p.id
      LEFT JOIN Item_Master_Group i ON mi.ItemId = i.M_Id
      WHERE mi.IssueId = @id
    `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Issue not found" });
    res.json(result.recordset[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch issue" });
  }
});

// Create new issue
router.post("/", authenticateToken, async (req, res) => {
  try {
    const {
      CompanyId,
      ProjectId,
      Date,
      ItemId,
      UOMId,
      Quantity,
      Remarks,
      Reason,
    } = req.body;
    const userId = req.user?.id || null;

    // Generate simple IssueNo (e.g. MI-YYYYMMDD-XXXX)
    const issueNo = `MI-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 10000)}`;

    const request = new sql.Request();
    request.input("IssueNo", sql.VarChar, issueNo);
    request.input("CompanyId", sql.Int, CompanyId);
    request.input("ProjectId", sql.Int, ProjectId);
    request.input("Date", sql.Date, Date);
    request.input("ItemId", sql.VarChar, ItemId);
    request.input("UOMId", sql.VarChar, UOMId);
    request.input("Quantity", sql.Decimal(18, 2), Quantity);
    request.input("Remarks", sql.NVarChar, Remarks || null);
    request.input("Reason", sql.NVarChar, Reason);
    request.input("CreatedBy", sql.Int, userId);

    const result = await request.query(`
      INSERT INTO MaterialIssues (IssueNo, CompanyId, ProjectId, Date, ItemId, UOMId, Quantity, Remarks, Reason, CreatedBy)
      OUTPUT INSERTED.*
      VALUES (@IssueNo, @CompanyId, @ProjectId, @Date, @ItemId, @UOMId, @Quantity, @Remarks, @Reason, @CreatedBy)
    `);

    res.status(201).json(result.recordset[0]);
  } catch (error) {
    console.error("Error creating material issue:", error);
    res.status(500).json({ error: "Failed to create material issue" });
  }
});

// Update issue
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      CompanyId,
      ProjectId,
      Date,
      ItemId,
      UOMId,
      Quantity,
      Remarks,
      Reason,
    } = req.body;

    const request = new sql.Request();
    request.input("Id", sql.Int, id);
    request.input("CompanyId", sql.Int, CompanyId);
    request.input("ProjectId", sql.Int, ProjectId);
    request.input("Date", sql.Date, Date);
    request.input("ItemId", sql.VarChar, ItemId);
    request.input("UOMId", sql.VarChar, UOMId);
    request.input("Quantity", sql.Decimal(18, 2), Quantity);
    request.input("Remarks", sql.NVarChar, Remarks || null);
    request.input("Reason", sql.NVarChar, Reason);

    await request.query(`
      UPDATE MaterialIssues
      SET CompanyId=@CompanyId, ProjectId=@ProjectId, Date=@Date, ItemId=@ItemId, UOMId=@UOMId, Quantity=@Quantity, Remarks=@Remarks, Reason=@Reason, UpdatedAt=GETDATE()
      WHERE IssueId=@Id
    `);

    res.json({ message: "Issue updated successfully" });
  } catch (error) {
    console.error("Error updating material issue:", error);
    res.status(500).json({ error: "Failed to update material issue" });
  }
});

// Delete issue
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const request = new sql.Request();
    request.input("id", sql.Int, parseInt(req.params.id));
    await request.query(`DELETE FROM MaterialIssues WHERE IssueId = @id`);
    res.json({ message: "Issue deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete material issue" });
  }
});

module.exports = router;
