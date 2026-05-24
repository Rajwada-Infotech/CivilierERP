"use strict";

const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { transition, guardEdit } = require("../services/approvalService");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

const WORK_DONE_TABLE = "WorkDone";
const WORK_DONE_CACHE = "engineering-work-done";

router.use(checkPermissionForMethod("Engineering", "WorkDone"));

const tableExists = {
  [WORK_DONE_TABLE]: null,
  BOQ: null,
  WorkOrderHeader: null,
};

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({
      error: "User email missing from session. Cannot audit this action.",
    });
    return null;
  }
  return email;
};

const toIntOrNull = (value) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const hasTable = async (pool, tableName) => {
  // Only cache positive (true) results — a missing table could be created at any time
  if (tableExists[tableName] === true) return true;
  const result = await pool
    .request()
    .input("tableName", sql.NVarChar(128), tableName).query(`
      SELECT COUNT(1) AS cnt
      FROM sys.tables
      WHERE object_id = OBJECT_ID(N'dbo.' + @tableName)
    `);
  const exists = result.recordset[0]?.cnt > 0;
  if (exists) tableExists[tableName] = true;
  return exists;
};

const ensureWorkDoneTable = async (pool, res) => {
  if (await hasTable(pool, WORK_DONE_TABLE)) return true;
  res.status(500).json({
    error:
      "dbo.WorkDone is missing. Run backend/migrations/053-create-work-done.sql in SSMS.",
  });
  return false;
};

const selectWorkDoneSql = `
  SELECT
    wd.ID,
    wd.DocNo,
    wd.DocTypeId,
    wd.DocDate,
    wd.CompanyId,
    co.name AS CompanyName,
    wd.ProjectId,
    pr.name AS ProjectName,
    wd.FinYear,
    wd.SupplierId,
    sup.LHeadName AS SupplierName,
    wd.WorkOrderID,
    woh.DocumentNumber AS WorkOrderNo,
    ctr.LHeadName AS ContractorName,
    wd.PeriodFrom,
    wd.PeriodTo,
    wd.DescriptionOfWork,
    wd.QuantityDone,
    wd.Unit,
    wd.RatePerUnit,
    wd.GrossAmount,
    wd.Deductions,
    wd.CertifiedAmount,
    wd.Status,
    wd.Remarks,
    wd.CreatedAt,
    wd.CreatedBy,
    wd.UpdatedAt,
    wd.UpdatedBy
  FROM dbo.WorkDone wd
  LEFT JOIN dbo.enterprise co ON co.id = wd.CompanyId
  LEFT JOIN dbo.enterprise pr ON pr.id = wd.ProjectId
  LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = wd.SupplierId
  LEFT JOIN dbo.WorkOrderHeader woh ON woh.Id = wd.WorkOrderID
  LEFT JOIN dbo.AccountHeadMaster ctr ON ctr.LHeadId = woh.ContractorId
`;

router.get(
  "/dashboard",
  cache("engineering-dashboard", 120),
  async (req, res) => {
    try {
      const pool = getPool();
      const hasWorkDone = await hasTable(pool, WORK_DONE_TABLE);
      const hasBOQ = await hasTable(pool, "BOQ");
      const hasWO = await hasTable(pool, "WorkOrderHeader");

      const [
        workOrdersResult,
        recentWOsResult,
        woStatusResult,
        boqResult,
        recentBOQsResult,
        workDoneResult,
        recentWorkDoneResult,
        workDoneStatusResult,
        projectsResult,
      ] = await Promise.all([
        hasWO
          ? pool.request().query(`
            SELECT
              COUNT(1) AS total,
              SUM(CASE WHEN ISNULL(h.Status, 'Draft') IN ('Draft', 'Pending', 'Open', 'In Progress') THEN 1 ELSE 0 END) AS openCount,
              SUM(CASE WHEN h.DocumentDate >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) THEN 1 ELSE 0 END) AS thisMonth,
              ISNULL(SUM(h.TotalAmount), 0) AS totalValue
            FROM dbo.WorkOrderHeader h
            LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = h.DocTypeId
            WHERE td.ModuleTag = 'WO'
               OR h.DocTypeId IS NULL
          `)
          : Promise.resolve({ recordset: [{}] }),
        hasWO
          ? pool.request().query(`
            SELECT TOP 6
              h.Id,
              COALESCE(h.DocNo, h.DocumentNumber) AS DocNo,
              ahm.LHeadName AS ContractorName,
              h.Status,
              h.TotalAmount
            FROM dbo.WorkOrderHeader h
            LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
            LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = h.DocTypeId
            WHERE td.ModuleTag = 'WO'
               OR h.DocTypeId IS NULL
            ORDER BY ISNULL(h.UpdatedAt, h.CreatedAt) DESC
          `)
          : Promise.resolve({ recordset: [] }),
        hasWO
          ? pool.request().query(`
            SELECT ISNULL(h.Status, 'Draft') AS Status, COUNT(1) AS Count, ISNULL(SUM(h.TotalAmount), 0) AS TotalValue
            FROM dbo.WorkOrderHeader h
            LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = h.DocTypeId
            WHERE td.ModuleTag = 'WO'
               OR h.DocTypeId IS NULL
            GROUP BY ISNULL(h.Status, 'Draft')
          `)
          : Promise.resolve({ recordset: [] }),
        hasBOQ
          ? pool.request().query(`
            SELECT
              COUNT(1) AS total,
              SUM(CASE WHEN Status = 'Approved' THEN 1 ELSE 0 END) AS approved,
              ISNULL(SUM(TotalAmount), 0) AS totalValue
            FROM dbo.BOQ
          `)
          : Promise.resolve({ recordset: [{}] }),
        hasBOQ
          ? pool.request().query(`
            SELECT TOP 6
              b.BoqID,
              COALESCE(b.DocNo, b.BoqNo) AS DocNo,
              pr.name AS ProjectName,
              b.Status,
              b.TotalAmount AS TotalValue
            FROM dbo.BOQ b
            LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
            ORDER BY ISNULL(b.UpdatedAt, b.CreatedAt) DESC
          `)
          : Promise.resolve({ recordset: [] }),
        hasWorkDone
          ? pool.request().query(`
            SELECT
              COUNT(1) AS total,
              SUM(CASE WHEN Status = 'Pending' THEN 1 ELSE 0 END) AS pending,
              ISNULL(SUM(CertifiedAmount), 0) AS certifiedAmount
            FROM dbo.WorkDone
          `)
          : Promise.resolve({ recordset: [{}] }),
        hasWorkDone
          ? pool.request().query(`
            SELECT TOP 6
              wd.ID,
              wd.DocNo,
              COALESCE(woh.DocNo, woh.DocumentNumber) AS WorkOrderNo,
              wd.Status,
              wd.CertifiedAmount
            FROM dbo.WorkDone wd
            LEFT JOIN dbo.WorkOrderHeader woh ON woh.Id = wd.WorkOrderID
            ORDER BY ISNULL(wd.UpdatedAt, wd.CreatedAt) DESC
          `)
          : Promise.resolve({ recordset: [] }),
        hasWorkDone
          ? pool.request().query(`
            SELECT ISNULL(Status, 'Draft') AS Status, COUNT(1) AS Count, ISNULL(SUM(CertifiedAmount), 0) AS TotalValue
            FROM dbo.WorkDone
            GROUP BY ISNULL(Status, 'Draft')
          `)
          : Promise.resolve({ recordset: [] }),
        pool.request().query(`
          SELECT
            COUNT(1) AS total,
            SUM(CASE WHEN ISNULL(discontinue, 0) = 0 THEN 1 ELSE 0 END) AS active
          FROM dbo.enterprise
          WHERE business_type = 'P'
        `),
      ]);

      const wo = workOrdersResult.recordset[0] || {};
      const boq = boqResult.recordset[0] || {};
      const wd = workDoneResult.recordset[0] || {};
      const projects = projectsResult.recordset[0] || {};

      res.json({
        workOrders: {
          total: Number(wo.total || 0),
          open: Number(wo.openCount || 0),
          thisMonth: Number(wo.thisMonth || 0),
          totalValue: Number(wo.totalValue || 0),
        },
        boq: {
          total: Number(boq.total || 0),
          approved: Number(boq.approved || 0),
          totalValue: Number(boq.totalValue || 0),
        },
        workDone: {
          total: Number(wd.total || 0),
          pending: Number(wd.pending || 0),
          certifiedAmount: Number(wd.certifiedAmount || 0),
        },
        projects: {
          total: Number(projects.total || 0),
          active: Number(projects.active || 0),
        },
        recentWOs: recentWOsResult.recordset,
        recentBOQs: recentBOQsResult.recordset,
        recentWorkDone: recentWorkDoneResult.recordset,
        woStatusBreakdown: woStatusResult.recordset,
        workDoneStatusBreakdown: workDoneStatusResult.recordset,
      });
    } catch (err) {
      console.error("[engineering-dashboard]", err);
      res.status(500).json({
        error: "Failed to load engineering dashboard. Please try again.",
      });
    }
  },
);

router.get("/work-done", cache(WORK_DONE_CACHE, 120), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      500,
      Math.max(1, parseInt(req.query.limit || "100", 10)),
    );
    const offset = (page - 1) * limit;

    // Optional status filter (e.g. ?status=Approved for expense booking picker)
    const statusFilter = req.query.status
      ? String(req.query.status).trim()
      : null;
    const whereClause = statusFilter
      ? `WHERE ISNULL(wd.Status, 'Draft') = @statusFilter`
      : "";
    const countWhere = statusFilter
      ? `WHERE ISNULL(Status, 'Draft') = @statusFilter`
      : "";

    const dataReq = pool
      .request()
      .input("limit", sql.Int, limit)
      .input("offset", sql.Int, offset);
    if (statusFilter)
      dataReq.input("statusFilter", sql.NVarChar(50), statusFilter);

    const countReq = pool.request();
    if (statusFilter)
      countReq.input("statusFilter", sql.NVarChar(50), statusFilter);

    const [dataResult, countResult] = await Promise.all([
      dataReq.query(`
        ${selectWorkDoneSql}
        ${whereClause}
        ORDER BY ISNULL(wd.UpdatedAt, wd.CreatedAt) DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `),
      countReq.query(
        `SELECT COUNT(1) AS total FROM dbo.WorkDone ${countWhere}`,
      ),
    ]);

    res.json({
      data: dataResult.recordset,
      total: countResult.recordset[0].total,
      page,
      limit,
      pages: Math.ceil(countResult.recordset[0].total / limit),
    });
  } catch (err) {
    console.error("[GET /engineering/work-done]", err);
    res.status(500).json({ error: "Failed to fetch work done entries." });
  }
});

// ── GET /work-done/:id/create-po-prefill ─────────────────────────────────────
// Returns Work Done header shaped for the PO form (WO_PO creation).
// Only Approved Work Done entries can generate a WO_PO.
router.get("/work-done/:id/create-po-prefill", async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await pool.request().input("ID", sql.Int, id).query(`
      ${selectWorkDoneSql}
      WHERE wd.ID = @ID
    `);

    if (!result.recordset.length)
      return res.status(404).json({ error: "Work Done entry not found" });

    const wd = result.recordset[0];
    if (wd.Status !== "Approved")
      return res.status(400).json({
        error: `Work Done is ${wd.Status}. Only Approved entries can generate a WO_PO.`,
      });

    res.json({
      WDId: wd.ID,
      DocNo: wd.DocNo,
      CompanyId: wd.CompanyId,
      CompanyName: wd.CompanyName,
      ProjectId: wd.ProjectId,
      ProjectName: wd.ProjectName,
      SupplierId: wd.SupplierId,
      SupplierName: wd.SupplierName || wd.ContractorName,
      WorkOrderId: wd.WorkOrderID,
      WorkOrderNo: wd.WorkOrderNo,
      CertifiedAmount: wd.CertifiedAmount,
      DescriptionOfWork: wd.DescriptionOfWork,
      Remarks: wd.Remarks,
      // Single line item derived from the Work Done itself
      items: [
        {
          itemDescription:
            wd.DescriptionOfWork || "Work Done — see Work Done document",
          unit: wd.Unit || "LS",
          quantity: Number(wd.QuantityDone) || 1,
          rate: Number(wd.RatePerUnit) || 0,
          amount: Number(wd.CertifiedAmount) || 0,
        },
      ],
    });
  } catch (err) {
    console.error("[GET /engineering/work-done/:id/create-po-prefill]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/work-done/:id", async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const result = await pool.request().input("ID", sql.BigInt, req.params.id)
      .query(`
        ${selectWorkDoneSql}
        WHERE wd.ID = @ID
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Work Done entry not found" });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[GET /engineering/work-done/:id]", err);
    res.status(500).json({ error: "Failed to fetch work done entry." });
  }
});

router.post("/work-done", async (req, res) => {
  let transaction;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const body = req.body || {};
    const docTypeId = toIntOrNull(body.DocTypeId);

    // Validate required fields that map to NOT NULL columns
    const docDate = body.DocDate || new Date().toISOString().slice(0, 10);
    const companyId = toIntOrNull(body.CompanyId);
    const projectId = toIntOrNull(body.ProjectId);
    const description = (body.DescriptionOfWork || "").trim();

    if (!companyId) {
      return res.status(400).json({ error: "CompanyId is required." });
    }
    if (!projectId) {
      return res.status(400).json({ error: "ProjectId is required." });
    }
    if (!description) {
      return res.status(400).json({ error: "DescriptionOfWork is required." });
    }

    const quantity = toNumber(body.QuantityDone);
    const rate = toNumber(body.RatePerUnit);
    const deductions = toNumber(body.Deductions);
    const gross =
      body.GrossAmount != null ? toNumber(body.GrossAmount) : quantity * rate;
    const certified =
      body.CertifiedAmount != null
        ? toNumber(body.CertifiedAmount)
        : gross - deductions;

    transaction = pool.transaction();
    await transaction.begin();

    // Period overlap guard
    if (toIntOrNull(body.WorkOrderID) && body.PeriodFrom && body.PeriodTo) {
      const overlapCheck = await pool
        .request()
        .input("WOId", sql.Int, toIntOrNull(body.WorkOrderID))
        .input("PFrom", sql.Date, body.PeriodFrom)
        .input("PTo", sql.Date, body.PeriodTo).query(`
          SELECT COUNT(1) AS cnt
          FROM dbo.WorkDone
          WHERE WorkOrderID = @WOId
            AND PeriodFrom IS NOT NULL AND PeriodTo IS NOT NULL
            AND PeriodFrom <= @PTo AND PeriodTo >= @PFrom
        `);
      if ((overlapCheck.recordset[0]?.cnt ?? 0) > 0) {
        return res.status(409).json({
          error:
            "A Work Done entry already exists for an overlapping period on this Work Order.",
        });
      }
    }

    let finalDocNo = body.DocNo || null;
    if (docTypeId) {
      finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId,
        finYear: body.FinYear || null,
        tableName: WORK_DONE_TABLE,
        issuedBy: userEmail,
      });
    }

    const result = await transaction
      .request()
      .input("DocNo", sql.NVarChar(100), finalDocNo)
      .input("DocTypeId", sql.Int, docTypeId)
      .input("DocDate", sql.Date, docDate)
      .input("CompanyId", sql.Int, companyId)
      .input("ProjectId", sql.Int, projectId)
      .input("FinYear", sql.NVarChar(20), body.FinYear || null)
      .input("SupplierId", sql.Int, toIntOrNull(body.SupplierId))
      .input("WorkOrderID", sql.Int, toIntOrNull(body.WorkOrderID))
      .input("PeriodFrom", sql.Date, body.PeriodFrom || null)
      .input("PeriodTo", sql.Date, body.PeriodTo || null)
      .input("DescriptionOfWork", sql.NVarChar(sql.MAX), description)
      .input("QuantityDone", sql.Decimal(18, 4), quantity)
      .input("Unit", sql.NVarChar(50), body.Unit || null)
      .input("RatePerUnit", sql.Decimal(18, 4), rate)
      .input("GrossAmount", sql.Decimal(18, 2), gross)
      .input("Deductions", sql.Decimal(18, 2), deductions)
      .input("CertifiedAmount", sql.Decimal(18, 2), certified)
      .input("Status", sql.NVarChar(50), body.Status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), body.Remarks || null)
      .input("CreatedBy", sql.NVarChar(100), userEmail).query(`
        INSERT INTO dbo.WorkDone
          (DocNo, DocTypeId, DocDate, CompanyId, ProjectId, FinYear, SupplierId,
           WorkOrderID, PeriodFrom, PeriodTo, DescriptionOfWork, QuantityDone,
           Unit, RatePerUnit, GrossAmount, Deductions, CertifiedAmount, Status,
           Remarks, CreatedBy, CreatedAt)
        OUTPUT INSERTED.ID
        VALUES
          (@DocNo, @DocTypeId, @DocDate, @CompanyId, @ProjectId, @FinYear, @SupplierId,
           @WorkOrderID, @PeriodFrom, @PeriodTo, @DescriptionOfWork, @QuantityDone,
           @Unit, @RatePerUnit, @GrossAmount, @Deductions, @CertifiedAmount, @Status,
           @Remarks, @CreatedBy, SYSDATETIME())
      `);

    const newId = result.recordset[0].ID;
    if (docTypeId && finalDocNo) {
      await backPatchRecordId(pool, sql, finalDocNo, WORK_DONE_TABLE, newId);
    }

    await transaction.commit();
    await bumpCacheVersion(WORK_DONE_CACHE);
    await bumpCacheVersion("engineering-dashboard");

    res.status(201).json({
      message: "Work Done entry created",
      ID: newId,
      DocNo: finalDocNo,
    });
  } catch (err) {
    try {
      if (transaction) await transaction.rollback();
    } catch (_) {}
    console.error("[POST /engineering/work-done]", err);
    res.status(500).json({ error: "Failed to create work done entry." });
  }
});

router.put("/work-done/:id", async (req, res) => {
  try {
    await guardEdit("work-done", req.params.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const body = req.body || {};
    const quantity = toNumber(body.QuantityDone);
    const rate = toNumber(body.RatePerUnit);
    const deductions = toNumber(body.Deductions);
    const gross =
      body.GrossAmount != null ? toNumber(body.GrossAmount) : quantity * rate;
    const certified =
      body.CertifiedAmount != null
        ? toNumber(body.CertifiedAmount)
        : gross - deductions;

    // Period overlap guard (exclude self)
    if (toIntOrNull(body.WorkOrderID) && body.PeriodFrom && body.PeriodTo) {
      const overlapCheck = await pool
        .request()
        .input("WOId", sql.Int, toIntOrNull(body.WorkOrderID))
        .input("PFrom", sql.Date, body.PeriodFrom)
        .input("PTo", sql.Date, body.PeriodTo)
        .input("SelfId", sql.BigInt, req.params.id).query(`
          SELECT COUNT(1) AS cnt
          FROM dbo.WorkDone
          WHERE WorkOrderID = @WOId
            AND ID <> @SelfId
            AND PeriodFrom IS NOT NULL AND PeriodTo IS NOT NULL
            AND PeriodFrom <= @PTo AND PeriodTo >= @PFrom
        `);
      if ((overlapCheck.recordset[0]?.cnt ?? 0) > 0) {
        return res.status(409).json({
          error:
            "A Work Done entry already exists for an overlapping period on this Work Order.",
        });
      }
    }

    const result = await pool
      .request()
      .input("ID", sql.BigInt, req.params.id)
      .input("DocNo", sql.NVarChar(100), body.DocNo || null)
      .input("DocTypeId", sql.Int, toIntOrNull(body.DocTypeId))
      .input(
        "DocDate",
        sql.Date,
        body.DocDate || new Date().toISOString().slice(0, 10),
      )
      .input("CompanyId", sql.Int, toIntOrNull(body.CompanyId))
      .input("ProjectId", sql.Int, toIntOrNull(body.ProjectId))
      .input("FinYear", sql.NVarChar(20), body.FinYear || null)
      .input("SupplierId", sql.Int, toIntOrNull(body.SupplierId))
      .input("WorkOrderID", sql.Int, toIntOrNull(body.WorkOrderID))
      .input("PeriodFrom", sql.Date, body.PeriodFrom || null)
      .input("PeriodTo", sql.Date, body.PeriodTo || null)
      .input(
        "DescriptionOfWork",
        sql.NVarChar(sql.MAX),
        body.DescriptionOfWork || "",
      )
      .input("QuantityDone", sql.Decimal(18, 4), quantity)
      .input("Unit", sql.NVarChar(50), body.Unit || null)
      .input("RatePerUnit", sql.Decimal(18, 4), rate)
      .input("GrossAmount", sql.Decimal(18, 2), gross)
      .input("Deductions", sql.Decimal(18, 2), deductions)
      .input("CertifiedAmount", sql.Decimal(18, 2), certified)
      .input("Status", sql.NVarChar(50), body.Status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), body.Remarks || null)
      .input("UpdatedBy", sql.NVarChar(100), userEmail).query(`
        UPDATE dbo.WorkDone SET
          DocNo = @DocNo,
          DocTypeId = @DocTypeId,
          DocDate = @DocDate,
          CompanyId = @CompanyId,
          ProjectId = @ProjectId,
          FinYear = @FinYear,
          SupplierId = @SupplierId,
          WorkOrderID = @WorkOrderID,
          PeriodFrom = @PeriodFrom,
          PeriodTo = @PeriodTo,
          DescriptionOfWork = @DescriptionOfWork,
          QuantityDone = @QuantityDone,
          Unit = @Unit,
          RatePerUnit = @RatePerUnit,
          GrossAmount = @GrossAmount,
          Deductions = @Deductions,
          CertifiedAmount = @CertifiedAmount,
          Status = @Status,
          Remarks = @Remarks,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE ID = @ID
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Work Done entry not found" });
    }

    await bumpCacheVersion(WORK_DONE_CACHE);
    await bumpCacheVersion("engineering-dashboard");
    res.json({ message: "Work Done entry updated" });
  } catch (err) {
    console.error("[PUT /engineering/work-done/:id]", err);
    res.status(500).json({ error: "Failed to update work done entry." });
  }
});

router.delete("/work-done/:id", async (req, res) => {
  try {
    const role = req.user?.role;
    if (!role || !["admin", "manager"].includes(role.toLowerCase())) {
      return res.status(403).json({
        error: "Insufficient permissions to delete work done entries.",
      });
    }

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const result = await pool
      .request()
      .input("ID", sql.BigInt, req.params.id)
      .input("DeletedBy", sql.NVarChar(100), userEmail).query(`
        UPDATE dbo.WorkDone
        SET Status    = 'Deleted',
            UpdatedBy = @DeletedBy,
            UpdatedAt = SYSDATETIME()
        WHERE ID = @ID AND ISNULL(Status, '') <> 'Deleted'
      `);

    if (result.rowsAffected[0] === 0) {
      return res
        .status(404)
        .json({ error: "Work Done entry not found or already deleted." });
    }

    await bumpCacheVersion(WORK_DONE_CACHE);
    await bumpCacheVersion("engineering-dashboard");
    res.json({ message: "Work Done entry deleted." });
  } catch (err) {
    console.error("[DELETE /engineering/work-done/:id]", err);
    res.status(500).json({ error: "Failed to delete work done entry." });
  }
});

router.put("/work-done/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition(
      "work-done",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion(WORK_DONE_CACHE);
    await bumpCacheVersion("engineering-dashboard");
    res.json({ message: "Work Done submitted for approval", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/work-done/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition(
      "work-done",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion(WORK_DONE_CACHE);
    await bumpCacheVersion("engineering-dashboard");
    res.json({ message: "Work Done approved", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

router.put("/work-done/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition(
      "work-done",
      id,
      "Rejected",
      userEmail,
      req.user?.role,
      req.body?.note || null,
    );
    await bumpCacheVersion(WORK_DONE_CACHE);
    await bumpCacheVersion("engineering-dashboard");
    res.json({ message: "Work Done rejected", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

// ── GET /engineering/work-orders-with-activities ──────────────────────────────
router.get(
  "/work-orders-with-activities",
  cache("eng-wo-with-activities", 300),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT
          h.Id,
          COALESCE(h.DocNo, h.DocumentNumber) AS DocNo,
          ah.LHeadName AS ContractorName,
          COUNT(a.Id) AS ActivityCount,
          ISNULL(SUM(a.GrandTotal), 0) AS GrossTotal,
          ISNULL(SUM(a.LabourAmount), 0) AS LabourTotal,
          ISNULL(SUM(a.MaterialAmount), 0) AS MaterialTotal
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.WorkOrderActivities a ON a.WorkOrderHeaderId = h.Id
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = h.ContractorId
        WHERE ISNULL(h.Status, 'Draft') = 'Approved'
        GROUP BY h.Id, h.DocNo, h.DocumentNumber, ah.LHeadName
        ORDER BY h.Id DESC
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error(
        "[GET /engineering/work-orders-with-activities]",
        err.message,
      );
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /engineering/work-order-summary/:woId ─────────────────────────────────
router.get("/work-order-summary/:woId", async (req, res) => {
  try {
    const pool = getPool();
    const woId = parseInt(req.params.woId, 10);
    if (!Number.isFinite(woId))
      return res.status(400).json({ error: "Invalid WO ID" });

    const req2 = pool.request().input("WorkOrderHeaderId", sql.Int, woId);

    // Main WO header + activity totals
    const woResult = await req2.query(`
        SELECT
          h.CompanyId,
          h.ProjectId,
          h.SupplierId,
          h.ContractorId,
          h.TotalAmount                    AS ContractValue,
          COUNT(a.Id)                      AS ActivityCount,
          ISNULL(SUM(a.GrandTotal), 0)     AS GrossAmount,
          ISNULL(SUM(a.LabourAmount), 0)   AS LabourAmount,
          ISNULL(SUM(a.MaterialAmount), 0) AS MaterialAmount,
          ISNULL(SUM(a.GrandTotal), 0)     AS NetAmount
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.WorkOrderActivities a ON a.WorkOrderHeaderId = h.Id
        WHERE h.Id = @WorkOrderHeaderId
        GROUP BY h.CompanyId, h.ProjectId, h.SupplierId, h.ContractorId, h.TotalAmount
      `);

    // Certified total from approved Work Done entries
    const certResult = await pool
      .request()
      .input("WorkOrderHeaderId2", sql.Int, woId).query(`
        SELECT ISNULL(SUM(CertifiedAmount), 0) AS TotalCertified
        FROM dbo.WorkDone
        WHERE WorkOrderID = @WorkOrderHeaderId2
          AND ISNULL(Status, 'Draft') = 'Approved'
      `);

    // Booked total from Expense Bookings linked to this WO's Work Done entries
    const bookedResult = await pool
      .request()
      .input("WorkOrderHeaderId3", sql.Int, woId).query(`
        SELECT ISNULL(SUM(eb.ENetAmount), 0) AS TotalBooked
        FROM dbo.ExpenseBooking eb
        WHERE eb.ESourceType = 'WORK_DONE'
          AND eb.EStatus != 'Deleted'
          AND eb.ESourceId IN (
            SELECT ID FROM dbo.WorkDone WHERE WorkOrderID = @WorkOrderHeaderId3
          )
      `);

    // Paid total from Payments linked to those expense bookings
    const paidResult = await pool
      .request()
      .input("WorkOrderHeaderId4", sql.Int, woId).query(`
        SELECT ISNULL(SUM(p.PAmount), 0) AS TotalPaid
        FROM dbo.NewPayment p
        WHERE p.PExpenseRef IN (
          SELECT eb.EDocNo
          FROM dbo.ExpenseBooking eb
          WHERE eb.ESourceType = 'WORK_DONE'
            AND eb.EStatus != 'Deleted'
            AND eb.ESourceId IN (
              SELECT ID FROM dbo.WorkDone WHERE WorkOrderID = @WorkOrderHeaderId4
            )
        )
      `);

    const row = woResult.recordset[0] ?? {
      CompanyId: null,
      ProjectId: null,
      SupplierId: null,
      ContractorId: null,
      ContractValue: 0,
      ActivityCount: 0,
      GrossAmount: 0,
      LabourAmount: 0,
      MaterialAmount: 0,
      NetAmount: 0,
    };

    const totalCertified = parseFloat(
      certResult.recordset[0]?.TotalCertified || 0,
    );
    const totalBooked = parseFloat(bookedResult.recordset[0]?.TotalBooked || 0);
    const totalPaid = parseFloat(paidResult.recordset[0]?.TotalPaid || 0);
    const balance = (row.ContractValue || 0) - totalPaid;

    res.json({ ...row, totalCertified, totalBooked, totalPaid, balance });
  } catch (err) {
    console.error("[GET /engineering/work-order-summary/:woId]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /engineering/boq-activities/:boqId ─────────────────────────────────────
// Returns BoqActivities for a specific BOQ so the WO create/edit form can
// inherit line items when a BOQ is selected.
router.get("/boq-activities/:boqId", async (req, res) => {
  const boqId = parseInt(req.params.boqId, 10);
  if (!Number.isFinite(boqId))
    return res.status(400).json({ error: "Invalid BOQ ID" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("BoqID", sql.Int, boqId)
      .query(
        "SELECT * FROM dbo.BoqActivities WHERE BoqID = @BoqID ORDER BY SortOrder",
      );
    res.json(result.recordset);
  } catch (err) {
    console.error("[GET /engineering/boq-activities/:boqId]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /engineering/approved-boqs ─────────────────────────────────────────────
// Lightweight list of Approved BOQs for the Work Order BOQ picker.
router.get(
  "/approved-boqs",
  cache("eng-approved-boqs", 120),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT
          b.BoqID   AS id,
          COALESCE(b.DocNo, b.BoqNo) AS name,
          b.CompanyId,
          co.name   AS CompanyName,
          b.ProjectId,
          pr.name   AS ProjectName,
          b.TotalAmount
        FROM dbo.BOQ b
        LEFT JOIN dbo.enterprise co ON co.id = b.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
        WHERE b.Status = 'Approved'
        ORDER BY b.BoqID DESC
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[GET /engineering/approved-boqs]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
