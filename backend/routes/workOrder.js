const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { transition, guardEdit, getRecordStatus } = require("../services/approvalService");
const { snapshotRow, recordAmendment } = require("../services/amendmentLog");
const { resolveAllowPostApproval } = require("../middleware/permissions");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");
const { requireValidId, checkRowsAffected } = require("../utils/routeHelpers");

router.use(checkPermissionForMethod("Engineering", "WorkOrders"));

const requireUserName = (req, res) => {
  const userName = req.user?.name;
  if (!userName) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return userName;
};

const serializeGST = (gstStr) => {
  if (!gstStr) return null;
  try {
    return JSON.parse(gstStr);
  } catch {
    return null;
  }
};

// =============================================
//  META / DROPDOWN DATA  —  /api/work-orders/meta/*
//  MUST be defined BEFORE /:id routes so Express
//  does not parse "meta" as an integer id.
// =============================================

router.get(
  "/meta/companies",
  cache("wo-meta-companies", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT id, name FROM dbo.enterprise WHERE business_type = 'C' ORDER BY name
    `);
      res.json(
        (result.recordset || []).map((r) => ({ id: r.id, name: r.name })),
      );
    } catch (err) {
      console.error("[wo-meta-companies]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.get(
  "/meta/projects",
  cache("wo-meta-projects", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' ORDER BY name
    `);
      res.json(
        (result.recordset || []).map((r) => ({ id: r.id, name: r.name })),
      );
    } catch (err) {
      console.error("[wo-meta-projects]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.get(
  "/meta/contractors",
  cache("wo-meta-contractors", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT LHeadId AS id, LHeadName AS name
      FROM dbo.AccountHeadMaster WHERE LHeadType = 'C' ORDER BY LHeadName
    `);
      res.json(
        (result.recordset || []).map((r) => ({ id: r.id, name: r.name })),
      );
    } catch (err) {
      console.error("[wo-meta-contractors]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.get(
  "/meta/activity-groups",
  cache("wo-meta-act-groups", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT id, activity_name AS name
      FROM dbo.ActivityMaster
      WHERE activity_type = 0 AND ISNULL(is_active, 1) = 1
      ORDER BY activity_name
    `);
      res.json(
        (result.recordset || []).map((r) => ({ id: r.id, name: r.name })),
      );
    } catch (err) {
      console.error("[wo-meta-act-groups]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.get(
  "/meta/activities",
  cache("wo-meta-activities", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      // Use group_id (reliable int FK) not belongsTo (nvarchar, may be null)
      const groupId = req.query.groupId
        ? parseInt(req.query.groupId, 10)
        : null;
      let result;
      if (groupId && Number.isFinite(groupId)) {
        result = await pool.request().input("GroupId", sql.Int, groupId).query(`
          SELECT id, activity_name AS name, group_id AS groupId
          FROM dbo.ActivityMaster
          WHERE activity_type = 1 AND group_id = @GroupId AND ISNULL(is_active, 1) = 1
          ORDER BY activity_name
        `);
      } else {
        result = await pool.request().query(`
        SELECT id, activity_name AS name, group_id AS groupId
        FROM dbo.ActivityMaster
        WHERE activity_type = 1 AND ISNULL(is_active, 1) = 1
        ORDER BY activity_name
      `);
      }
      res.json(
        (result.recordset || []).map((r) => ({
          id: r.id,
          name: r.name,
          groupId: r.groupId != null ? Number(r.groupId) : null,
        })),
      );
    } catch (err) {
      console.error("[wo-meta-activities]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

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
 * Response shape: [{ id, name, gstRate, hsnCode }]
 * gstRate is resolved from HSN Master using the item's M_HSN code.
 */
router.get("/meta/items", async (req, res) => {
  try {
    const pool = getPool();

    // M_UOM column was added later — check existence first (same pattern as itemMaster.js)
    const colCheck = await pool.request().query(`
      SELECT COUNT(1) AS cnt FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group') AND name = N'M_UOM'
    `);
    const hasUOM = colCheck.recordset[0].cnt > 0;

    const result = await pool.request().query(`
      SELECT
        CAST(i.M_Id AS NVARCHAR(36)) AS id,
        i.M_Name                     AS name,
        i.M_HSN                      AS hsnCode,
        ${hasUOM ? "u.Id AS uomId, u.UOMName AS uomName," : "NULL AS uomId, NULL AS uomName,"}
        ISNULL(
          CASE
            WHEN ISNULL(h.HIGST, 0) > 0 THEN h.HIGST
            ELSE ISNULL(h.HCGST, 0) + ISNULL(h.HSGST, 0)
          END,
          CASE
            WHEN ISNULL(i.M_IGST, 0) > 0 THEN i.M_IGST
            ELSE ISNULL(i.M_CGST, 0) + ISNULL(i.M_SGST, 0)
          END
        ) AS gstRate
      FROM dbo.Item_Master_Group i
      LEFT JOIN dbo.HSN h       ON h.HCode    = i.M_HSN  AND h.HStatus = 1
      ${hasUOM ? "LEFT JOIN dbo.UOMMaster u ON u.UOMCode = i.M_UOM" : ""}
      WHERE (i.Parent_Id IS NOT NULL OR i.M_IdentityCode = 1)
      ORDER BY i.M_Name
    `);
    res.json(
      (result.recordset || []).map((r) => ({
        id: r.id,
        name: r.name,
        hsnCode: r.hsnCode || null,
        uomId: r.uomId ? Number(r.uomId) : null,
        uomName: r.uomName || null,
        gstRate: r.gstRate ? Number(r.gstRate) : 0,
      })),
    );
  } catch (err) {
    console.error("[wo-meta-items]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
//  WORK ORDER HEADER
// =============================================

router.get(
  "/",
  cache("work-orders", 300, { shared: true }),
  async (req, res) => {
    try {
      const pool = getPool();
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;

      const listRequest = pool
        .request()
        .input("offset", sql.Int, offset)
        .input("limit", sql.Int, limit);
      if (companyId) listRequest.input("companyId", sql.Int, companyId);

      const result = await listRequest.query(`
        SELECT h.Id, h.DocumentNumber, h.DocumentDate, h.TotalAmount, h.Status,
          h.CreatedAt, h.UpdatedAt,
          ec.name AS CompanyName, h.CompanyId,
          ep.name AS ProjectName, h.ProjectId,
          ahm.LHeadName AS ContractorName, h.ContractorId,
          ams.LHeadName AS SupplierName, h.SupplierId,
          h.Remarks, h.TermsAndConditions, h.CreatedBy, h.UpdatedBy,
          h.DocTypeId, h.DocNo, h.GST, h.BoqID,
          COALESCE(b.DocNo, b.BoqNo) AS BoqDocNo,
          td.Prefix AS DocTypePrefix, td.Description AS DocTypeDescription,
          COUNT(DISTINCT a.Id) AS ActivityCount,
          COUNT(*) OVER() AS _total
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
        LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
        LEFT JOIN dbo.AccountHeadMaster ams ON ams.LHeadId = h.SupplierId
        LEFT JOIN dbo.WorkOrderActivities a  ON a.WorkOrderHeaderId = h.Id
        LEFT JOIN dbo.TypeOfDoc         td  ON td.TypeOfDocId = h.DocTypeId
        LEFT JOIN dbo.BOQ               b   ON b.BoqID = h.BoqID
        ${companyId ? "WHERE h.CompanyId = @companyId" : ""}
        GROUP BY h.Id, h.DocumentNumber, h.DocumentDate, h.TotalAmount, h.Status,
          h.CreatedAt, h.UpdatedAt, h.CompanyId, h.ProjectId,
          h.ContractorId, h.SupplierId, h.Remarks, h.TermsAndConditions,
          h.CreatedBy, h.UpdatedBy, h.DocTypeId, h.DocNo, h.GST, h.BoqID,
          b.DocNo, b.BoqNo,
          ec.name, ep.name, ahm.LHeadName, ams.LHeadName, td.Prefix, td.Description
        ORDER BY h.CreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

      const total = result.recordset[0]?._total ?? 0;
      const data = result.recordset.map((r) => {
        const { _total, ...rest } = r;
        return { ...rest, GST: serializeGST(rest.GST) };
      });
      res.json({
        data,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error("[GET /work-orders]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.get(
  "/:id",
  cache("work-orders", 300, { shared: true }),
  async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (!id) return;
      const pool = getPool();
      const headerResult = await pool.request().input("Id", sql.Int, id).query(`
        SELECT h.*,
          ec.name AS CompanyName, ep.name AS ProjectName,
          ahm.LHeadName AS ContractorName, ams.LHeadName AS SupplierName,
          td.Prefix AS DocTypePrefix, td.Description AS DocTypeDescription,
          COALESCE(b.DocNo, b.BoqNo) AS BoqDocNo
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
        LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
        LEFT JOIN dbo.AccountHeadMaster ams ON ams.LHeadId = h.SupplierId
        LEFT JOIN dbo.TypeOfDoc         td  ON td.TypeOfDocId = h.DocTypeId
        LEFT JOIN dbo.BOQ               b   ON b.BoqID = h.BoqID
        WHERE h.Id = @Id
      `);
      if (!headerResult.recordset.length)
        return res.status(404).json({ error: "Work order not found" });

      const activitiesResult = await pool
        .request()
        .input("WorkOrderHeaderId", sql.Int, id).query(`
        SELECT a.*, ag.activity_name AS ActivityGroupName,
          act.activity_name AS ActivityName, uom.UOMName
        FROM dbo.WorkOrderActivities a
        LEFT JOIN dbo.ActivityMaster ag  ON ag.id  = a.ActivityGroupId
        LEFT JOIN dbo.ActivityMaster act ON act.id = a.ActivityId
        LEFT JOIN dbo.UOMMaster      uom ON uom.Id = a.UOMId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId ORDER BY a.Id
      `);

      const materialsResult = await pool
        .request()
        .input("WorkOrderHeaderId", sql.Int, id).query(`
        SELECT m.*, img.M_Name AS ItemName, uom.UOMName,
          CAST(m.ItemId AS NVARCHAR(36)) AS ItemIdStr,
          ISNULL(m.GSTRate, 0) AS GSTRate,
          m.SupplierIdPerLine,
          sup.LHeadName AS SupplierNamePerLine
        FROM dbo.WorkOrderActivityMaterials m
        INNER JOIN dbo.WorkOrderActivities  a   ON a.Id    = m.WorkOrderActivityId
        LEFT  JOIN dbo.Item_Master_Group    img ON img.M_Id = m.ItemId
        LEFT  JOIN dbo.UOMMaster            uom ON uom.Id  = m.UOMId
        LEFT  JOIN dbo.AccountHeadMaster    sup ON sup.LHeadId = m.SupplierIdPerLine
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

      const hdr = headerResult.recordset[0];
      res.json({ ...hdr, GST: serializeGST(hdr.GST), activities });
    } catch (err) {
      console.error("[GET /work-orders/:id]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.post("/", requirePageRight("engineering-work-order", "create"), async (req, res) => {
  const {
    CompanyId,
    ProjectId,
    DocumentNumber,
    DocumentDate,
    ContractorId,
    SupplierId,
    TotalAmount,
    Remarks,
    TermsAndConditions,
    DocTypeId,
    DocNo,
    finYear,
    GST,
    BoqID,
  } = req.body;

  // CompanyId, ProjectId, DocumentDate and ContractorId are NOT NULL columns
  // with no fallback default in the INSERT below — omitting any of them used
  // to reach the database and crash with a raw, unhandled SQL "Cannot insert
  // the value NULL" 500 (leaking internal table/column names) instead of a
  // clean validation error. Same bug class found and fixed in
  // purchaseOrders.js and expenseBooking.js during a live-DB workflow test.
  if (!CompanyId) {
    return res.status(400).json({ error: "CompanyId is required." });
  }
  if (!ProjectId) {
    return res.status(400).json({ error: "ProjectId is required." });
  }
  if (!DocumentDate) {
    return res.status(400).json({ error: "DocumentDate is required." });
  }
  if (!ContractorId) {
    return res.status(400).json({ error: "ContractorId is required." });
  }

  const gstJson = GST
    ? typeof GST === "string"
      ? GST
      : JSON.stringify(GST)
    : null;
  let transaction;
  try {
    const pool = getPool();

    // Enforce: a Work Order can only be linked to an Approved BOQ.
    if (BoqID) {
      const boqCheck = await pool
        .request()
        .input("BoqID", sql.Int, parseInt(BoqID, 10))
        .query("SELECT Status FROM dbo.BOQ WHERE BoqID = @BoqID");

      if (!boqCheck.recordset.length) {
        return res.status(404).json({ error: "Linked BOQ not found." });
      }
      const boqStatus = boqCheck.recordset[0].Status;
      if (boqStatus !== "Approved") {
        return res.status(400).json({
          error: `Cannot create Work Order: BOQ is "${boqStatus}". Only Approved BOQs can be used to raise a Work Order.`,
        });
      }
    }

    transaction = pool.transaction();
    await transaction.begin();

    let finalDocNo = DocumentNumber || DocNo || null;

    if (DocTypeId) {
      finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: parseInt(DocTypeId, 10),
        finYear,
        tableName: "WorkOrderHeader",
        docNoColumn: "DocumentNumber",
        issuedBy: req.user?.email || req.user?.name || null,
      });
    }

    // DocumentNumber is NOT NULL — same class of gap as CompanyId/ProjectId/
    // DocumentDate/ContractorId above, but this one can only be resolved
    // after lockNextDocNumber runs, so it's checked here instead.
    if (!finalDocNo) {
      await transaction.rollback();
      return res.status(400).json({
        error: "DocumentNumber is required. Select a document type or enter a document number manually.",
      });
    }

    const result = await transaction
      .request()
      .input("CompanyId", sql.Int, CompanyId)
      .input("ProjectId", sql.Int, ProjectId)
      .input("DocumentNumber", sql.NVarChar(100), finalDocNo)
      .input("DocumentDate", sql.Date, DocumentDate)
      .input("ContractorId", sql.Int, ContractorId)
      .input("SupplierId", sql.Int, SupplierId || null)
      .input("TotalAmount", sql.Decimal(18, 2), TotalAmount || 0)
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input(
        "TermsAndConditions",
        sql.NVarChar(sql.MAX),
        TermsAndConditions || null,
      )
      .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), finalDocNo)
      .input("CreatedBy", sql.NVarChar(100), req.user?.name || null)
      .input("CreatedAt", sql.DateTime, new Date())
      .input("GST", sql.NVarChar(sql.MAX), gstJson)
      .input("BoqID", sql.Int, BoqID ? parseInt(BoqID, 10) : null).query(`
        INSERT INTO dbo.WorkOrderHeader
          (CompanyId, ProjectId, DocumentNumber, DocumentDate, ContractorId, SupplierId,
           TotalAmount, Remarks, TermsAndConditions, DocTypeId, DocNo, CreatedBy, CreatedAt, GST, BoqID)
        OUTPUT INSERTED.Id
        VALUES
          (@CompanyId, @ProjectId, @DocumentNumber, @DocumentDate, @ContractorId, @SupplierId,
           @TotalAmount, @Remarks, @TermsAndConditions, @DocTypeId, @DocNo, @CreatedBy, @CreatedAt, @GST, @BoqID)
      `);
    const newId = result.recordset[0].Id;

    if (DocTypeId) {
      await backPatchRecordId(pool, sql, finalDocNo, "WorkOrderHeader", newId);
    }

    await transaction.commit();
    await bumpCacheVersion("work-orders");
    res.status(201).json({
      message: "Work order created",
      Id: newId,
      DocumentNumber: finalDocNo,
      DocNo: finalDocNo,
    });
  } catch (err) {
    try {
      if (transaction) await transaction.rollback();
    } catch (_) {
      // ignore rollback failure
    }
    console.error("[POST /work-orders]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("engineering-work-order", "edit"), async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;

  let wasApproved = false;
  let beforeSnapshot = null;
  try {
    const currentStatus = await getRecordStatus("work-orders", id);
    const allowPostApproval = await resolveAllowPostApproval(req, "work-order");
    await guardEdit("work-orders", id, { allowPostApproval });
    wasApproved = currentStatus === "Approved";
    if (wasApproved) {
      beforeSnapshot = await snapshotRow(getPool(), "dbo.WorkOrderHeader", "Id", id);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const {
    CompanyId,
    ProjectId,
    DocumentNumber,
    DocumentDate,
    ContractorId,
    SupplierId,
    TotalAmount,
    Remarks,
    TermsAndConditions,
    DocTypeId,
    DocNo,
    GST,
    BoqID,
  } = req.body;

  // Same NOT NULL columns as POST / — this UPDATE overwrites them
  // unconditionally (not a COALESCE-style partial update), so omitting any
  // of them here would null out the existing value and crash the same way
  // the create path did before the fix above.
  if (!CompanyId) {
    return res.status(400).json({ error: "CompanyId is required." });
  }
  if (!ProjectId) {
    return res.status(400).json({ error: "ProjectId is required." });
  }
  if (!DocumentNumber) {
    // Unlike POST /, this UPDATE binds DocumentNumber straight from the
    // request body with no DocNo fallback — so DocNo alone does not save it.
    return res.status(400).json({ error: "DocumentNumber is required." });
  }
  if (!DocumentDate) {
    return res.status(400).json({ error: "DocumentDate is required." });
  }
  if (!ContractorId) {
    return res.status(400).json({ error: "ContractorId is required." });
  }

  const gstJson = GST
    ? typeof GST === "string"
      ? GST
      : JSON.stringify(GST)
    : null;
  try {
    const pool = getPool();

    // Enforce: a Work Order can only be linked to an Approved BOQ.
    if (BoqID) {
      const boqCheck = await pool
        .request()
        .input("BoqID", sql.Int, parseInt(BoqID, 10))
        .query("SELECT Status FROM dbo.BOQ WHERE BoqID = @BoqID");

      if (!boqCheck.recordset.length) {
        return res.status(404).json({ error: "Linked BOQ not found." });
      }
      const boqStatus = boqCheck.recordset[0].Status;
      if (boqStatus !== "Approved") {
        return res.status(400).json({
          error: `Cannot update Work Order: BOQ is "${boqStatus}". Only Approved BOQs can be used to raise a Work Order.`,
        });
      }
    }

    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("CompanyId", sql.Int, CompanyId)
      .input("ProjectId", sql.Int, ProjectId)
      .input("DocumentNumber", sql.NVarChar(100), DocumentNumber)
      .input("DocumentDate", sql.Date, DocumentDate)
      .input("ContractorId", sql.Int, ContractorId)
      .input("SupplierId", sql.Int, SupplierId || null)
      .input("TotalAmount", sql.Decimal(18, 2), TotalAmount || 0)
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input(
        "TermsAndConditions",
        sql.NVarChar(sql.MAX),
        TermsAndConditions || null,
      )
      .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), DocNo || null)
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null)
      .input("UpdatedAt", sql.DateTime, new Date())
      .input("GST", sql.NVarChar(sql.MAX), gstJson)
      .input("BoqID", sql.Int, BoqID ? parseInt(BoqID, 10) : null).query(`
        UPDATE dbo.WorkOrderHeader SET
          CompanyId=@CompanyId, ProjectId=@ProjectId,
          DocumentNumber=@DocumentNumber, DocumentDate=@DocumentDate,
          ContractorId=@ContractorId, SupplierId=@SupplierId, TotalAmount=@TotalAmount,
          Remarks=@Remarks, TermsAndConditions=@TermsAndConditions,
          DocTypeId=@DocTypeId, DocNo=@DocNo,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt, GST=@GST, BoqID=@BoqID
        WHERE Id=@Id
      `);
    if (!checkRowsAffected(result, res, "Work order")) return;
    await bumpCacheVersion("work-orders");

    if (wasApproved && beforeSnapshot) {
      try {
        const afterSnapshot = await snapshotRow(pool, "dbo.WorkOrderHeader", "Id", id);
        await recordAmendment({
          refDocType: "work-order",
          refDocId: id,
          refDocNo: afterSnapshot?.DocumentNumber || beforeSnapshot.DocumentNumber,
          projectName: null,
          companyName: null,
          changedBy: req.user?.email || req.user?.name || null,
          before: beforeSnapshot,
          after: afterSnapshot,
        });
      } catch (logErr) {
        console.error("Amendment log error (work-order):", logErr.message);
      }
    }

    res.json({ message: "Work order updated" });
  } catch (err) {
    console.error("[PUT /work-orders/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("engineering-work-order", "delete"), async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();

    // Block deletion if this Work Order is linked to any Work Done entry.
    const wdCheck = await pool
      .request()
      .input("WorkOrderID", sql.Int, id)
      .query(
        "SELECT TOP 1 ID, DocNo FROM dbo.WorkDone WHERE WorkOrderID = @WorkOrderID",
      );
    if (wdCheck.recordset.length > 0) {
      const wd = wdCheck.recordset[0];
      return res.status(409).json({
        error: `Cannot delete: this Work Order is linked to Work Done "${wd.DocNo || wd.ID}". Remove the link from Work Done first.`,
      });
    }

    // Block deletion if this Work Order is linked to any Purchase Order.
    const poCheck = await pool
      .request()
      .input("SourceWOId", sql.Int, id)
      .query(
        "SELECT TOP 1 PurchaseOrderID, PurchaseOrderNo FROM dbo.PurchaseOrders WHERE SourceWOId = @SourceWOId",
      );
    if (poCheck.recordset.length > 0) {
      const po = poCheck.recordset[0];
      return res.status(409).json({
        error: `Cannot delete: this Work Order is linked to Purchase Order "${po.PurchaseOrderNo || po.PurchaseOrderID}". Remove the link from the Purchase Order first.`,
      });
    }

    // Block deletion if this Work Order is linked to any Expense Booking —
    // either booked directly against its Work Done entries (ESourceType =
    // 'WORK_DONE') or against its auto-generated WO-POs (ESourceType =
    // 'WO_PO'). Deleted bookings don't count.
    const ebCheck = await pool
      .request()
      .input("WorkOrderID1", sql.Int, id)
      .input("SourceWOId2", sql.Int, id).query(`
        SELECT TOP 1 Eid, EDocNo
        FROM dbo.ExpenseBooking
        WHERE EStatus != 'Deleted'
          AND (
            (ESourceType = 'WORK_DONE' AND ESourceId IN (
              SELECT ID FROM dbo.WorkDone WHERE WorkOrderID = @WorkOrderID1
            ))
            OR
            (ESourceType = 'WO_PO' AND ESourceId IN (
              SELECT PurchaseOrderID FROM dbo.PurchaseOrders WHERE SourceWOId = @SourceWOId2
            ))
          )
      `);
    if (ebCheck.recordset.length > 0) {
      const eb = ebCheck.recordset[0];
      return res.status(409).json({
        error: `Cannot delete: this Work Order is linked to Expense Booking "${eb.EDocNo || eb.Eid}". Remove the link from the Expense Booking first.`,
      });
    }

    await pool.request().input("WorkOrderHeaderId", sql.Int, id).query(`
      DELETE m FROM dbo.WorkOrderActivityMaterials m
      INNER JOIN dbo.WorkOrderActivities a ON a.Id = m.WorkOrderActivityId
      WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
    `);
    await pool
      .request()
      .input("WorkOrderHeaderId", sql.Int, id)
      .query(
        "DELETE FROM dbo.WorkOrderActivities WHERE WorkOrderHeaderId = @WorkOrderHeaderId",
      );
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.WorkOrderHeader WHERE Id = @Id");
    if (!checkRowsAffected(result, res, "Work order")) return;
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

router.get("/:id/activities", async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();
    const result = await pool.request().input("WorkOrderHeaderId", sql.Int, id)
      .query(`
        SELECT
          a.Id, a.WorkOrderHeaderId, a.ActivityGroupId, a.ActivityId,
          a.UOMId, a.Rate, a.Area, a.LabourAmount, a.MaterialAmount,
          a.GrandTotal, a.Remarks, a.DocNo,
          a.CreatedAt,
          ag.activity_name AS ActivityGroupName,
          act.activity_name AS ActivityName,
          uom.UOMName,
          COUNT(m.Id) AS MaterialCount,
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
          a.GrandTotal, a.Remarks, a.DocNo,
          a.CreatedAt,
          ag.activity_name, act.activity_name, uom.UOMName
        ORDER BY a.Id
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[GET /:id/activities]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/activities", requirePageRight("engineering-work-order", "edit"), async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;

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
    const headerRow = await pool
      .request()
      .input("HeaderId", sql.Int, id)
      .query(
        "SELECT DocumentNumber FROM dbo.WorkOrderHeader WHERE Id = @HeaderId",
      );
    const docNo = headerRow.recordset[0]?.DocumentNumber || null;

    const result = await pool
      .request()
      .input("WorkOrderHeaderId", sql.Int, id)
      .input("DocNo", sql.NVarChar(100), docNo)
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
          (WorkOrderHeaderId, DocNo, ActivityGroupId, ActivityId, UOMId,
           Rate, Area, LabourAmount, MaterialAmount, GrandTotal, Remarks, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@WorkOrderHeaderId, @DocNo, @ActivityGroupId, @ActivityId, @UOMId,
           @Rate, @Area, @LabourAmount, @MaterialAmount, @GrandTotal, @Remarks, @CreatedAt)
      `);
    await bumpCacheVersion("work-orders");
    res
      .status(201)
      .json({ message: "Activity added", Id: result.recordset[0].Id });
  } catch (err) {
    console.error("[POST /:id/activities]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id/activities/:activityId", requirePageRight("engineering-work-order", "edit"), async (req, res) => {
  if (!requireValidId(req, res)) return;

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
    if (!checkRowsAffected(result, res, "Work order activity")) return;
    await bumpCacheVersion("work-orders");
    res.json({ message: "Activity updated" });
  } catch (err) {
    console.error("[PUT /:id/activities/:actId]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/activities/:activityId", requirePageRight("engineering-work-order", "edit"), async (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const pool = getPool();
    await pool
      .request()
      .input("WorkOrderActivityId", sql.Int, req.params.activityId)
      .query(
        "DELETE FROM dbo.WorkOrderActivityMaterials WHERE WorkOrderActivityId = @WorkOrderActivityId",
      );
    const result = await pool
      .request()
      .input("Id", sql.Int, req.params.activityId)
      .query("DELETE FROM dbo.WorkOrderActivities WHERE Id = @Id");
    if (!checkRowsAffected(result, res, "Work order activity")) return;
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

router.get(
  "/:id/activities/:activityId/materials",
  cache("work-orders", 300, { shared: true }),
  async (req, res) => {
    try {
      if (!requireValidId(req, res)) return;
      const pool = getPool();
      const result = await pool
        .request()
        .input("WorkOrderActivityId", sql.Int, req.params.activityId).query(`
        SELECT m.*, img.M_Name AS ItemName, uom.UOMName,
          CAST(m.ItemId AS NVARCHAR(36)) AS ItemIdStr,
          m.SupplierIdPerLine,
          sup.LHeadName AS SupplierNamePerLine
        FROM dbo.WorkOrderActivityMaterials m
        LEFT JOIN dbo.Item_Master_Group  img ON img.M_Id   = m.ItemId
        LEFT JOIN dbo.UOMMaster          uom ON uom.Id     = m.UOMId
        LEFT JOIN dbo.AccountHeadMaster  sup ON sup.LHeadId = m.SupplierIdPerLine
        WHERE m.WorkOrderActivityId = @WorkOrderActivityId ORDER BY m.Id
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[GET materials]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST material — now includes DocNo FK (required by FK_WorkOrderActivityMaterials_DocNo)
 * DocNo is fetched from the WorkOrderHeader via the activity's WorkOrderHeaderId
 */
router.post("/:id/activities/:activityId/materials", requirePageRight("engineering-work-order", "edit"), async (req, res) => {
  if (!requireValidId(req, res)) return;

  const { ItemId, UOMId, Quantity, Rate, Remarks, SupplierIdPerLine } =
    req.body;

  // ItemId must be a non-empty UUID string
  if (!ItemId || typeof ItemId !== "string" || ItemId.trim() === "") {
    return res.status(400).json({
      error:
        "ItemId is required and must be a valid UUID from Item_Master_Group",
    });
  }

  try {
    const pool = getPool();

    // Fetch DocNo via the activity → header join
    const docNoRow = await pool
      .request()
      .input("ActivityId", sql.Int, req.params.activityId).query(`
        SELECT h.DocumentNumber AS DocNo
        FROM dbo.WorkOrderActivities a
        INNER JOIN dbo.WorkOrderHeader h ON h.Id = a.WorkOrderHeaderId
        WHERE a.Id = @ActivityId
      `);
    const docNo = docNoRow.recordset[0]?.DocNo || null;

    const result = await pool
      .request()
      .input("WorkOrderActivityId", sql.Int, req.params.activityId)
      .input("ItemId", sql.UniqueIdentifier, ItemId.trim())
      .input("UOMId", sql.Int, UOMId || null)
      .input("Quantity", sql.Decimal(18, 2), Quantity || null)
      .input("Rate", sql.Decimal(18, 2), Rate || null)
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("DocNo", sql.NVarChar(100), docNo)
      .input(
        "SupplierIdPerLine",
        sql.Int,
        SupplierIdPerLine ? parseInt(SupplierIdPerLine, 10) : null,
      )
      .input("CreatedBy", sql.NVarChar(100), req.user?.name || null)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.WorkOrderActivityMaterials
          (WorkOrderActivityId, ItemId, UOMId, Quantity, Rate, Remarks, DocNo, SupplierIdPerLine, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@WorkOrderActivityId, @ItemId, @UOMId, @Quantity, @Rate, @Remarks, @DocNo, @SupplierIdPerLine, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("work-orders");
    res
      .status(201)
      .json({ message: "Material added", Id: result.recordset[0].Id });
  } catch (err) {
    console.error("[POST materials]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put(
  "/:id/activities/:activityId/materials/:materialId",
  requirePageRight("engineering-work-order", "edit"),
  async (req, res) => {
    if (!requireValidId(req, res)) return;

    const { ItemId, UOMId, Quantity, Rate, Remarks, SupplierIdPerLine } =
      req.body;
    try {
      const pool = getPool();
      const result = await pool
        .request()
        .input("Id", sql.Int, req.params.materialId)
        .input("ItemId", sql.UniqueIdentifier, ItemId || null)
        .input("UOMId", sql.Int, UOMId || null)
        .input("Quantity", sql.Decimal(18, 2), Quantity || null)
        .input("Rate", sql.Decimal(18, 2), Rate || null)
        .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
        .input(
          "SupplierIdPerLine",
          sql.Int,
          SupplierIdPerLine ? parseInt(SupplierIdPerLine, 10) : null,
        )
        .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null)
        .input("UpdatedAt", sql.DateTime2, new Date()).query(`
        UPDATE dbo.WorkOrderActivityMaterials SET
          ItemId=@ItemId, UOMId=@UOMId, Quantity=@Quantity,
          Rate=@Rate, Remarks=@Remarks, SupplierIdPerLine=@SupplierIdPerLine,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE Id=@Id
      `);
      if (!checkRowsAffected(result, res, "Work order material")) return;
      await bumpCacheVersion("work-orders");
      res.json({ message: "Material updated" });
    } catch (err) {
      console.error("[PUT materials/:id]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

router.delete(
  "/:id/activities/:activityId/materials/:materialId",
  requirePageRight("engineering-work-order", "delete"),
  async (req, res) => {
    try {
      if (!requireValidId(req, res)) return;
      const pool = getPool();
      const result = await pool
        .request()
        .input("Id", sql.Int, req.params.materialId)
        .query("DELETE FROM dbo.WorkOrderActivityMaterials WHERE Id = @Id");
      if (!checkRowsAffected(result, res, "Work order material")) return;
      await bumpCacheVersion("work-orders");
      res.json({ message: "Material deleted" });
    } catch (err) {
      console.error("[DELETE materials/:id]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// =============================================
//  BULK SAVE  —  POST /api/work-orders/:id/save-full
// =============================================
router.post("/:id/save-full", requirePageRight("engineering-work-order", "edit"), async (req, res) => {
  const headerId = requireValidId(req, res);
  if (!headerId) return;
  const { header, activities } = req.body;

  if (!Array.isArray(activities))
    return res.status(400).json({ error: "activities must be an array" });

  function safeIntList(ids) {
    return ids
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  let tx;
  try {
    const pool = getPool();

    const currentHeader = await pool.request().input("Id", sql.Int, headerId)
      .query(`
        SELECT DocumentNumber, DocNo
        FROM dbo.WorkOrderHeader
        WHERE Id = @Id
      `);
    const existingHeader = currentHeader.recordset[0];
    if (!existingHeader) {
      return res.status(404).json({ error: "Work order not found" });
    }
    const stableDocNo =
      existingHeader.DocNo ||
      existingHeader.DocumentNumber ||
      header.DocNo ||
      header.DocumentNumber ||
      null;

    // Enforce: a Work Order can only be linked to an Approved BOQ.
    if (header.BoqID) {
      const boqCheck = await pool
        .request()
        .input("BoqID", sql.Int, parseInt(header.BoqID, 10))
        .query("SELECT Status FROM dbo.BOQ WHERE BoqID = @BoqID");

      if (!boqCheck.recordset.length) {
        return res.status(404).json({ error: "Linked BOQ not found." });
      }
      const boqStatus = boqCheck.recordset[0].Status;
      if (boqStatus !== "Approved") {
        return res.status(400).json({
          error: `Cannot save Work Order: BOQ is "${boqStatus}". Only Approved BOQs can be used to raise a Work Order.`,
        });
      }
    }

    // 1. Update header
    tx = new sql.Transaction(pool);
    await tx.begin();

    const headerUpdate = await tx
      .request()
      .input("Id", sql.Int, headerId)
      .input("CompanyId", sql.Int, header.CompanyId || null)
      .input("ProjectId", sql.Int, header.ProjectId || null)
      .input("DocumentNumber", sql.NVarChar(100), stableDocNo)
      .input("DocumentDate", sql.Date, header.DocumentDate || null)
      .input("ContractorId", sql.Int, header.ContractorId || null)
      .input("SupplierId", sql.Int, header.SupplierId || null)
      .input("TotalAmount", sql.Decimal(18, 2), header.TotalAmount || 0)
      .input("Remarks", sql.NVarChar(sql.MAX), header.Remarks || null)
      .input(
        "TermsAndConditions",
        sql.NVarChar(sql.MAX),
        header.TermsAndConditions || null,
      )
      .input(
        "DocTypeId",
        sql.Int,
        header.DocTypeId ? parseInt(header.DocTypeId, 10) : null,
      )
      .input("DocNo", sql.NVarChar(100), stableDocNo)
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null)
      .input("UpdatedAt", sql.DateTime, new Date())
      .input(
        "GST",
        sql.NVarChar(sql.MAX),
        header.GST
          ? typeof header.GST === "string"
            ? header.GST
            : JSON.stringify(header.GST)
          : null,
      )
      .input("BoqID", sql.Int, header.BoqID ? parseInt(header.BoqID, 10) : null)
      .query(`
        UPDATE dbo.WorkOrderHeader SET
          CompanyId=@CompanyId, ProjectId=@ProjectId,
          DocumentNumber=@DocumentNumber, DocumentDate=@DocumentDate,
          ContractorId=@ContractorId, SupplierId=@SupplierId, TotalAmount=@TotalAmount,
          Remarks=@Remarks, TermsAndConditions=@TermsAndConditions,
          DocTypeId=@DocTypeId, DocNo=@DocNo,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt, GST=@GST, BoqID=@BoqID
        WHERE Id=@Id
      `);
    if (!checkRowsAffected(headerUpdate, res, "Work order")) return;

    // 2. Re-fetch DocumentNumber to use as DocNo FK in every INSERT
    const docNo = stableDocNo;

    const keptActivityIds = [];

    // 3. Upsert each activity + its materials
    for (const act of activities) {
      let activityDbId = act.Id ? parseInt(act.Id, 10) : null;
      if (!Number.isFinite(activityDbId) || activityDbId <= 0)
        activityDbId = null;

      if (!activityDbId) {
        const r = await tx
          .request()
          .input("WorkOrderHeaderId", sql.Int, headerId)
          .input("DocNo", sql.NVarChar(100), docNo)
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
          .input("HsnCode", sql.NVarChar(50), act.HsnCode || null)
          .input(
            "HsnGstRate",
            sql.Decimal(5, 2),
            act.HsnGstRate != null ? Number(act.HsnGstRate) : null,
          )
          .input("HsnGstType", sql.NVarChar(20), act.HsnGstType || null)
          .input("CreatedAt", sql.DateTime2, new Date()).query(`
            INSERT INTO dbo.WorkOrderActivities
              (WorkOrderHeaderId, DocNo, ActivityGroupId, ActivityId, UOMId,
               Rate, Area, LabourAmount, MaterialAmount, GrandTotal, Remarks,
               HsnCode, HsnGstRate, HsnGstType, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES
              (@WorkOrderHeaderId, @DocNo, @ActivityGroupId, @ActivityId, @UOMId,
               @Rate, @Area, @LabourAmount, @MaterialAmount, @GrandTotal, @Remarks,
               @HsnCode, @HsnGstRate, @HsnGstType, @CreatedAt)
          `);
        activityDbId = r.recordset[0].Id;
      } else {
        await tx
          .request()
          .input("Id", sql.Int, activityDbId)
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
          .input("HsnCode", sql.NVarChar(50), act.HsnCode || null)
          .input(
            "HsnGstRate",
            sql.Decimal(5, 2),
            act.HsnGstRate != null ? Number(act.HsnGstRate) : null,
          )
          .input("HsnGstType", sql.NVarChar(20), act.HsnGstType || null)
          .input("UpdatedAt", sql.DateTime2, new Date())
          .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null).query(`
            UPDATE dbo.WorkOrderActivities SET
              ActivityGroupId=@ActivityGroupId, ActivityId=@ActivityId, UOMId=@UOMId,
              Rate=@Rate, Area=@Area, LabourAmount=@LabourAmount,
              MaterialAmount=@MaterialAmount, GrandTotal=@GrandTotal, Remarks=@Remarks,
              HsnCode=@HsnCode, HsnGstRate=@HsnGstRate, HsnGstType=@HsnGstType,
              UpdatedAt=@UpdatedAt, UpdatedBy=@UpdatedBy
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
        if (!Number.isFinite(materialDbId) || materialDbId <= 0)
          materialDbId = null;

        if (!materialDbId) {
          const r = await tx
            .request()
            .input("WorkOrderActivityId", sql.Int, activityDbId)
            .input("ItemId", sql.UniqueIdentifier, String(mat.ItemId).trim())
            .input("UOMId", sql.Int, mat.UOMId || null)
            .input("Quantity", sql.Decimal(18, 2), mat.Quantity || null)
            .input("Rate", sql.Decimal(18, 2), mat.Rate || null)
            .input("Remarks", sql.NVarChar(sql.MAX), mat.Remarks || null)
            .input(
              "GSTRate",
              sql.Decimal(5, 2),
              mat.GSTRate != null ? Number(mat.GSTRate) : 0,
            )
            // ↓ DocNo FK — required by FK_WorkOrderActivityMaterials_DocNo
            .input("DocNo", sql.NVarChar(100), docNo)
            .input(
              "SupplierIdPerLine",
              sql.Int,
              mat.SupplierIdPerLine
                ? parseInt(mat.SupplierIdPerLine, 10)
                : null,
            )
            .input("CreatedBy", sql.NVarChar(100), req.user?.name || null)
            .input("CreatedAt", sql.DateTime2, new Date()).query(`
              INSERT INTO dbo.WorkOrderActivityMaterials
                (WorkOrderActivityId, ItemId, UOMId, Quantity, Rate, Remarks, GSTRate, DocNo, SupplierIdPerLine, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id
              VALUES
                (@WorkOrderActivityId, @ItemId, @UOMId, @Quantity, @Rate, @Remarks, @GSTRate, @DocNo, @SupplierIdPerLine, @CreatedBy, @CreatedAt)
            `);
          materialDbId = r.recordset[0].Id;
        } else {
          await tx
            .request()
            .input("Id", sql.Int, materialDbId)
            .input("ItemId", sql.UniqueIdentifier, String(mat.ItemId).trim())
            .input("UOMId", sql.Int, mat.UOMId || null)
            .input("Quantity", sql.Decimal(18, 2), mat.Quantity || null)
            .input("Rate", sql.Decimal(18, 2), mat.Rate || null)
            .input("Remarks", sql.NVarChar(sql.MAX), mat.Remarks || null)
            .input(
              "GSTRate",
              sql.Decimal(5, 2),
              mat.GSTRate != null ? Number(mat.GSTRate) : 0,
            )
            .input(
              "SupplierIdPerLine",
              sql.Int,
              mat.SupplierIdPerLine
                ? parseInt(mat.SupplierIdPerLine, 10)
                : null,
            )
            .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null)
            .input("UpdatedAt", sql.DateTime2, new Date()).query(`
              UPDATE dbo.WorkOrderActivityMaterials SET
                ItemId=@ItemId, UOMId=@UOMId, Quantity=@Quantity,
                Rate=@Rate, Remarks=@Remarks, GSTRate=@GSTRate,
                SupplierIdPerLine=@SupplierIdPerLine,
                UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
              WHERE Id=@Id
            `);
        }
        keptMaterialIds.push(materialDbId);
      }

      // Delete removed materials for this activity
      const safeMaterialIds = safeIntList(keptMaterialIds);
      if (safeMaterialIds.length > 0) {
        const delMatReq = tx.request().input("WorkOrderActivityId", sql.Int, activityDbId);
        safeMaterialIds.forEach((mid, i) => delMatReq.input(`MatId${i}`, sql.Int, mid));
        await delMatReq.query(`
          DELETE FROM dbo.WorkOrderActivityMaterials
          WHERE WorkOrderActivityId = @WorkOrderActivityId
          AND Id NOT IN (${safeMaterialIds.map((_, i) => `@MatId${i}`).join(",")})
        `);
      } else {
        await tx
          .request()
          .input("WorkOrderActivityId", sql.Int, activityDbId)
          .query(
            "DELETE FROM dbo.WorkOrderActivityMaterials WHERE WorkOrderActivityId = @WorkOrderActivityId",
          );
      }
    }

    // Delete removed activities (and their materials)
    const safeActivityIds = safeIntList(keptActivityIds);
    if (safeActivityIds.length > 0) {
      const actParamNames = safeActivityIds.map((_, i) => `@ActId${i}`).join(",");

      const delActMatReq = tx.request().input("WorkOrderHeaderId", sql.Int, headerId);
      safeActivityIds.forEach((aid, i) => delActMatReq.input(`ActId${i}`, sql.Int, aid));
      await delActMatReq.query(`
        DELETE m FROM dbo.WorkOrderActivityMaterials m
        INNER JOIN dbo.WorkOrderActivities a ON a.Id = m.WorkOrderActivityId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
        AND a.Id NOT IN (${actParamNames})
      `);

      const delActReq = tx.request().input("WorkOrderHeaderId", sql.Int, headerId);
      safeActivityIds.forEach((aid, i) => delActReq.input(`ActId${i}`, sql.Int, aid));
      await delActReq.query(`
        DELETE FROM dbo.WorkOrderActivities
        WHERE WorkOrderHeaderId = @WorkOrderHeaderId
        AND Id NOT IN (${actParamNames})
      `);
    } else {
      await tx.request().input("WorkOrderHeaderId", sql.Int, headerId).query(`
        DELETE m FROM dbo.WorkOrderActivityMaterials m
        INNER JOIN dbo.WorkOrderActivities a ON a.Id = m.WorkOrderActivityId
        WHERE a.WorkOrderHeaderId = @WorkOrderHeaderId
      `);
      await tx
        .request()
        .input("WorkOrderHeaderId", sql.Int, headerId)
        .query(
          "DELETE FROM dbo.WorkOrderActivities WHERE WorkOrderHeaderId = @WorkOrderHeaderId",
        );
    }

    await tx.commit();
    await bumpCacheVersion("work-orders");

    // Auto-submit: move Draft → Pending so it appears in approval inbox
    try {
      await transition(
        "work-orders",
        headerId,
        "Pending",
        req.user?.email,
        req.user?.role,
      );
      await bumpCacheVersion("work-orders");
    } catch (e) {
      console.warn("[WO auto-submit]", e.message);
    }

    // ── Auto-create WO-POs from material items ────────────────────────────────
    // After every save-full we regenerate WO-POs for this work order:
    //   1. Delete any draft WO-POs previously auto-generated from this WO
    //   2. Re-read all materials (with item name, UOM, supplier, GST rate)
    //   3. Group by SupplierIdPerLine → one PO per supplier (null = no supplier)
    //   4. For each group: compute subtotal + GST → insert PurchaseOrder
    // Non-fatal: WO-PO failure logs but does not roll back the save.
    const createdWOPOs = [];
    try {
      const userEmail = req.user?.name || req.user?.email || "system";
      const { finYear } = req.body;

      // Resolve WO-PO doc type id — accept both 'WO-PO' (canonical) and 'WO_PO' (legacy)
      const dtRow = await pool.request().query(`
        SELECT TOP 1 TypeOfDocId FROM dbo.TypeOfDoc
        WHERE Prefix IN ('WO-PO', 'WO_PO') AND IsActive = 1
        ORDER BY TypeOfDocId
      `);
      const woPODocTypeId = dtRow.recordset[0]?.TypeOfDocId || null;

      // Re-read WO header for company/project/docno
      const hdrRow = await pool.request().input("Id", sql.Int, headerId).query(`
        SELECT Id, DocumentNumber, DocNo, CompanyId, ProjectId
        FROM dbo.WorkOrderHeader WHERE Id = @Id
      `);
      const hdr = hdrRow.recordset[0];

      // Delete previously auto-generated draft WO-POs for this WO
      await pool.request().input("SourceWOId", sql.Int, headerId).query(`
        DELETE FROM dbo.PurchaseOrderItems
        WHERE PurchaseOrderID IN (
          SELECT PurchaseOrderID FROM dbo.PurchaseOrders
          WHERE SourceWOId = @SourceWOId AND POType = 'WO_PO' AND Status = 'Draft'
        )
      `);
      await pool.request().input("SourceWOId", sql.Int, headerId).query(`
        DELETE FROM dbo.PurchaseOrders
        WHERE SourceWOId = @SourceWOId AND POType = 'WO_PO' AND Status = 'Draft'
      `);

      // Load all material lines for this WO
      const matsResult = await pool
        .request()
        .input("HeaderId", sql.Int, headerId).query(`
          SELECT
            m.ItemId,
            img.M_Name    AS ItemName,
            img.M_HSN     AS HsnCode,
            m.UOMId,
            uom.UOMName,
            m.Quantity,
            m.Rate,
            ISNULL(m.GSTRate, 0) AS GSTRate,
            m.SupplierIdPerLine,
            sup.LHeadName AS SupplierName
          FROM dbo.WorkOrderActivityMaterials m
          INNER JOIN dbo.WorkOrderActivities   a   ON a.Id      = m.WorkOrderActivityId
          LEFT  JOIN dbo.Item_Master_Group     img ON img.M_Id  = m.ItemId
          LEFT  JOIN dbo.UOMMaster             uom ON uom.Id    = m.UOMId
          LEFT  JOIN dbo.AccountHeadMaster     sup ON sup.LHeadId = m.SupplierIdPerLine
          WHERE a.WorkOrderHeaderId = @HeaderId
            AND m.ItemId IS NOT NULL
        `);

      if (matsResult.recordset.length > 0 && woPODocTypeId) {
        // Group by supplier
        const bySupplier = {};
        for (const m of matsResult.recordset) {
          const key =
            m.SupplierIdPerLine != null
              ? String(m.SupplierIdPerLine)
              : "__none__";
          if (!bySupplier[key])
            bySupplier[key] = {
              supplierId: m.SupplierIdPerLine,
              supplierName: m.SupplierName,
              lines: [],
            };
          bySupplier[key].lines.push(m);
        }

        for (const group of Object.values(bySupplier)) {
          const poItemsArr = group.lines.map((m) => {
            const qty = parseFloat(m.Quantity) || 0;
            const rate = parseFloat(m.Rate) || 0;
            const gstRate = parseFloat(m.GSTRate) || 0;
            const lineAmt = qty * rate;
            const gstAmt = parseFloat(((lineAmt * gstRate) / 100).toFixed(2));
            return {
              itemId: m.ItemId ? String(m.ItemId) : null,
              itemDescription: m.ItemName || "",
              hsnCode: m.HsnCode || null,
              quantity: qty,
              unit: m.UOMName || "",
              rate: rate,
              amount: lineAmt,
              tax: gstRate,
              gstAmount: gstAmt,
              totalWithGst: parseFloat((lineAmt + gstAmt).toFixed(2)),
            };
          });

          const subtotal = poItemsArr.reduce((s, i) => s + i.amount, 0);
          const totalGst = poItemsArr.reduce((s, i) => s + i.gstAmount, 0);
          const totalAmount = parseFloat((subtotal + totalGst).toFixed(2));

          // Pick representative GST rate for header columns (most common rate)
          const gstRateFreq = {};
          for (const i of poItemsArr)
            gstRateFreq[i.tax] = (gstRateFreq[i.tax] || 0) + 1;
          const headerGstRate = parseFloat(
            Object.entries(gstRateFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ||
              "0",
          );

          const docNo = await lockNextDocNumber(pool, sql, {
            docTypeId: woPODocTypeId,
            finYear: finYear || null,
            tableName: "PurchaseOrders",
            issuedBy: userEmail,
          });

          const insertResult = await pool
            .request()
            .input("PONo", sql.NVarChar(100), docNo)
            .input("PODate", sql.Date, new Date())
            .input("SupplierID", sql.Int, group.supplierId || null)
            .input("CompanyId", sql.Int, hdr?.CompanyId || null)
            .input("ProjectId", sql.Int, hdr?.ProjectId || null)
            .input("Subtotal", sql.Decimal(18, 2), subtotal)
            .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
            .input("GstRate", sql.Decimal(5, 2), headerGstRate)
            .input("Status", sql.NVarChar(50), "Draft")
            .input("DocTypeId", sql.Int, woPODocTypeId)
            .input("DocNo", sql.NVarChar(100), docNo)
            .input("SourceWOId", sql.Int, headerId)
            .input(
              "SourceWODocNo",
              sql.NVarChar(100),
              hdr?.DocNo || hdr?.DocumentNumber || null,
            )
            .input("POItems", sql.NVarChar(sql.MAX), JSON.stringify(poItemsArr))
            .input("CreatedBy", sql.NVarChar(100), userEmail)
            .input("CreatedAt", sql.DateTime2, new Date()).query(`
              INSERT INTO dbo.PurchaseOrders
                (PurchaseOrderNo, PODate, SupplierID, CompanyId, ProjectId,
                 SubtotalAmount, TotalAmount, GstRate, Status, DocTypeId, DocNo,
                 SourceWOId, SourceWODocNo, POItems, POType,
                 CreatedBy, CreatedAt)
              OUTPUT INSERTED.PurchaseOrderID
              VALUES
                (@PONo, @PODate, @SupplierID, @CompanyId, @ProjectId,
                 @Subtotal, @TotalAmount, @GstRate, @Status, @DocTypeId, @DocNo,
                 @SourceWOId, @SourceWODocNo, @POItems, 'WO_PO',
                 @CreatedBy, @CreatedAt)
            `);

          const newPOId = insertResult.recordset[0].PurchaseOrderID;
          await backPatchRecordId(pool, sql, docNo, "PurchaseOrders", newPOId);
          createdWOPOs.push({
            PurchaseOrderID: newPOId,
            PurchaseOrderNo: docNo,
            SupplierName: group.supplierName || null,
            subtotal,
            totalGst: parseFloat(totalGst.toFixed(2)),
            totalAmount,
            lineCount: poItemsArr.length,
          });
        }
      }
      // Always bump purchase-orders cache — deletion of old draft WO-POs also
      // changes what users see in the PO list, even when no new POs are created.
      await bumpCacheVersion("purchase-orders");
    } catch (woPoErr) {
      // Non-fatal — WO save succeeded; log and surface in response
      console.error("[POST /:id/save-full WO-PO auto-create]", woPoErr.message);
      // Still try to bump cache so stale WO-PO deletions become visible
      try {
        await bumpCacheVersion("purchase-orders");
      } catch (_) {}
    }

    res.json({
      message: "Work order saved successfully",
      activityCount: safeActivityIds.length,
      woPOs: createdWOPOs,
    });
  } catch (err) {
    if (tx) {
      try { await tx.rollback(); } catch (rbErr) {
        console.error("[POST /:id/save-full] rollback failed:", rbErr.message);
      }
    }
    console.error("[POST /:id/save-full]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Approval transitions ──────────────────────────────────────────────────────

router.put("/:id/submit", requirePageRight("engineering-work-order", "edit"), async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;
    const result = await transition(
      "work-orders",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order submitted for approval", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id/approve", async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;
    const result = await transition(
      "work-orders",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order approved", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

router.put("/:id/reject", async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;
  const { note } = req.body;
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;
    const result = await transition(
      "work-orders",
      id,
      "Rejected",
      userEmail,
      req.user?.role,
      note || null,
    );
    await bumpCacheVersion("work-orders");
    res.json({ message: "Work order rejected", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

// ── GET /:id/create-po-prefill ────────────────────────────────────────────────
// Returns WO materials shaped for the PO form (manual Material PO creation).
// The frontend navigates to PurchaseOrderMaster with this as location.state.woPrefill.
router.get("/:id/create-po-prefill", async (req, res) => {
  const headerId = parseInt(req.params.id, 10);
  if (isNaN(headerId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    const hdrRow = await pool.request().input("Id", sql.Int, headerId).query(`
      SELECT
        wh.Id, wh.DocumentNumber, wh.DocNo, wh.Status,
        wh.CompanyId, wh.ProjectId,
        ec.name AS CompanyName,
        ep.name AS ProjectName
      FROM dbo.WorkOrderHeader wh
      LEFT JOIN dbo.enterprise ec ON ec.id = wh.CompanyId
      LEFT JOIN dbo.enterprise ep ON ep.id = wh.ProjectId
      WHERE wh.Id = @Id
    `);

    if (!hdrRow.recordset.length)
      return res.status(404).json({ error: "Work order not found" });

    const hdr = hdrRow.recordset[0];

    const matsRow = await pool.request().input("HeaderId", sql.Int, headerId)
      .query(`
      SELECT
        m.Id, m.ItemId, img.M_Name AS ItemName, m.UOMId, uom.UOMName,
        m.Quantity, m.Rate, m.GSTRate,
        m.SupplierIdPerLine,
        sup.LHeadName AS SupplierName
      FROM dbo.WorkOrderActivityMaterials m
      INNER JOIN dbo.WorkOrderActivities a   ON a.Id     = m.WorkOrderActivityId
      LEFT  JOIN dbo.Item_Master_Group   img ON img.M_Id = m.ItemId
      LEFT  JOIN dbo.UOMMaster           uom ON uom.Id   = m.UOMId
      LEFT  JOIN dbo.AccountHeadMaster   sup ON sup.LHeadId = m.SupplierIdPerLine
      WHERE a.WorkOrderHeaderId = @HeaderId
        AND m.ItemId IS NOT NULL
      ORDER BY m.Id
    `);

    const items = matsRow.recordset.map((m) => ({
      itemId: m.ItemId ? String(m.ItemId) : null,
      itemDescription: m.ItemName || "",
      unit: m.UOMName || "",
      quantity: parseFloat(m.Quantity) || 0,
      rate: parseFloat(m.Rate) || 0,
      amount: (parseFloat(m.Quantity) || 0) * (parseFloat(m.Rate) || 0),
      tax: parseFloat(m.GSTRate) || 0,
      supplierName: m.SupplierName || null,
    }));

    const totalMaterialCost = items.reduce((s, i) => s + i.amount, 0);

    res.json({
      WOId: hdr.Id,
      DocumentNumber: hdr.DocumentNumber,
      DocNo: hdr.DocNo || null,
      CompanyId: hdr.CompanyId || null,
      CompanyName: hdr.CompanyName || "",
      ProjectId: hdr.ProjectId || null,
      ProjectName: hdr.ProjectName || "",
      items,
      totalMaterialCost,
    });
  } catch (err) {
    console.error("[GET /work-orders/:id/create-po-prefill]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Confirm Work Order & auto-create WO-POs ───────────────────────────────────
//
// Reads the WO-PO DocTypeId from SystemSettings key "wo_po_doc_type_id".
// Reads the threshold from SystemSettings key "wo_po_threshold" (default 1000).
// Groups qualifying materials by SupplierIdPerLine → one WO-PO per supplier.
// Materials without a SupplierIdPerLine are grouped under supplierId = null
// (they produce one combined WO-PO with no supplier set).
//
router.post("/:id/confirm", requirePageRight("engineering-work-order", "edit"), async (req, res) => {
  const headerId = requireValidId(req, res);
  if (!headerId) return;
  const userEmail = requireUserName(req, res);
  if (!userEmail) return;

  try {
    const pool = getPool();

    // 1. Check WO exists and is in a confirmable state
    const headerRow = await pool.request().input("Id", sql.Int, headerId)
      .query(`
      SELECT Id, DocumentNumber, DocNo, Status, CompanyId, ProjectId
      FROM dbo.WorkOrderHeader WHERE Id = @Id
    `);
    if (!headerRow.recordset.length)
      return res.status(404).json({ error: "Work order not found" });
    const hdr = headerRow.recordset[0];
    if (hdr.Status === "Approved")
      return res.status(400).json({ error: "Work order is already approved" });

    // 2. Read system settings
    let threshold = 1000;
    let woPODocTypeId = null;
    try {
      const settingsRow = await pool.request().query(`
        SELECT [Key], [Value] FROM dbo.SystemSettings
        WHERE [Key] IN ('wo_po_threshold', 'wo_po_doc_type_id')
      `);
      for (const row of settingsRow.recordset) {
        if (row.Key === "wo_po_threshold")
          threshold = parseFloat(row.Value) || 1000;
        if (row.Key === "wo_po_doc_type_id")
          woPODocTypeId = parseInt(row.Value, 10) || null;
      }
    } catch {
      // SystemSettings may not exist yet; use defaults
    }

    // 3. Load all materials for this WO (with supplier + item info)
    const matsRow = await pool.request().input("HeaderId", sql.Int, headerId)
      .query(`
      SELECT
        m.Id, m.ItemId, img.M_Name AS ItemName, m.UOMId, uom.UOMName,
        m.Quantity, m.Rate, m.GSTRate,
        m.SupplierIdPerLine,
        sup.LHeadName AS SupplierName
      FROM dbo.WorkOrderActivityMaterials m
      INNER JOIN dbo.WorkOrderActivities a   ON a.Id     = m.WorkOrderActivityId
      LEFT  JOIN dbo.Item_Master_Group   img ON img.M_Id = m.ItemId
      LEFT  JOIN dbo.UOMMaster           uom ON uom.Id   = m.UOMId
      LEFT  JOIN dbo.AccountHeadMaster   sup ON sup.LHeadId = m.SupplierIdPerLine
      WHERE a.WorkOrderHeaderId = @HeaderId
        AND m.ItemId IS NOT NULL
    `);

    const materials = matsRow.recordset;

    // 4. Calculate total material cost
    const totalMaterialCost = materials.reduce((sum, m) => {
      return sum + (parseFloat(m.Quantity) || 0) * (parseFloat(m.Rate) || 0);
    }, 0);

    const createdPOs = [];

    // 5. Only auto-create WO-POs if threshold is met
    if (totalMaterialCost >= threshold && woPODocTypeId) {
      // Group by SupplierIdPerLine (null = no supplier)
      const bySupplier = {};
      for (const m of materials) {
        const key =
          m.SupplierIdPerLine != null
            ? String(m.SupplierIdPerLine)
            : "__none__";
        if (!bySupplier[key])
          bySupplier[key] = {
            supplierId: m.SupplierIdPerLine,
            supplierName: m.SupplierName,
            lines: [],
          };
        bySupplier[key].lines.push(m);
      }

      for (const group of Object.values(bySupplier)) {
        // Compute totals for this supplier group
        const subtotal = group.lines.reduce(
          (s, m) =>
            s + (parseFloat(m.Quantity) || 0) * (parseFloat(m.Rate) || 0),
          0,
        );
        const poItemsArr = group.lines.map((m, i) => ({
          itemId: m.ItemId ? String(m.ItemId) : null,
          itemDescription: m.ItemName || "",
          quantity: parseFloat(m.Quantity) || 0,
          unit: m.UOMName || "",
          rate: parseFloat(m.Rate) || 0,
          amount: (parseFloat(m.Quantity) || 0) * (parseFloat(m.Rate) || 0),
          tax: parseFloat(m.GSTRate) || 0,
        }));

        // Lock a doc number for this WO-PO
        const { finYear } = req.body;
        const docNo = await lockNextDocNumber(pool, sql, {
          docTypeId: woPODocTypeId,
          finYear: finYear || null,
          tableName: "PurchaseOrders",
          issuedBy: userEmail,
        });

        const insertResult = await pool
          .request()
          .input("PONo", sql.NVarChar(100), docNo)
          .input("PODate", sql.Date, new Date())
          .input("SupplierID", sql.Int, group.supplierId || null)
          .input("CompanyId", sql.Int, hdr.CompanyId || null)
          .input("ProjectId", sql.Int, hdr.ProjectId || null)
          .input("Subtotal", sql.Decimal(18, 2), subtotal)
          .input("Total", sql.Decimal(18, 2), subtotal)
          .input("Status", sql.NVarChar(50), "Draft")
          .input("DocTypeId", sql.Int, woPODocTypeId)
          .input("DocNo", sql.NVarChar(100), docNo)
          .input("SourceWOId", sql.Int, headerId)
          .input(
            "SourceWODocNo",
            sql.NVarChar(100),
            hdr.DocNo || hdr.DocumentNumber || null,
          )
          .input("POItems", sql.NVarChar(sql.MAX), JSON.stringify(poItemsArr))
          .input("CreatedBy", sql.NVarChar(100), userEmail)
          .input("CreatedAt", sql.DateTime2, new Date()).query(`
            INSERT INTO dbo.PurchaseOrders
              (PurchaseOrderNo, PODate, SupplierID, CompanyId, ProjectId,
               SubtotalAmount, TotalAmount, Status, DocTypeId, DocNo,
               SourceWOId, SourceWODocNo, POItems, CreatedBy, CreatedAt)
            OUTPUT INSERTED.PurchaseOrderID
            VALUES
              (@PONo, @PODate, @SupplierID, @CompanyId, @ProjectId,
               @Subtotal, @Total, @Status, @DocTypeId, @DocNo,
               @SourceWOId, @SourceWODocNo, @POItems, @CreatedBy, @CreatedAt)
          `);

        const newPOId = insertResult.recordset[0].PurchaseOrderID;
        await backPatchRecordId(pool, sql, docNo, "PurchaseOrders", newPOId);
        createdPOs.push({
          PurchaseOrderID: newPOId,
          PurchaseOrderNo: docNo,
          SupplierName: group.supplierName || null,
        });
      }
    }

    // 6. Bump both caches
    await bumpCacheVersion("work-orders");
    await bumpCacheVersion("purchase-orders");

    res.json({
      message: "Work order confirmed",
      totalMaterialCost,
      threshold,
      thresholdMet: totalMaterialCost >= threshold,
      woPOsCreated: createdPOs.length,
      purchaseOrders: createdPOs,
    });
  } catch (err) {
    console.error("[POST /:id/confirm]", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
