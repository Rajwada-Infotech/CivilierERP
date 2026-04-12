const express = require("express");
const { cache } = require("../middleware/cache");
const { redisDelPattern } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

// =============================================
//  WORK ORDER HEADER  —  /api/work-orders
// =============================================

// GET all headers — joined with enterprise + contractor names
router.get("/", cache("work-orders", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        h.Id,
        h.DocumentNumber,
        h.DocumentDate,
        h.TotalAmount,
        h.CreatedAt,
        h.UpdatedAt,
        ec.name       AS CompanyName,
        h.CompanyId,
        ep.name       AS ProjectName,
        h.ProjectId,
        ahm.LHeadName AS ContractorName,
        h.ContractorId,
        h.Remarks,
        h.TermsAndConditions,
        h.CreatedBy,
        h.UpdatedBy,
        COUNT(DISTINCT a.Id) AS ActivityCount
      FROM dbo.WorkOrderHeader h
      LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
      LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
      LEFT JOIN dbo.WorkOrderActivities a  ON a.WorkOrderHeaderId = h.Id
      GROUP BY
        h.Id, h.DocumentNumber, h.DocumentDate, h.TotalAmount,
        h.CreatedAt, h.UpdatedAt, h.CompanyId, h.ProjectId,
        h.ContractorId, h.Remarks, h.TermsAndConditions,
        h.CreatedBy, h.UpdatedBy,
        ec.name, ep.name, ahm.LHeadName
      ORDER BY h.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single work order — full nested tree (header + activities + materials)
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();

    // Header with all FK lookups
    const headerResult = await pool
      .request()
      .input("Id", sql.Int, req.params.id).query(`
        SELECT
          h.*,
          ec.name       AS CompanyName,
          ep.name       AS ProjectName,
          ahm.LHeadName AS ContractorName
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
        LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
        WHERE h.Id = @Id
      `);
    if (!headerResult.recordset.length)
      return res.status(404).json({ error: "Work order not found" });

    // Activities with resolved FK names
    const activitiesResult = await pool
      .request()
      .input("WorkOrderHeaderId", sql.Int, req.params.id).query(`
        SELECT
          a.*,
          ag.activity_name  AS ActivityGroupName,
          act.activity_name AS ActivityName,
          uom.UOMName
        FROM dbo.WorkOrderActivities a
        LEFT JOIN dbo.ActivityMaster ag  ON ag.id  = a.ActivityGroupId
        LEFT JOIN dbo.ActivityMaster act ON act.id = a.ActivityId
        LEFT JOIN dbo.UOMMaster      uom ON uom.Id = a.UOMId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
        ORDER BY a.Id
      `);

    // Materials for all activities, with resolved FK names
    const materialsResult = await pool
      .request()
      .input("WorkOrderHeaderId", sql.Int, req.params.id).query(`
        SELECT
          m.*,
          img.M_Name AS ItemName,
          uom.UOMName,
          uc.name    AS CreatedByName,
          uu.name    AS UpdatedByName
        FROM dbo.WorkOrderActivityMaterials m
        INNER JOIN dbo.WorkOrderActivities  a   ON a.Id    = m.WorkOrderActivityId
        LEFT JOIN  dbo.Item_Master_Group    img ON img.M_Id = m.ItemId
        LEFT JOIN  dbo.UOMMaster            uom ON uom.Id  = m.UOMId
        LEFT JOIN  dbo.users                uc  ON uc.id   = m.CreatedBy
        LEFT JOIN  dbo.users                uu  ON uu.id   = m.UpdatedBy
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
        ORDER BY m.WorkOrderActivityId, m.Id
      `);

    // Nest materials inside their activity
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
    res.status(500).json({ error: err.message });
  }
});

// POST — create header, returns new Id
router.post("/", async (req, res) => {
  const {
    CompanyId,
    ProjectId,
    DocumentNumber,
    DocumentDate,
    ContractorId,
    TotalAmount,
    Remarks,
    TermsAndConditions,
    CreatedBy,
  } = req.body;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("ProjectId", sql.Int, ProjectId || null)
      .input("DocumentNumber", sql.NVarChar, DocumentNumber || null)
      .input("DocumentDate", sql.Date, DocumentDate || null)
      .input("ContractorId", sql.Int, ContractorId || null)
      .input("TotalAmount", sql.Decimal(18, 2), TotalAmount || 0)
      .input("Remarks", sql.NVarChar, Remarks || null)
      .input("TermsAndConditions", sql.NVarChar, TermsAndConditions || null)
      .input("CreatedBy", sql.Int, CreatedBy || 1)
      .input("CreatedAt", sql.DateTime, new Date()).query(`
        INSERT INTO dbo.WorkOrderHeader
          (CompanyId, ProjectId, DocumentNumber, DocumentDate, ContractorId,
           TotalAmount, Remarks, TermsAndConditions, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@CompanyId, @ProjectId, @DocumentNumber, @DocumentDate, @ContractorId,
           @TotalAmount, @Remarks, @TermsAndConditions, @CreatedBy, @CreatedAt)
      `);
    res
      .status(201)
      .json({ message: "Work order created", Id: result.recordset[0].Id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — update header
router.put("/:id", async (req, res) => {
  const {
    CompanyId,
    ProjectId,
    DocumentNumber,
    DocumentDate,
    ContractorId,
    TotalAmount,
    Remarks,
    TermsAndConditions,
    UpdatedBy,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("ProjectId", sql.Int, ProjectId || null)
      .input("DocumentNumber", sql.NVarChar, DocumentNumber || null)
      .input("DocumentDate", sql.Date, DocumentDate || null)
      .input("ContractorId", sql.Int, ContractorId || null)
      .input("TotalAmount", sql.Decimal(18, 2), TotalAmount || 0)
      .input("Remarks", sql.NVarChar, Remarks || null)
      .input("TermsAndConditions", sql.NVarChar, TermsAndConditions || null)
      .input("UpdatedBy", sql.Int, UpdatedBy || 1)
      .input("UpdatedAt", sql.DateTime, new Date()).query(`
        UPDATE dbo.WorkOrderHeader SET
          CompanyId=@CompanyId, ProjectId=@ProjectId,
          DocumentNumber=@DocumentNumber, DocumentDate=@DocumentDate,
          ContractorId=@ContractorId, TotalAmount=@TotalAmount,
          Remarks=@Remarks, TermsAndConditions=@TermsAndConditions,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE Id=@Id
      `);
    await redisDelPattern("cache:work-orders:*");
    res.json({ message: "Work order updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — cascades: materials → activities → header
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool.request().input("WorkOrderHeaderId", sql.Int, req.params.id)
      .query(`
        DELETE m FROM dbo.WorkOrderActivityMaterials m
        INNER JOIN dbo.WorkOrderActivities a ON a.Id = m.WorkOrderActivityId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
      `);
    await pool
      .request()
      .input("WorkOrderHeaderId", sql.Int, req.params.id)
      .query(
        "DELETE FROM dbo.WorkOrderActivities WHERE WorkOrderHeaderId = @WorkOrderHeaderId",
      );
    await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.WorkOrderHeader WHERE Id = @Id");
    await redisDelPattern("cache:work-orders:*");
    res.json({ message: "Work order and all related records deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
//  ACTIVITIES  —  /api/work-orders/:id/activities
// =============================================

// GET all activities for a header
router.get("/:id/activities", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("WorkOrderHeaderId", sql.Int, req.params.id).query(`
        SELECT
          a.*,
          ag.activity_name             AS ActivityGroupName,
          act.activity_name            AS ActivityName,
          uom.UOMName,
          COUNT(m.Id)                  AS MaterialCount,
          ISNULL(SUM(m.Quantity * m.Rate), 0) AS MaterialTotal
        FROM dbo.WorkOrderActivities a
        LEFT JOIN dbo.ActivityMaster             ag  ON ag.id  = a.ActivityGroupId
        LEFT JOIN dbo.ActivityMaster             act ON act.id = a.ActivityId
        LEFT JOIN dbo.UOMMaster                  uom ON uom.Id = a.UOMId
        LEFT JOIN dbo.WorkOrderActivityMaterials m   ON m.WorkOrderActivityId = a.Id
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
        GROUP BY
          a.Id, a.WorkOrderHeaderId, a.ActivityGroupId, a.ActivityId,
          a.UOMId, a.Rate, a.Area, a.LabourAmount, a.MaterialAmount,
          a.GrandTotal, a.Remarks, a.CreatedAt,
          ag.activity_name, act.activity_name, uom.UOMName
        ORDER BY a.Id
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — add activity to a header
router.post("/:id/activities", async (req, res) => {
  const {
    ActivityGroupId,
    ActivityId,
    UOMId,
    Rate,
    Area,
    LabourAmount,
    MaterialAmount,
    GrandTotal,
    Remarks,
  } = req.body;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("WorkOrderHeaderId", sql.Int, req.params.id)
      .input("ActivityGroupId", sql.Int, ActivityGroupId || null)
      .input("ActivityId", sql.Int, ActivityId || null)
      .input("UOMId", sql.Int, UOMId || null)
      .input("Rate", sql.Decimal(18, 2), Rate || null)
      .input("Area", sql.Decimal(18, 2), Area || null)
      .input("LabourAmount", sql.Decimal(18, 4), LabourAmount || null)
      .input("MaterialAmount", sql.Decimal(18, 4), MaterialAmount || null)
      .input("GrandTotal", sql.Decimal(18, 4), GrandTotal || null)
      .input("Remarks", sql.NVarChar, Remarks || null)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.WorkOrderActivities
          (WorkOrderHeaderId, ActivityGroupId, ActivityId, UOMId,
           Rate, Area, LabourAmount, MaterialAmount, GrandTotal, Remarks, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@WorkOrderHeaderId, @ActivityGroupId, @ActivityId, @UOMId,
           @Rate, @Area, @LabourAmount, @MaterialAmount, @GrandTotal, @Remarks, @CreatedAt)
      `);
    res
      .status(201)
      .json({ message: "Activity added", Id: result.recordset[0].Id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — update an activity
router.put("/:id/activities/:activityId", async (req, res) => {
  const {
    ActivityGroupId,
    ActivityId,
    UOMId,
    Rate,
    Area,
    LabourAmount,
    MaterialAmount,
    GrandTotal,
    Remarks,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, req.params.activityId)
      .input("ActivityGroupId", sql.Int, ActivityGroupId || null)
      .input("ActivityId", sql.Int, ActivityId || null)
      .input("UOMId", sql.Int, UOMId || null)
      .input("Rate", sql.Decimal(18, 2), Rate || null)
      .input("Area", sql.Decimal(18, 2), Area || null)
      .input("LabourAmount", sql.Decimal(18, 4), LabourAmount || null)
      .input("MaterialAmount", sql.Decimal(18, 4), MaterialAmount || null)
      .input("GrandTotal", sql.Decimal(18, 4), GrandTotal || null)
      .input("Remarks", sql.NVarChar, Remarks || null).query(`
        UPDATE dbo.WorkOrderActivities SET
          ActivityGroupId=@ActivityGroupId, ActivityId=@ActivityId, UOMId=@UOMId,
          Rate=@Rate, Area=@Area, LabourAmount=@LabourAmount,
          MaterialAmount=@MaterialAmount, GrandTotal=@GrandTotal, Remarks=@Remarks
        WHERE Id=@Id
      `);
    await redisDelPattern("cache:work-orders:*");
    res.json({ message: "Activity updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — activity + its materials
router.delete("/:id/activities/:activityId", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("WorkOrderActivityId", sql.Int, req.params.activityId)
      .query(
        "DELETE FROM dbo.WorkOrderActivityMaterials WHERE WorkOrderActivityId = @WorkOrderActivityId",
      );
    await pool
      .request()
      .input("Id", sql.Int, req.params.activityId)
      .query("DELETE FROM dbo.WorkOrderActivities WHERE Id = @Id");
    await redisDelPattern("cache:work-orders:*");
    res.json({ message: "Activity and its materials deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
//  MATERIALS  —  /api/work-orders/:id/activities/:activityId/materials
// =============================================

// GET all materials for an activity
router.get("/:id/activities/:activityId/materials", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("WorkOrderActivityId", sql.Int, req.params.activityId).query(`
        SELECT
          m.*,
          img.M_Name AS ItemName,
          uom.UOMName,
          uc.name    AS CreatedByName,
          uu.name    AS UpdatedByName
        FROM dbo.WorkOrderActivityMaterials m
        LEFT JOIN dbo.Item_Master_Group img ON img.M_Id = m.ItemId
        LEFT JOIN dbo.UOMMaster         uom ON uom.Id   = m.UOMId
        LEFT JOIN dbo.users             uc  ON uc.id    = m.CreatedBy
        LEFT JOIN dbo.users             uu  ON uu.id    = m.UpdatedBy
        WHERE m.WorkOrderActivityId = @WorkOrderActivityId
        ORDER BY m.Id
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — add material to an activity
router.post("/:id/activities/:activityId/materials", async (req, res) => {
  const { ItemId, UOMId, Quantity, Rate, Remarks, CreatedBy } = req.body;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("WorkOrderActivityId", sql.Int, req.params.activityId)
      .input("ItemId", sql.UniqueIdentifier, ItemId || null)
      .input("UOMId", sql.Int, UOMId || null)
      .input("Quantity", sql.Decimal(18, 2), Quantity || null)
      .input("Rate", sql.Decimal(18, 2), Rate || null)
      .input("Remarks", sql.NVarChar, Remarks || null)
      .input("CreatedBy", sql.Int, CreatedBy || 1)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.WorkOrderActivityMaterials
          (WorkOrderActivityId, ItemId, UOMId, Quantity, Rate, Remarks, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@WorkOrderActivityId, @ItemId, @UOMId, @Quantity, @Rate, @Remarks, @CreatedBy, @CreatedAt)
      `);
    res
      .status(201)
      .json({ message: "Material added", Id: result.recordset[0].Id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — update a material
router.put(
  "/:id/activities/:activityId/materials/:materialId",
  async (req, res) => {
    const { ItemId, UOMId, Quantity, Rate, Remarks, UpdatedBy } = req.body;
    try {
      const pool = getPool();
      await pool
        .request()
        .input("Id", sql.Int, req.params.materialId)
        .input("ItemId", sql.UniqueIdentifier, ItemId || null)
        .input("UOMId", sql.Int, UOMId || null)
        .input("Quantity", sql.Decimal(18, 2), Quantity || null)
        .input("Rate", sql.Decimal(18, 2), Rate || null)
        .input("Remarks", sql.NVarChar, Remarks || null)
        .input("UpdatedBy", sql.Int, UpdatedBy || 1)
        .input("UpdatedAt", sql.DateTime2, new Date()).query(`
          UPDATE dbo.WorkOrderActivityMaterials SET
            ItemId=@ItemId, UOMId=@UOMId, Quantity=@Quantity,
            Rate=@Rate, Remarks=@Remarks,
            UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
          WHERE Id=@Id
        `);
      await redisDelPattern("cache:work-orders:*");
      res.json({ message: "Material updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// DELETE — single material
router.delete(
  "/:id/activities/:activityId/materials/:materialId",
  async (req, res) => {
    try {
      const pool = getPool();
      await pool
        .request()
        .input("Id", sql.Int, req.params.materialId)
        .query("DELETE FROM dbo.WorkOrderActivityMaterials WHERE Id = @Id");
      await redisDelPattern("cache:work-orders:*");
      res.json({ message: "Material deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// =============================================
//  BULK SAVE  —  POST /api/work-orders/:id/save-full
//  Send the entire work order tree in one shot.
//  New rows (no Id) are inserted. Existing rows (with Id) are updated.
//  Rows present in DB but absent from payload are deleted.
// =============================================
router.post("/:id/save-full", async (req, res) => {
  const headerId = parseInt(req.params.id);
  const { header, activities } = req.body;

  if (!Array.isArray(activities))
    return res.status(400).json({ error: "activities must be an array" });

  // Fix: keptActivityIds and keptMaterialIds were interpolated directly into SQL
  // (NOT IN (${ids.join(",")})) without any sanitisation. A non-integer Id in the
  // payload would corrupt the query. Enforce parseInt and filter out NaN values here
  // so only valid positive integers ever reach the SQL string.
  function safeIntList(ids) {
    return ids
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  try {
    const pool = getPool();

    // 1. Update header
    await pool
      .request()
      .input("Id", sql.Int, headerId)
      .input("CompanyId", sql.Int, header.CompanyId || null)
      .input("ProjectId", sql.Int, header.ProjectId || null)
      .input("DocumentNumber", sql.NVarChar, header.DocumentNumber || null)
      .input("DocumentDate", sql.Date, header.DocumentDate || null)
      .input("ContractorId", sql.Int, header.ContractorId || null)
      .input("TotalAmount", sql.Decimal(18, 2), header.TotalAmount || 0)
      .input("Remarks", sql.NVarChar, header.Remarks || null)
      .input(
        "TermsAndConditions",
        sql.NVarChar,
        header.TermsAndConditions || null,
      )
      .input("UpdatedBy", sql.Int, header.UpdatedBy || 1)
      .input("UpdatedAt", sql.DateTime, new Date()).query(`
        UPDATE dbo.WorkOrderHeader SET
          CompanyId=@CompanyId, ProjectId=@ProjectId,
          DocumentNumber=@DocumentNumber, DocumentDate=@DocumentDate,
          ContractorId=@ContractorId, TotalAmount=@TotalAmount,
          Remarks=@Remarks, TermsAndConditions=@TermsAndConditions,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE Id=@Id
      `);

    const keptActivityIds = [];

    // 2. Upsert each activity
    for (const act of activities) {
      let activityId = act.Id ? parseInt(act.Id, 10) : null;
      if (activityId && !Number.isFinite(activityId)) activityId = null;

      if (!activityId) {
        const r = await pool
          .request()
          .input("WorkOrderHeaderId", sql.Int, headerId)
          .input("ActivityGroupId", sql.Int, act.ActivityGroupId || null)
          .input("ActivityId", sql.Int, act.ActivityId || null)
          .input("UOMId", sql.Int, act.UOMId || null)
          .input("Rate", sql.Decimal(18, 2), act.Rate || null)
          .input("Area", sql.Decimal(18, 2), act.Area || null)
          .input("LabourAmount", sql.Decimal(18, 4), act.LabourAmount || null)
          .input(
            "MaterialAmount",
            sql.Decimal(18, 4),
            act.MaterialAmount || null,
          )
          .input("GrandTotal", sql.Decimal(18, 4), act.GrandTotal || null)
          .input("Remarks", sql.NVarChar, act.Remarks || null)
          .input("CreatedAt", sql.DateTime2, new Date()).query(`
            INSERT INTO dbo.WorkOrderActivities
              (WorkOrderHeaderId, ActivityGroupId, ActivityId, UOMId,
               Rate, Area, LabourAmount, MaterialAmount, GrandTotal, Remarks, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES
              (@WorkOrderHeaderId, @ActivityGroupId, @ActivityId, @UOMId,
               @Rate, @Area, @LabourAmount, @MaterialAmount, @GrandTotal, @Remarks, @CreatedAt)
          `);
        activityId = r.recordset[0].Id;
      } else {
        await pool
          .request()
          .input("Id", sql.Int, activityId)
          .input("ActivityGroupId", sql.Int, act.ActivityGroupId || null)
          .input("ActivityId", sql.Int, act.ActivityId || null)
          .input("UOMId", sql.Int, act.UOMId || null)
          .input("Rate", sql.Decimal(18, 2), act.Rate || null)
          .input("Area", sql.Decimal(18, 2), act.Area || null)
          .input("LabourAmount", sql.Decimal(18, 4), act.LabourAmount || null)
          .input(
            "MaterialAmount",
            sql.Decimal(18, 4),
            act.MaterialAmount || null,
          )
          .input("GrandTotal", sql.Decimal(18, 4), act.GrandTotal || null)
          .input("Remarks", sql.NVarChar, act.Remarks || null).query(`
            UPDATE dbo.WorkOrderActivities SET
              ActivityGroupId=@ActivityGroupId, ActivityId=@ActivityId, UOMId=@UOMId,
              Rate=@Rate, Area=@Area, LabourAmount=@LabourAmount,
              MaterialAmount=@MaterialAmount, GrandTotal=@GrandTotal, Remarks=@Remarks
            WHERE Id=@Id
          `);
      }

      keptActivityIds.push(activityId);
      const keptMaterialIds = [];
      const materials = Array.isArray(act.materials) ? act.materials : [];

      // 3. Upsert each material under this activity
      for (const mat of materials) {
        let materialId = mat.Id ? parseInt(mat.Id, 10) : null;
        if (materialId && !Number.isFinite(materialId)) materialId = null;

        if (!materialId) {
          const r = await pool
            .request()
            .input("WorkOrderActivityId", sql.Int, activityId)
            .input("ItemId", sql.UniqueIdentifier, mat.ItemId || null)
            .input("UOMId", sql.Int, mat.UOMId || null)
            .input("Quantity", sql.Decimal(18, 2), mat.Quantity || null)
            .input("Rate", sql.Decimal(18, 2), mat.Rate || null)
            .input("Remarks", sql.NVarChar, mat.Remarks || null)
            .input("CreatedBy", sql.Int, mat.CreatedBy || 1)
            .input("CreatedAt", sql.DateTime2, new Date()).query(`
              INSERT INTO dbo.WorkOrderActivityMaterials
                (WorkOrderActivityId, ItemId, UOMId, Quantity, Rate, Remarks, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id
              VALUES
                (@WorkOrderActivityId, @ItemId, @UOMId, @Quantity, @Rate, @Remarks, @CreatedBy, @CreatedAt)
            `);
          materialId = r.recordset[0].Id;
        } else {
          await pool
            .request()
            .input("Id", sql.Int, materialId)
            .input("ItemId", sql.UniqueIdentifier, mat.ItemId || null)
            .input("UOMId", sql.Int, mat.UOMId || null)
            .input("Quantity", sql.Decimal(18, 2), mat.Quantity || null)
            .input("Rate", sql.Decimal(18, 2), mat.Rate || null)
            .input("Remarks", sql.NVarChar, mat.Remarks || null)
            .input("UpdatedBy", sql.Int, mat.UpdatedBy || 1)
            .input("UpdatedAt", sql.DateTime2, new Date()).query(`
              UPDATE dbo.WorkOrderActivityMaterials SET
                ItemId=@ItemId, UOMId=@UOMId, Quantity=@Quantity,
                Rate=@Rate, Remarks=@Remarks,
                UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
              WHERE Id=@Id
            `);
        }
        keptMaterialIds.push(materialId);
      }

      // Delete materials removed by the user for this activity
      const safeMaterialIds = safeIntList(keptMaterialIds);
      if (safeMaterialIds.length > 0) {
        await pool.request().input("WorkOrderActivityId", sql.Int, activityId)
          .query(`
            DELETE FROM dbo.WorkOrderActivityMaterials
            WHERE WorkOrderActivityId = @WorkOrderActivityId
            AND Id NOT IN (${safeMaterialIds.join(",")})
          `);
      } else {
        await pool
          .request()
          .input("WorkOrderActivityId", sql.Int, activityId)
          .query(
            "DELETE FROM dbo.WorkOrderActivityMaterials WHERE WorkOrderActivityId = @WorkOrderActivityId",
          );
      }
    }

    // 4. Delete activities (and their materials) removed by the user
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
      // All activities removed — wipe everything
      await pool.request().input("WorkOrderHeaderId", sql.Int, headerId).query(`
          DELETE m FROM dbo.WorkOrderActivityMaterials m
          INNER JOIN dbo.WorkOrderActivities a ON a.Id = m.WorkOrderActivityId
          WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
        `);
      await pool
        .request()
        .input("WorkOrderHeaderId", sql.Int, headerId)
        .query(
          "DELETE FROM dbo.WorkOrderActivities WHERE WorkOrderHeaderId = @WorkOrderHeaderId",
        );
    }

    await redisDelPattern("cache:work-orders:*");
    res.json({
      message: "Work order saved successfully",
      activityCount: safeActivityIds.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
