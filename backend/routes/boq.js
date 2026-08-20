const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { transition, guardEdit, getRecordStatus } = require("../services/approvalService");
const { snapshotRow, recordAmendment } = require("../services/amendmentLog");
const { resolveAllowPostApproval } = require("../middleware/permissions");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

router.use(checkPermissionForMethod("Engineering", "BOQ"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

const parseJson = (val) => {
  if (!val) return null;
  return typeof val === "string" ? val : JSON.stringify(val);
};

const safeJson = (str) => {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

// Compute total from both Items and Activities (Quantity * Rate)
const computeTotal = (items, activities) => {
  let sum = 0;
  if (Array.isArray(items)) {
    sum += items.reduce(
      (s, it) =>
        s + (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0),
      0,
    );
  }
  if (Array.isArray(activities)) {
    sum += activities.reduce(
      (s, ac) =>
        s + (parseFloat(ac.quantity) || 0) * (parseFloat(ac.rate) || 0),
      0,
    );
  }
  return sum;
};

// Build the UOM-id lookup map: name → id
const buildUomMap = async (pool) => {
  try {
    const r = await pool
      .request()
      .query("SELECT Id, UOMName FROM dbo.UOMMaster WHERE IsActive = 1");
    const map = {};
    for (const row of r.recordset) map[row.UOMName] = row.Id;
    return map;
  } catch {
    return {};
  }
};

const syncBoqItems = async (transaction, sqlRef, boqID, items, uomMap) => {
  if (!Array.isArray(items) || items.length === 0) return;

  await transaction
    .request()
    .input("BoqID", sqlRef.Int, boqID)
    .query("DELETE FROM dbo.BoqItems WHERE BoqID = @BoqID");

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const itemName = String(it.itemDescription || it.itemName || "").substring(
      0,
      255,
    );
    if (!itemName) continue;

    const qty = parseFloat(it.quantity) || 0;
    const rate = parseFloat(it.rate) || 0;
    const amount = parseFloat(it.amount) || qty * rate;
    const uomName = String(it.unit || it.uomName || it.uom || "").substring(
      0,
      50,
    );
    const uomId = uomMap[uomName] || null;

    await transaction
      .request()
      .input("BoqID", sqlRef.Int, boqID)
      .input("ItemId", sqlRef.NVarChar(100), it.itemId || null)
      .input("ItemName", sqlRef.NVarChar(255), itemName)
      .input("ItemCode", sqlRef.NVarChar(50), it.itemCode || null)
      .input("Description", sqlRef.NVarChar(sqlRef.MAX), it.description || null)
      .input("Quantity", sqlRef.Decimal(18, 4), qty)
      .input("UomId", sqlRef.Int, uomId)
      .input("UomName", sqlRef.NVarChar(50), uomName || null)
      .input("Rate", sqlRef.Decimal(18, 4), rate)
      .input("TaxPct", sqlRef.Decimal(5, 2), parseFloat(it.tax) || 0)
      .input("LineAmount", sqlRef.Decimal(18, 2), amount)
      .input("SortOrder", sqlRef.Int, i).query(`
        INSERT INTO dbo.BoqItems
          (BoqID, ItemId, ItemName, ItemCode, Description,
           Quantity, UomId, UomName, Rate, TaxPct, LineAmount, SortOrder)
        VALUES
          (@BoqID, @ItemId, @ItemName, @ItemCode, @Description,
           @Quantity, @UomId, @UomName, @Rate, @TaxPct, @LineAmount, @SortOrder)
      `);
  }
};

const syncBoqActivities = async (
  transaction,
  sqlRef,
  boqID,
  activities,
  uomMap,
) => {
  if (!Array.isArray(activities) || activities.length === 0) return;

  await transaction
    .request()
    .input("BoqID", sqlRef.Int, boqID)
    .query("DELETE FROM dbo.BoqActivities WHERE BoqID = @BoqID");

  for (let i = 0; i < activities.length; i++) {
    const ac = activities[i];
    const activityName = String(
      ac.activityName || ac.description || "",
    ).substring(0, 255);
    if (!activityName) continue;

    const qty = parseFloat(ac.quantity) || 0;
    const rate = parseFloat(ac.rate) || 0;
    const amount = parseFloat(ac.amount) || qty * rate;
    const uomName = String(ac.unit || ac.uomName || ac.uom || "").substring(
      0,
      50,
    );
    const uomId = uomMap[uomName] || null;

    await transaction
      .request()
      .input("BoqID", sqlRef.Int, boqID)
      .input("ActivityId", sqlRef.NVarChar(100), ac.activityId || null)
      .input("ActivityName", sqlRef.NVarChar(255), activityName)
      .input("ActivityCode", sqlRef.NVarChar(50), ac.activityCode || null)
      .input("Description", sqlRef.NVarChar(sqlRef.MAX), ac.description || null)
      .input("Quantity", sqlRef.Decimal(18, 4), qty)
      .input("UomId", sqlRef.Int, uomId)
      .input("UomName", sqlRef.NVarChar(50), uomName || null)
      .input("Rate", sqlRef.Decimal(18, 4), rate)
      .input("TaxPct", sqlRef.Decimal(5, 2), parseFloat(ac.tax) || 0)
      .input("LineAmount", sqlRef.Decimal(18, 2), amount)
      .input("SortOrder", sqlRef.Int, i).query(`
        INSERT INTO dbo.BoqActivities
          (BoqID, ActivityId, ActivityName, ActivityCode, Description,
           Quantity, UomId, UomName, Rate, TaxPct, LineAmount, SortOrder)
        VALUES
          (@BoqID, @ActivityId, @ActivityName, @ActivityCode, @Description,
           @Quantity, @UomId, @UomName, @Rate, @TaxPct, @LineAmount, @SortOrder)
      `);
  }
};

// ── GET /  (List with Pagination) ────────────────────────────────────────────
router.get("/", cache("boq", 300), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId, 10) || null;
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").toString().trim();
    const status = (req.query.status || "").toString().trim();
    // Always scope to the requested company — no cross-company list allowed
    const where = ["b.CompanyId = @companyId"];

    if (search) {
      where.push(`(
        b.BoqNo LIKE @search OR
        b.DocNo LIKE @search OR
        co.name LIKE @search OR
        pr.name LIKE @search OR
        b.Description LIKE @search
      )`);
    }

    if (status && status !== "All") {
      where.push("b.Status = @status");
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const bindFilters = (request) => {
      request.input("companyId", sql.Int, companyId);
      if (search) request.input("search", sql.NVarChar(100), `%${search}%`);
      if (status && status !== "All") {
        request.input("status", sql.NVarChar(50), status);
      }
      return request;
    };

    const countResult = await bindFilters(pool.request()).query(`
      SELECT COUNT(*) AS total
      FROM dbo.BOQ b
      LEFT JOIN dbo.enterprise co ON co.id = b.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
      ${whereSql}
    `);

    const total = parseInt(countResult.recordset[0].total);

    const result = await bindFilters(pool.request())
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        SELECT
          b.BoqID,
          b.BoqNo,
          b.BoqDate,
          b.CompanyId,
          co.name AS CompanyName,
          b.ProjectId,
          pr.name AS ProjectName,
          b.Description,
          b.TotalAmount,
          b.Status,
          b.Remarks,
          b.CreatedBy,
          b.CreatedAt,
          b.DocTypeId,
          b.DocNo,
          td.Prefix AS DocTypePrefix,
          td.Description AS DocTypeDescription
        FROM dbo.BOQ b
        LEFT JOIN dbo.enterprise co ON co.id = b.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
        LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = b.DocTypeId
        ${whereSql}
        ORDER BY b.BoqID DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GET BOQ error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("BoqID", sql.Int, parseInt(req.params.id, 10)).query(`
        SELECT
          b.*,
          co.name AS CompanyName,
          pr.name AS ProjectName,
          td.Prefix AS DocTypePrefix,
          td.Description AS DocTypeDescription
        FROM dbo.BOQ b
        LEFT JOIN dbo.enterprise co ON co.id = b.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
        LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = b.DocTypeId
        WHERE b.BoqID = @BoqID
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "BOQ not found" });

    const boq = result.recordset[0];

    const itemsResult = await pool
      .request()
      .input("BoqID", sql.Int, boq.BoqID)
      .query(
        "SELECT * FROM dbo.BoqItems WHERE BoqID = @BoqID ORDER BY SortOrder",
      );

    const activitiesResult = await pool
      .request()
      .input("BoqID", sql.Int, boq.BoqID)
      .query(
        "SELECT * FROM dbo.BoqActivities WHERE BoqID = @BoqID ORDER BY SortOrder",
      );

    res.json({
      ...boq,
      BoqItems:
        itemsResult.recordset.length > 0
          ? itemsResult.recordset
          : (safeJson(boq.BoqItems) ?? []),
      BoqActivities:
        activitiesResult.recordset.length > 0
          ? activitiesResult.recordset
          : (safeJson(boq.BoqActivities) ?? []),
    });
  } catch (err) {
    console.error("GET BOQ by id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /  (Create) ──────────────────────────────────────────────────────────
router.post("/", requirePageRight("boq", "create"), async (req, res) => {
  const {
    BoqNo: boqNoFromClient,
    BoqDate,
    CompanyId,
    ProjectId,
    Description,
    BoqItems,
    BoqActivities,
    Status,
    Remarks,
    DocTypeId,
    finYear,
  } = req.body;

  const itemsArray = Array.isArray(BoqItems)
    ? BoqItems
    : (safeJson(parseJson(BoqItems)) ?? []);
  const activitiesArray = Array.isArray(BoqActivities)
    ? BoqActivities
    : (safeJson(parseJson(BoqActivities)) ?? []);
  const itemsJson = JSON.stringify(itemsArray);
  const activitiesJson = JSON.stringify(activitiesArray);
  const totalAmount = computeTotal(itemsArray, activitiesArray);

  let transaction;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const uomMap = await buildUomMap(pool);
    transaction = pool.transaction();
    await transaction.begin();

    let finalDocNo = null;
    if (DocTypeId) {
      finalDocNo = await lockNextDocNumber(transaction, sql, {
        docTypeId: parseInt(DocTypeId, 10),
        finYear,
        tableName: "BOQ",
        issuedBy: userEmail,
      });
    } else {
      finalDocNo = boqNoFromClient || null;
    }

    if (!finalDocNo) {
      await transaction.rollback();
      return res.status(400).json({
        error: "BoqNo is required. Select a document type or enter manually.",
      });
    }

    const result = await transaction
      .request()
      .input("BoqNo", sql.NVarChar(100), finalDocNo)
      .input("BoqDate", sql.Date, BoqDate || null)
      .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId, 10) : null)
      .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId, 10) : null)
      .input("Description", sql.NVarChar(sql.MAX), Description || null)
      .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
      .input("Status", sql.NVarChar(50), Status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), finalDocNo)
      .input("CreatedBy", sql.NVarChar(100), userEmail)
      .input("CreatedAt", sql.DateTime2, new Date())
      .input("BoqItems", sql.NVarChar(sql.MAX), itemsJson)
      .input("BoqActivities", sql.NVarChar(sql.MAX), activitiesJson).query(`
        INSERT INTO dbo.BOQ (
          BoqNo, BoqDate, CompanyId, ProjectId, Description,
          TotalAmount, Status, Remarks, DocTypeId, DocNo,
          CreatedBy, CreatedAt, BoqItems, BoqActivities
        )
        OUTPUT INSERTED.BoqID
        VALUES (
          @BoqNo, @BoqDate, @CompanyId, @ProjectId, @Description,
          @TotalAmount, @Status, @Remarks, @DocTypeId, @DocNo,
          @CreatedBy, @CreatedAt, @BoqItems, @BoqActivities
        )
      `);

    const newId = result.recordset[0].BoqID;

    await syncBoqItems(transaction, sql, newId, itemsArray, uomMap);
    await syncBoqActivities(transaction, sql, newId, activitiesArray, uomMap);

    if (DocTypeId) {
      await backPatchRecordId(transaction, sql, finalDocNo, "BOQ", newId);
    }

    await transaction.commit();
    await bumpCacheVersion("boq");

    // Auto-submit: move Draft → Pending so it appears in approval inbox
    try {
      await transition(
        "boq",
        newId,
        "Pending",
        req.user?.email,
        req.user?.role,
      );
      await bumpCacheVersion("boq");
    } catch (e) {
      console.warn("[BOQ auto-submit]", e.message);
    }

    res.status(201).json({
      message: "BOQ created successfully",
      BoqID: newId,
      BoqNo: finalDocNo,
    });
  } catch (err) {
    try {
      if (transaction) await transaction.rollback();
    } catch (_) {}
    console.error("POST BOQ error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id  (Update) ────────────────────────────────────────────────────────
router.put("/:id", requirePageRight("boq", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const {
    BoqNo,
    BoqDate,
    CompanyId,
    ProjectId,
    Description,
    BoqItems,
    BoqActivities,
    Status,
    Remarks,
    DocTypeId,
    DocNo,
  } = req.body;

  const itemsArray = Array.isArray(BoqItems)
    ? BoqItems
    : (safeJson(parseJson(BoqItems)) ?? []);
  const activitiesArray = Array.isArray(BoqActivities)
    ? BoqActivities
    : (safeJson(parseJson(BoqActivities)) ?? []);
  const itemsJson = JSON.stringify(itemsArray);
  const activitiesJson = JSON.stringify(activitiesArray);
  const totalAmount = computeTotal(itemsArray, activitiesArray);

  let transaction;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const currentStatus = await getRecordStatus("boq", id);
    const allowPostApproval = await resolveAllowPostApproval(req, "boq");
    await guardEdit("boq", id, { allowPostApproval });
    const wasApproved = currentStatus === "Approved";

    const pool = getPool();
    const beforeSnapshot = wasApproved
      ? await snapshotRow(pool, "dbo.BOQ", "BoqID", id)
      : null;
    const uomMap = await buildUomMap(pool);
    transaction = pool.transaction();
    await transaction.begin();

    const result = await transaction
      .request()
      .input("BoqID", sql.Int, id)
      .input("BoqNo", sql.NVarChar(100), BoqNo || null)
      .input("BoqDate", sql.Date, BoqDate || null)
      .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId, 10) : null)
      .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId, 10) : null)
      .input("Description", sql.NVarChar(sql.MAX), Description || null)
      .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
      .input("Status", sql.NVarChar(50), Status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), DocNo || null)
      .input("UpdatedBy", sql.NVarChar(100), userEmail)
      .input("UpdatedAt", sql.DateTime2, new Date())
      .input("BoqItems", sql.NVarChar(sql.MAX), itemsJson)
      .input("BoqActivities", sql.NVarChar(sql.MAX), activitiesJson).query(`
        UPDATE dbo.BOQ SET
          BoqNo = @BoqNo, BoqDate = @BoqDate, CompanyId = @CompanyId,
          ProjectId = @ProjectId, Description = @Description, TotalAmount = @TotalAmount,
          Status = @Status, Remarks = @Remarks, DocTypeId = @DocTypeId,
          DocNo = @DocNo, UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt,
          BoqItems = @BoqItems, BoqActivities = @BoqActivities
        WHERE BoqID = @BoqID
      `);

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "BOQ not found" });
    }

    await syncBoqItems(transaction, sql, id, itemsArray, uomMap);
    await syncBoqActivities(transaction, sql, id, activitiesArray, uomMap);

    await transaction.commit();
    await bumpCacheVersion("boq");

    // Re-submit to Pending if record was reverted to Draft (e.g. after edit)
    try {
      const currentStatus = await (async () => {
        const pool = getPool();
        const r = await pool
          .request()
          .input("id", sql.Int, id)
          .query("SELECT Status FROM dbo.BOQ WHERE BoqID = @id");
        return r.recordset[0]?.Status;
      })();
      if (currentStatus === "Draft" || currentStatus === "Rejected") {
        await transition("boq", id, "Pending", req.user?.email, req.user?.role);
        await bumpCacheVersion("boq");
      }
    } catch (e) {
      console.warn("[BOQ auto-submit on update]", e.message);
    }

    if (wasApproved && beforeSnapshot) {
      try {
        const afterSnapshot = await snapshotRow(pool, "dbo.BOQ", "BoqID", id);
        await recordAmendment({
          refDocType: "boq",
          refDocId: id,
          refDocNo: afterSnapshot?.DocNo || afterSnapshot?.BoqNo || beforeSnapshot.DocNo || beforeSnapshot.BoqNo,
          projectName: null,
          companyName: null,
          changedBy: userEmail,
          before: beforeSnapshot,
          after: afterSnapshot,
        });
      } catch (logErr) {
        console.error("Amendment log error (boq):", logErr.message);
      }
    }

    res.json({ message: "BOQ updated successfully" });
  } catch (err) {
    try {
      if (transaction) await transaction.rollback();
    } catch (_) {}
    console.error("PUT BOQ error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("boq", "delete"), async (req, res) => {
  let transaction;
  try {
    const boqID = parseInt(req.params.id, 10);
    const pool = getPool();

    // Block deletion if this BOQ is linked to any Work Order
    const woCheck = await pool
      .request()
      .input("BoqID", sql.Int, boqID)
      .query(
        "SELECT TOP 1 Id, DocumentNumber FROM dbo.WorkOrderHeader WHERE BoqID = @BoqID",
      );
    if (woCheck.recordset.length > 0) {
      const wo = woCheck.recordset[0];
      return res.status(409).json({
        error: `Cannot delete: this BOQ is linked to Work Order "${wo.DocumentNumber || wo.Id}". Remove the link from the Work Order first.`,
      });
    }

    transaction = pool.transaction();
    await transaction.begin();

    await transaction
      .request()
      .input("BoqID", sql.Int, boqID)
      .query("DELETE FROM dbo.BoqItems WHERE BoqID = @BoqID");

    await transaction
      .request()
      .input("BoqID", sql.Int, boqID)
      .query("DELETE FROM dbo.BoqActivities WHERE BoqID = @BoqID");

    const result = await transaction
      .request()
      .input("BoqID", sql.Int, boqID)
      .query("DELETE FROM dbo.BOQ WHERE BoqID = @BoqID");

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "BOQ not found" });
    }

    await transaction.commit();

    await bumpCacheVersion("boq");
    res.json({ message: "BOQ deleted successfully" });
  } catch (err) {
    try {
      if (transaction) await transaction.rollback();
    } catch (_) {}
    console.error("DELETE BOQ error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Approval routes ───────────────────────────────────────────────────────────

// Unified transition endpoint used by the BOQ preview panel
router.post("/:id/transition", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { action } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const targetStatus =
      action === "submit" ? "Pending" :
      action === "approve" ? "Approved" :
      action === "reject" ? "Rejected" : null;
    if (!targetStatus) return res.status(400).json({ error: `Unknown action: ${action}` });
    const result = await transition("boq", id, targetStatus, userEmail, req.user?.role, req.body.note || null);
    await bumpCacheVersion("boq");
    res.json({ message: `BOQ ${action}d`, ...result });
  } catch (err) {
    res.status(err.message.includes("not authorized") ? 403 : 400).json({ error: err.message });
  }
});

router.put("/:id/submit", requirePageRight("boq", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition(
      "boq",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("boq");
    res.json({ message: "BOQ submitted for approval", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition(
      "boq",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("boq");
    res.json({ message: "BOQ approved", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition(
      "boq",
      id,
      "Rejected",
      userEmail,
      req.user?.role,
      note || null,
    );
    await bumpCacheVersion("boq");
    res.json({ message: "BOQ rejected", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

module.exports = router;
