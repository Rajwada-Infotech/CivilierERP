const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");
const router = express.Router();
const { getPool, sql } = require("../db");

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
};

// =============================================
//  META / DROPDOWN DATA  —  /api/work-orders/meta/*
//  MUST be defined BEFORE /:id routes so Express
//  does not parse "meta" as an integer id.
// =============================================

router.get("/meta/companies", cache("wo-meta-companies", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name FROM dbo.enterprise WHERE business_type = 'C' ORDER BY name
    `);
    res.json((result.recordset || []).map((r) => ({ id: r.id, name: r.name })));
  } catch (err) {
    console.error("[wo-meta-companies]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/meta/projects", cache("wo-meta-projects", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' ORDER BY name
    `);
    res.json((result.recordset || []).map((r) => ({ id: r.id, name: r.name })));
  } catch (err) {
    console.error("[wo-meta-projects]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/meta/contractors", cache("wo-meta-contractors", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT LHeadId AS id, LHeadName AS name
      FROM dbo.AccountHeadMaster WHERE LHeadType = 'C' ORDER BY LHeadName
    `);
    res.json((result.recordset || []).map((r) => ({ id: r.id, name: r.name })));
  } catch (err) {
    console.error("[wo-meta-contractors]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/meta/activity-groups", cache("wo-meta-act-groups", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, activity_name AS name FROM dbo.ActivityMaster
      WHERE activity_type = 0 ORDER BY activity_name
    `);
    res.json((result.recordset || []).map((r) => ({ id: r.id, name: r.name })));
  } catch (err) {
    console.error("[wo-meta-act-groups]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/meta/activities", cache("wo-meta-activities", 600), async (req, res) => {
  try {
    const pool = getPool();
    const groupId = req.query.groupId ? parseInt(req.query.groupId, 10) : null;
    let result;
    if (groupId && Number.isFinite(groupId)) {
      result = await pool.request()
        .input("BelongsTo", sql.NVarChar(200), String(groupId))
        .query(`
          SELECT id, activity_name AS name, belongsTo AS groupId
          FROM dbo.ActivityMaster
          WHERE activity_type = 1 AND belongsTo = @BelongsTo
          ORDER BY activity_name
        `);
    } else {
      result = await pool.request().query(`
        SELECT id, activity_name AS name, belongsTo AS groupId
        FROM dbo.ActivityMaster WHERE activity_type = 1 ORDER BY activity_name
      `);
    }
    res.json((result.recordset || []).map((r) => ({ id: r.id, name: r.name, groupId: r.groupId })));
  } catch (err) {
    console.error("[wo-meta-activities]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/meta/uoms", cache("wo-meta-uoms", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id AS id, UOMName AS name FROM dbo.UOMMaster ORDER BY UOMName
    `);
    res.json((result.recordset || []).map((r) => ({ id: r.id, name: r.name })));
  } catch (err) {
    console.error("[wo-meta-uoms]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/work-orders/meta/items
 * Returns all items from Item_Master_Group for the material name dropdown.
 * Response shape: [{ id: string (uniqueidentifier), name: string }]
 */
router.get("/meta/items", cache("wo-meta-items", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT CAST(M_Id AS NVARCHAR(36)) AS id,
             M_Name                     AS name
      FROM   dbo.Item_Master_Group
      ORDER  BY M_Name
    `);
    res.json((result.recordset || []).map((r) => ({ id: r.id, name: r.name })));
  } catch (err) {
    console.error("[wo-meta-items]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
//  WORK ORDER HEADER
// =============================================

router.get("/", cache("work-orders", 300), async (req, res) => {
  try {
    const pool = getPool();
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await pool.request().query(`
      SELECT COUNT(DISTINCT h.Id) AS total FROM dbo.WorkOrderHeader h
      LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
      LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
      LEFT JOIN dbo.WorkOrderActivities a  ON a.WorkOrderHeaderId = h.Id
    `);
    const total = parseInt(countResult.recordset[0].total);

    const result = await pool.request()
      .input("offset", sql.Int, offset)
      .input("limit",  sql.Int, limit)
      .query(`
        SELECT h.Id, h.DocumentNumber, h.DocumentDate, h.TotalAmount, h.Status,
          h.CreatedAt, h.UpdatedAt,
          ec.name AS CompanyName, h.CompanyId,
          ep.name AS ProjectName, h.ProjectId,
          ahm.LHeadName AS ContractorName, h.ContractorId,
          h.Remarks, h.TermsAndConditions, h.CreatedBy, h.UpdatedBy,
          COUNT(DISTINCT a.Id) AS ActivityCount
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
        LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
        LEFT JOIN dbo.WorkOrderActivities a  ON a.WorkOrderHeaderId = h.Id
        GROUP BY h.Id, h.DocumentNumber, h.DocumentDate, h.TotalAmount, h.Status,
          h.CreatedAt, h.UpdatedAt, h.CompanyId, h.ProjectId,
          h.ContractorId, h.Remarks, h.TermsAndConditions,
          h.CreatedBy, h.UpdatedBy, ec.name, ep.name, ahm.LHeadName
        ORDER BY h.CreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    res.json({ data: result.recordset, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("[GET /work-orders]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", cache("work-orders", 300), async (req, res) => {
  try {
    const pool = getPool();
    const headerResult = await pool.request()
      .input("Id", sql.Int, req.params.id)
      .query(`
        SELECT h.*, ec.name AS CompanyName, ep.name AS ProjectName, ahm.LHeadName AS ContractorName
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
        LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
        WHERE h.Id = @Id
      `);
    if (!headerResult.recordset.length)
      return res.status(404).json({ error: "Work order not found" });

    const activitiesResult = await pool.request()
      .input("WorkOrderHeaderId", sql.Int, req.params.id)
      .query(`
        SELECT a.*, ag.activity_name AS ActivityGroupName,
          act.activity_name AS ActivityName, uom.UOMName
        FROM dbo.WorkOrderActivities a
        LEFT JOIN dbo.ActivityMaster ag  ON ag.id  = a.ActivityGroupId
        LEFT JOIN dbo.ActivityMaster act ON act.id = a.ActivityId
        LEFT JOIN dbo.UOMMaster      uom ON uom.Id = a.UOMId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId ORDER BY a.Id
      `);

    const materialsResult = await pool.request()
      .input("WorkOrderHeaderId", sql.Int, req.params.id)
      .query(`
        SELECT m.*, img.M_Name AS ItemName, uom.UOMName,
          CAST(m.ItemId AS NVARCHAR(36)) AS ItemIdStr
        FROM dbo.WorkOrderActivityMaterials m
        INNER JOIN dbo.WorkOrderActivities  a   ON a.Id    = m.WorkOrderActivityId
        LEFT  JOIN dbo.Item_Master_Group    img ON img.M_Id = m.ItemId
        LEFT  JOIN dbo.UOMMaster            uom ON uom.Id  = m.UOMId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
        ORDER BY m.WorkOrderActivityId, m.Id
      `);

    const materialsMap = {};
    for (const mat of materialsResult.recordset) {
      const key = mat.WorkOrderActivityId;
      if (!materialsMap[key]) materialsMap[key] = [];
      materialsMap[key].push(mat);
    }
    const activities = activitiesResult.recordset.map((a) => ({
      ...a,
      materials: materialsMap[a.Id] || [],
    }));

    res.json({ ...headerResult.recordset[0], activities });
  } catch (err) {
    console.error("[GET /work-orders/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const { CompanyId, ProjectId, DocumentNumber, DocumentDate,
          ContractorId, TotalAmount, Remarks, TermsAndConditions } = req.body;
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("CompanyId",          sql.Int,               CompanyId          || null)
      .input("ProjectId",          sql.Int,               ProjectId          || null)
      .input("DocumentNumber",     sql.NVarChar(100),     DocumentNumber     || null)
      .input("DocumentDate",       sql.Date,              DocumentDate       || null)
      .input("ContractorId",       sql.Int,               ContractorId       || null)
      .input("TotalAmount",        sql.Decimal(18,2),     TotalAmount        || 0)
      .input("Remarks",            sql.NVarChar(500),     Remarks            || null)
      .input("TermsAndConditions", sql.NVarChar(sql.MAX), TermsAndConditions || null)
      .input("CreatedBy",          sql.NVarChar(100),     req.user?.email    || null)
      .input("CreatedAt",          sql.DateTime,          new Date())
      .query(`
        INSERT INTO dbo.WorkOrderHeader
          (CompanyId, ProjectId, DocumentNumber, DocumentDate, ContractorId,
           TotalAmount, Remarks, TermsAndConditions, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@CompanyId, @ProjectId, @DocumentNumber, @DocumentDate, @ContractorId,
           @TotalAmount, @Remarks, @TermsAndConditions, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("work-orders");
    res.status(201).json({ message: "Work order created", Id: result.recordset[0].Id });
  } catch (err) {
    console.error("[POST /work-orders]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try { await guardEdit("work-orders", req.params.id); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const { CompanyId, ProjectId, DocumentNumber, DocumentDate,
          ContractorId, TotalAmount, Remarks, TermsAndConditions } = req.body;
  try {
    const pool = getPool();
    await pool.request()
      .input("Id",                 sql.Int,               req.params.id)
      .input("CompanyId",          sql.Int,               CompanyId          || null)
      .input("ProjectId",          sql.Int,               ProjectId          || null)
      .input("DocumentNumber",     sql.NVarChar(100),     DocumentNumber     || null)
      .input("DocumentDate",       sql.Date,              DocumentDate       || null)
      .input("ContractorId",       sql.Int,               ContractorId       || null)
      .input("TotalAmount",        sql.Decimal(18,2),     TotalAmount        || 0)
      .input("Remarks",            sql.NVarChar(500),     Remarks            || null)
      .input("TermsAndConditions", sql.NVarChar(sql.MAX), TermsAndConditions || null)
      .input("UpdatedBy",          sql.NVarChar(100),     req.user?.email    || null)
      .input("UpdatedAt",          sql.DateTime,          new Date())
      .query(`
        UPDATE dbo.WorkOrderHeader SET
          CompanyId=@CompanyId, ProjectId=@ProjectId,
          DocumentNumber=@DocumentNumber, DocumentDate=@DocumentDate,
          ContractorId=@ContractorId, TotalAmount=@TotalAmount,
          Remarks=@Remarks, TermsAndConditions=@TermsAndConditions,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE Id=@Id
      `);
    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order updated" });
  } catch (err) {
    console.error("[PUT /work-orders/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool.request().input("WorkOrderHeaderId", sql.Int, req.params.id).query(`
      DELETE m FROM dbo.WorkOrderActivityMaterials m
      INNER JOIN dbo.WorkOrderActivities a ON a.Id = m.WorkOrderActivityId
      WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
    `);
    await pool.request().input("WorkOrderHeaderId", sql.Int, req.params.id).query(
      "DELETE FROM dbo.WorkOrderActivities WHERE WorkOrderHeaderId = @WorkOrderHeaderId"
    );
    await pool.request().input("Id", sql.Int, req.params.id).query(
      "DELETE FROM dbo.WorkOrderHeader WHERE Id = @Id"
    );
    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order and all related records deleted" });
  } catch (err) {
    console.error("[DELETE /work-orders/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
//  ACTIVITIES
// =============================================

router.get("/:id/activities", cache("work-orders", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("WorkOrderHeaderId", sql.Int, req.params.id)
      .query(`
        SELECT a.*, ag.activity_name AS ActivityGroupName,
          act.activity_name AS ActivityName, uom.UOMName,
          COUNT(m.Id) AS MaterialCount,
          ISNULL(SUM(m.Quantity * m.Rate), 0) AS MaterialTotal
        FROM dbo.WorkOrderActivities a
        LEFT JOIN dbo.ActivityMaster             ag  ON ag.id  = a.ActivityGroupId
        LEFT JOIN dbo.ActivityMaster             act ON act.id = a.ActivityId
        LEFT JOIN dbo.UOMMaster                  uom ON uom.Id = a.UOMId
        LEFT JOIN dbo.WorkOrderActivityMaterials m   ON m.WorkOrderActivityId = a.Id
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
        GROUP BY a.Id, a.WorkOrderHeaderId, a.ActivityGroupId, a.ActivityId,
          a.UOMId, a.Rate, a.Area, a.LabourAmount, a.MaterialAmount,
          a.GrandTotal, a.Remarks, a.CreatedAt,
          ag.activity_name, act.activity_name, uom.UOMName
        ORDER BY a.Id
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[GET /:id/activities]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/activities", async (req, res) => {
  const { ActivityGroupId, ActivityId, UOMId, Rate, Area,
          LabourAmount, MaterialAmount, GrandTotal, Remarks } = req.body;
  try {
    const pool = getPool();
    const headerRow = await pool.request()
      .input("HeaderId", sql.Int, req.params.id)
      .query("SELECT DocumentNumber FROM dbo.WorkOrderHeader WHERE Id = @HeaderId");
    const docNo = headerRow.recordset[0]?.DocumentNumber || null;

    const result = await pool.request()
      .input("WorkOrderHeaderId", sql.Int,           req.params.id)
      .input("DocNo",             sql.NVarChar(100), docNo)
      .input("ActivityGroupId",   sql.Int,           ActivityGroupId || null)
      .input("ActivityId",        sql.Int,           ActivityId      || null)
      .input("UOMId",             sql.Int,           UOMId           || null)
      .input("Rate",              sql.Decimal(18,2), Rate            || null)
      .input("Area",              sql.Decimal(18,2), Area            || null)
      .input("LabourAmount",      sql.Decimal(18,4), LabourAmount    || null)
      .input("MaterialAmount",    sql.Decimal(18,4), MaterialAmount  || null)
      .input("GrandTotal",        sql.Decimal(18,4), GrandTotal      || null)
      .input("Remarks",           sql.NVarChar,      Remarks         || null)
      .input("CreatedAt",         sql.DateTime2,     new Date())
      .query(`
        INSERT INTO dbo.WorkOrderActivities
          (WorkOrderHeaderId, DocNo, ActivityGroupId, ActivityId, UOMId,
           Rate, Area, LabourAmount, MaterialAmount, GrandTotal, Remarks, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@WorkOrderHeaderId, @DocNo, @ActivityGroupId, @ActivityId, @UOMId,
           @Rate, @Area, @LabourAmount, @MaterialAmount, @GrandTotal, @Remarks, @CreatedAt)
      `);
    await bumpCacheVersion("work-orders");
    res.status(201).json({ message: "Activity added", Id: result.recordset[0].Id });
  } catch (err) {
    console.error("[POST /:id/activities]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id/activities/:activityId", async (req, res) => {
  const { ActivityGroupId, ActivityId, UOMId, Rate, Area,
          LabourAmount, MaterialAmount, GrandTotal, Remarks } = req.body;
  try {
    const pool = getPool();
    await pool.request()
      .input("Id",              sql.Int,           req.params.activityId)
      .input("ActivityGroupId", sql.Int,           ActivityGroupId || null)
      .input("ActivityId",      sql.Int,           ActivityId      || null)
      .input("UOMId",           sql.Int,           UOMId           || null)
      .input("Rate",            sql.Decimal(18,2), Rate            || null)
      .input("Area",            sql.Decimal(18,2), Area            || null)
      .input("LabourAmount",    sql.Decimal(18,4), LabourAmount    || null)
      .input("MaterialAmount",  sql.Decimal(18,4), MaterialAmount  || null)
      .input("GrandTotal",      sql.Decimal(18,4), GrandTotal      || null)
      .input("Remarks",         sql.NVarChar,      Remarks         || null)
      .query(`
        UPDATE dbo.WorkOrderActivities SET
          ActivityGroupId=@ActivityGroupId, ActivityId=@ActivityId, UOMId=@UOMId,
          Rate=@Rate, Area=@Area, LabourAmount=@LabourAmount,
          MaterialAmount=@MaterialAmount, GrandTotal=@GrandTotal, Remarks=@Remarks
        WHERE Id=@Id
      `);
    await bumpCacheVersion("work-orders");
    res.json({ message: "Activity updated" });
  } catch (err) {
    console.error("[PUT /:id/activities/:actId]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/activities/:activityId", async (req, res) => {
  try {
    const pool = getPool();
    await pool.request().input("WorkOrderActivityId", sql.Int, req.params.activityId).query(
      "DELETE FROM dbo.WorkOrderActivityMaterials WHERE WorkOrderActivityId = @WorkOrderActivityId"
    );
    await pool.request().input("Id", sql.Int, req.params.activityId).query(
      "DELETE FROM dbo.WorkOrderActivities WHERE Id = @Id"
    );
    await bumpCacheVersion("work-orders");
    res.json({ message: "Activity and its materials deleted" });
  } catch (err) {
    console.error("[DELETE /:id/activities/:actId]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
//  MATERIALS
// =============================================

router.get("/:id/activities/:activityId/materials", cache("work-orders", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("WorkOrderActivityId", sql.Int, req.params.activityId)
      .query(`
        SELECT m.*, img.M_Name AS ItemName, uom.UOMName,
          CAST(m.ItemId AS NVARCHAR(36)) AS ItemIdStr
        FROM dbo.WorkOrderActivityMaterials m
        LEFT JOIN dbo.Item_Master_Group img ON img.M_Id = m.ItemId
        LEFT JOIN dbo.UOMMaster         uom ON uom.Id   = m.UOMId
        WHERE m.WorkOrderActivityId = @WorkOrderActivityId ORDER BY m.Id
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[GET materials]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST material — now includes DocNo FK (required by FK_WorkOrderActivityMaterials_DocNo)
 * DocNo is fetched from the WorkOrderHeader via the activity's WorkOrderHeaderId
 */
router.post("/:id/activities/:activityId/materials", async (req, res) => {
  const { ItemId, UOMId, Quantity, Rate, Remarks } = req.body;

  // ItemId must be a non-empty UUID string
  if (!ItemId || typeof ItemId !== "string" || ItemId.trim() === "") {
    return res.status(400).json({ error: "ItemId is required and must be a valid UUID from Item_Master_Group" });
  }

  try {
    const pool = getPool();

    // Fetch DocNo via the activity → header join
    const docNoRow = await pool.request()
      .input("ActivityId", sql.Int, req.params.activityId)
      .query(`
        SELECT h.DocumentNumber AS DocNo
        FROM dbo.WorkOrderActivities a
        INNER JOIN dbo.WorkOrderHeader h ON h.Id = a.WorkOrderHeaderId
        WHERE a.Id = @ActivityId
      `);
    const docNo = docNoRow.recordset[0]?.DocNo || null;

    const result = await pool.request()
      .input("WorkOrderActivityId", sql.Int,              req.params.activityId)
      .input("ItemId",              sql.UniqueIdentifier, ItemId.trim())
      .input("UOMId",               sql.Int,              UOMId    || null)
      .input("Quantity",            sql.Decimal(18,2),    Quantity || null)
      .input("Rate",                sql.Decimal(18,2),    Rate     || null)
      .input("Remarks",             sql.NVarChar(400),    Remarks  || null)
      .input("DocNo",               sql.NVarChar(100),    docNo)
      .input("CreatedBy",           sql.NVarChar(100),    req.user?.email || null)
      .input("CreatedAt",           sql.DateTime2,        new Date())
      .query(`
        INSERT INTO dbo.WorkOrderActivityMaterials
          (WorkOrderActivityId, ItemId, UOMId, Quantity, Rate, Remarks, DocNo, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@WorkOrderActivityId, @ItemId, @UOMId, @Quantity, @Rate, @Remarks, @DocNo, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("work-orders");
    res.status(201).json({ message: "Material added", Id: result.recordset[0].Id });
  } catch (err) {
    console.error("[POST materials]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id/activities/:activityId/materials/:materialId", async (req, res) => {
  const { ItemId, UOMId, Quantity, Rate, Remarks } = req.body;
  try {
    const pool = getPool();
    await pool.request()
      .input("Id",        sql.Int,              req.params.materialId)
      .input("ItemId",    sql.UniqueIdentifier, ItemId || null)
      .input("UOMId",     sql.Int,              UOMId    || null)
      .input("Quantity",  sql.Decimal(18,2),    Quantity || null)
      .input("Rate",      sql.Decimal(18,2),    Rate     || null)
      .input("Remarks",   sql.NVarChar(400),    Remarks  || null)
      .input("UpdatedBy", sql.NVarChar(100),    req.user?.email || null)
      .input("UpdatedAt", sql.DateTime2,        new Date())
      .query(`
        UPDATE dbo.WorkOrderActivityMaterials SET
          ItemId=@ItemId, UOMId=@UOMId, Quantity=@Quantity,
          Rate=@Rate, Remarks=@Remarks,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE Id=@Id
      `);
    await bumpCacheVersion("work-orders");
    res.json({ message: "Material updated" });
  } catch (err) {
    console.error("[PUT materials/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/activities/:activityId/materials/:materialId", async (req, res) => {
  try {
    const pool = getPool();
    await pool.request().input("Id", sql.Int, req.params.materialId).query(
      "DELETE FROM dbo.WorkOrderActivityMaterials WHERE Id = @Id"
    );
    await bumpCacheVersion("work-orders");
    res.json({ message: "Material deleted" });
  } catch (err) {
    console.error("[DELETE materials/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
//  BULK SAVE  —  POST /api/work-orders/:id/save-full
// =============================================
router.post("/:id/save-full", async (req, res) => {
  const headerId = parseInt(req.params.id);
  const { header, activities } = req.body;

  if (!Array.isArray(activities))
    return res.status(400).json({ error: "activities must be an array" });

  function safeIntList(ids) {
    return ids.map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0);
  }

  try {
    const pool = getPool();

    // 1. Update header
    await pool.request()
      .input("Id",                 sql.Int,               headerId)
      .input("CompanyId",          sql.Int,               header.CompanyId          || null)
      .input("ProjectId",          sql.Int,               header.ProjectId          || null)
      .input("DocumentNumber",     sql.NVarChar(100),     header.DocumentNumber     || null)
      .input("DocumentDate",       sql.Date,              header.DocumentDate       || null)
      .input("ContractorId",       sql.Int,               header.ContractorId       || null)
      .input("TotalAmount",        sql.Decimal(18,2),     header.TotalAmount        || 0)
      .input("Remarks",            sql.NVarChar(500),     header.Remarks            || null)
      .input("TermsAndConditions", sql.NVarChar(sql.MAX), header.TermsAndConditions || null)
      .input("UpdatedBy",          sql.NVarChar(100),     req.user?.email           || null)
      .input("UpdatedAt",          sql.DateTime,          new Date())
      .query(`
        UPDATE dbo.WorkOrderHeader SET
          CompanyId=@CompanyId, ProjectId=@ProjectId,
          DocumentNumber=@DocumentNumber, DocumentDate=@DocumentDate,
          ContractorId=@ContractorId, TotalAmount=@TotalAmount,
          Remarks=@Remarks, TermsAndConditions=@TermsAndConditions,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE Id=@Id
      `);

    // 2. Re-fetch DocumentNumber to use as DocNo FK in every INSERT
    const hdrRow = await pool.request()
      .input("HId", sql.Int, headerId)
      .query("SELECT DocumentNumber FROM dbo.WorkOrderHeader WHERE Id = @HId");
    const docNo = hdrRow.recordset[0]?.DocumentNumber || null;

    const keptActivityIds = [];

    // 3. Upsert each activity + its materials
    for (const act of activities) {
      let activityDbId = act.Id ? parseInt(act.Id, 10) : null;
      if (!Number.isFinite(activityDbId) || activityDbId <= 0) activityDbId = null;

      if (!activityDbId) {
        const r = await pool.request()
          .input("WorkOrderHeaderId", sql.Int,           headerId)
          .input("DocNo",             sql.NVarChar(100), docNo)
          .input("ActivityGroupId",   sql.Int,           act.ActivityGroupId || null)
          .input("ActivityId",        sql.Int,           act.ActivityId      || null)
          .input("UOMId",             sql.Int,           act.UOMId           || null)
          .input("Rate",              sql.Decimal(18,2), act.Rate            || null)
          .input("Area",              sql.Decimal(18,2), act.Area            || null)
          .input("LabourAmount",      sql.Decimal(18,4), act.LabourAmount    || null)
          .input("MaterialAmount",    sql.Decimal(18,4), act.MaterialAmount  || null)
          .input("GrandTotal",        sql.Decimal(18,4), act.GrandTotal      || null)
          .input("Remarks",           sql.NVarChar,      act.Remarks         || null)
          .input("CreatedAt",         sql.DateTime2,     new Date())
          .query(`
            INSERT INTO dbo.WorkOrderActivities
              (WorkOrderHeaderId, DocNo, ActivityGroupId, ActivityId, UOMId,
               Rate, Area, LabourAmount, MaterialAmount, GrandTotal, Remarks, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES
              (@WorkOrderHeaderId, @DocNo, @ActivityGroupId, @ActivityId, @UOMId,
               @Rate, @Area, @LabourAmount, @MaterialAmount, @GrandTotal, @Remarks, @CreatedAt)
          `);
        activityDbId = r.recordset[0].Id;
      } else {
        await pool.request()
          .input("Id",              sql.Int,           activityDbId)
          .input("ActivityGroupId", sql.Int,           act.ActivityGroupId || null)
          .input("ActivityId",      sql.Int,           act.ActivityId      || null)
          .input("UOMId",           sql.Int,           act.UOMId           || null)
          .input("Rate",            sql.Decimal(18,2), act.Rate            || null)
          .input("Area",            sql.Decimal(18,2), act.Area            || null)
          .input("LabourAmount",    sql.Decimal(18,4), act.LabourAmount    || null)
          .input("MaterialAmount",  sql.Decimal(18,4), act.MaterialAmount  || null)
          .input("GrandTotal",      sql.Decimal(18,4), act.GrandTotal      || null)
          .input("Remarks",         sql.NVarChar,      act.Remarks         || null)
          .query(`
            UPDATE dbo.WorkOrderActivities SET
              ActivityGroupId=@ActivityGroupId, ActivityId=@ActivityId, UOMId=@UOMId,
              Rate=@Rate, Area=@Area, LabourAmount=@LabourAmount,
              MaterialAmount=@MaterialAmount, GrandTotal=@GrandTotal, Remarks=@Remarks
            WHERE Id=@Id
          `);
      }

      keptActivityIds.push(activityDbId);
      const keptMaterialIds = [];
      const materials = Array.isArray(act.materials) ? act.materials : [];

      for (const mat of materials) {
        // Skip materials that have no ItemId — they cannot be saved (NOT NULL FK constraint)
        if (!mat.ItemId || String(mat.ItemId).trim() === "") continue;

        let materialDbId = mat.Id ? parseInt(mat.Id, 10) : null;
        if (!Number.isFinite(materialDbId) || materialDbId <= 0) materialDbId = null;

        if (!materialDbId) {
          const r = await pool.request()
            .input("WorkOrderActivityId", sql.Int,              activityDbId)
            .input("ItemId",              sql.UniqueIdentifier, String(mat.ItemId).trim())
            .input("UOMId",               sql.Int,              mat.UOMId    || null)
            .input("Quantity",            sql.Decimal(18,2),    mat.Quantity || null)
            .input("Rate",                sql.Decimal(18,2),    mat.Rate     || null)
            .input("Remarks",             sql.NVarChar(400),    mat.Remarks  || null)
            // ↓ DocNo FK — required by FK_WorkOrderActivityMaterials_DocNo
            .input("DocNo",               sql.NVarChar(100),    docNo)
            .input("CreatedBy",           sql.NVarChar(100),    req.user?.email || null)
            .input("CreatedAt",           sql.DateTime2,        new Date())
            .query(`
              INSERT INTO dbo.WorkOrderActivityMaterials
                (WorkOrderActivityId, ItemId, UOMId, Quantity, Rate, Remarks, DocNo, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id
              VALUES
                (@WorkOrderActivityId, @ItemId, @UOMId, @Quantity, @Rate, @Remarks, @DocNo, @CreatedBy, @CreatedAt)
            `);
          materialDbId = r.recordset[0].Id;
        } else {
          await pool.request()
            .input("Id",        sql.Int,              materialDbId)
            .input("ItemId",    sql.UniqueIdentifier, String(mat.ItemId).trim())
            .input("UOMId",     sql.Int,              mat.UOMId    || null)
            .input("Quantity",  sql.Decimal(18,2),    mat.Quantity || null)
            .input("Rate",      sql.Decimal(18,2),    mat.Rate     || null)
            .input("Remarks",   sql.NVarChar(400),    mat.Remarks  || null)
            .input("UpdatedBy", sql.NVarChar(100),    req.user?.email || null)
            .input("UpdatedAt", sql.DateTime2,        new Date())
            .query(`
              UPDATE dbo.WorkOrderActivityMaterials SET
                ItemId=@ItemId, UOMId=@UOMId, Quantity=@Quantity,
                Rate=@Rate, Remarks=@Remarks,
                UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
              WHERE Id=@Id
            `);
        }
        keptMaterialIds.push(materialDbId);
      }

      // Delete removed materials for this activity
      const safeMaterialIds = safeIntList(keptMaterialIds);
      if (safeMaterialIds.length > 0) {
        await pool.request().input("WorkOrderActivityId", sql.Int, activityDbId).query(`
          DELETE FROM dbo.WorkOrderActivityMaterials
          WHERE WorkOrderActivityId = @WorkOrderActivityId
          AND Id NOT IN (${safeMaterialIds.join(",")})
        `);
      } else {
        await pool.request().input("WorkOrderActivityId", sql.Int, activityDbId).query(
          "DELETE FROM dbo.WorkOrderActivityMaterials WHERE WorkOrderActivityId = @WorkOrderActivityId"
        );
      }
    }

    // Delete removed activities (and their materials)
    const safeActivityIds = safeIntList(keptActivityIds);
    if (safeActivityIds.length > 0) {
      await pool.request().input("WorkOrderHeaderId", sql.Int, headerId).query(`
        DELETE m FROM dbo.WorkOrderActivityMaterials m
        INNER JOIN dbo.WorkOrderActivities a ON a.Id = m.WorkOrderActivityId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
        AND a.Id NOT IN (${safeActivityIds.join(",")})
      `);
      await pool.request().input("WorkOrderHeaderId", sql.Int, headerId).query(`
        DELETE FROM dbo.WorkOrderActivities
        WHERE WorkOrderHeaderId = @WorkOrderHeaderId
        AND Id NOT IN (${safeActivityIds.join(",")})
      `);
    } else {
      await pool.request().input("WorkOrderHeaderId", sql.Int, headerId).query(`
        DELETE m FROM dbo.WorkOrderActivityMaterials m
        INNER JOIN dbo.WorkOrderActivities a ON a.Id = m.WorkOrderActivityId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
      `);
      await pool.request().input("WorkOrderHeaderId", sql.Int, headerId).query(
        "DELETE FROM dbo.WorkOrderActivities WHERE WorkOrderHeaderId = @WorkOrderHeaderId"
      );
    }

    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order saved successfully", activityCount: safeActivityIds.length });
  } catch (err) {
    console.error("[POST /:id/save-full]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Approval transitions ──────────────────────────────────────────────────────

router.put("/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition("work-orders", id, "Pending", userEmail, req.user?.role);
    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order submitted for approval", ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition("work-orders", id, "Approved", userEmail, req.user?.role);
    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order approved", ...result });
  } catch (err) {
    res.status(err.message.includes("not authorized") ? 403 : 400).json({ error: err.message });
  }
});

router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition("work-orders", id, "Rejected", userEmail, req.user?.role, note || null);
    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order rejected", ...result });
  } catch (err) {
    res.status(err.message.includes("not authorized") ? 403 : 400).json({ error: err.message });
  }
});

module.exports = router;