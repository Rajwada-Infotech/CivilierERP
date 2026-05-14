"use strict";

const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

const WORK_DONE_TABLE = "EngineeringWorkDone";
const WORK_DONE_CACHE = "engineering-work-done";

const requireUserEmail = (req, res) => {
  const email = req.user?.email || req.user?.name;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
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
  const result = await pool.request().input("tableName", sql.NVarChar(128), tableName)
    .query(`
      SELECT COUNT(1) AS cnt
      FROM sys.tables
      WHERE object_id = OBJECT_ID(N'dbo.' + @tableName)
    `);
  return result.recordset[0]?.cnt > 0;
};

const ensureWorkDoneTable = async (pool, res) => {
  if (await hasTable(pool, WORK_DONE_TABLE)) return true;
  res.status(500).json({
    error:
      "dbo.EngineeringWorkDone is missing. Run backend/migrations/052-create-engineering-work-done.sql in SSMS.",
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
  FROM dbo.EngineeringWorkDone wd
  LEFT JOIN dbo.enterprise co ON co.id = wd.CompanyId
  LEFT JOIN dbo.enterprise pr ON pr.id = wd.ProjectId
  LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = wd.SupplierId
  LEFT JOIN dbo.WorkOrderHeader woh ON woh.Id = wd.WorkOrderID
  LEFT JOIN dbo.AccountHeadMaster ctr ON ctr.LHeadId = woh.ContractorId
`;

router.get("/dashboard", cache("engineering-dashboard", 120), async (req, res) => {
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
              SUM(CASE WHEN ISNULL(Status, 'Draft') IN ('Draft', 'Pending', 'Open', 'In Progress') THEN 1 ELSE 0 END) AS openCount,
              SUM(CASE WHEN DocumentDate >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) THEN 1 ELSE 0 END) AS thisMonth,
              ISNULL(SUM(TotalAmount), 0) AS totalValue
            FROM dbo.WorkOrderHeader
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
            ORDER BY ISNULL(h.UpdatedAt, h.CreatedAt) DESC
          `)
        : Promise.resolve({ recordset: [] }),
      hasWO
        ? pool.request().query(`
            SELECT ISNULL(Status, 'Draft') AS Status, COUNT(1) AS Count, ISNULL(SUM(TotalAmount), 0) AS TotalValue
            FROM dbo.WorkOrderHeader
            GROUP BY ISNULL(Status, 'Draft')
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
            FROM dbo.EngineeringWorkDone
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
            FROM dbo.EngineeringWorkDone wd
            LEFT JOIN dbo.WorkOrderHeader woh ON woh.Id = wd.WorkOrderID
            ORDER BY ISNULL(wd.UpdatedAt, wd.CreatedAt) DESC
          `)
        : Promise.resolve({ recordset: [] }),
      hasWorkDone
        ? pool.request().query(`
            SELECT ISNULL(Status, 'Draft') AS Status, COUNT(1) AS Count, ISNULL(SUM(CertifiedAmount), 0) AS TotalValue
            FROM dbo.EngineeringWorkDone
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
    console.error("[engineering-dashboard]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/work-done", cache(WORK_DONE_CACHE, 120), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const result = await pool.request().query(`
      ${selectWorkDoneSql}
      ORDER BY ISNULL(wd.UpdatedAt, wd.CreatedAt) DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[GET /engineering/work-done]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/work-done/:id", async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const result = await pool
      .request()
      .input("ID", sql.Int, req.params.id).query(`
        ${selectWorkDoneSql}
        WHERE wd.ID = @ID
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Work Done entry not found" });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[GET /engineering/work-done/:id]", err.message);
    res.status(500).json({ error: err.message });
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
    const quantity = toNumber(body.QuantityDone);
    const rate = toNumber(body.RatePerUnit);
    const deductions = toNumber(body.Deductions);
    const gross = body.GrossAmount != null ? toNumber(body.GrossAmount) : quantity * rate;
    const certified =
      body.CertifiedAmount != null ? toNumber(body.CertifiedAmount) : gross - deductions;

    transaction = pool.transaction();
    await transaction.begin();

    let finalDocNo = body.DocNo || null;
    const docTypeId = toIntOrNull(body.DocTypeId);
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
      .input("DocDate", sql.Date, body.DocDate || null)
      .input("CompanyId", sql.Int, toIntOrNull(body.CompanyId))
      .input("ProjectId", sql.Int, toIntOrNull(body.ProjectId))
      .input("FinYear", sql.NVarChar(20), body.FinYear || null)
      .input("SupplierId", sql.Int, toIntOrNull(body.SupplierId))
      .input("WorkOrderID", sql.Int, toIntOrNull(body.WorkOrderID))
      .input("PeriodFrom", sql.Date, body.PeriodFrom || null)
      .input("PeriodTo", sql.Date, body.PeriodTo || null)
      .input("DescriptionOfWork", sql.NVarChar(sql.MAX), body.DescriptionOfWork || null)
      .input("QuantityDone", sql.Decimal(18, 4), quantity)
      .input("Unit", sql.NVarChar(50), body.Unit || null)
      .input("RatePerUnit", sql.Decimal(18, 4), rate)
      .input("GrossAmount", sql.Decimal(18, 2), gross)
      .input("Deductions", sql.Decimal(18, 2), deductions)
      .input("CertifiedAmount", sql.Decimal(18, 2), certified)
      .input("Status", sql.NVarChar(50), body.Status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), body.Remarks || null)
      .input("CreatedBy", sql.NVarChar(100), userEmail).query(`
        INSERT INTO dbo.EngineeringWorkDone
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

    res.status(201).json({ message: "Work Done entry created", ID: newId, DocNo: finalDocNo });
  } catch (err) {
    try {
      if (transaction) await transaction.rollback();
    } catch (_) {}
    console.error("[POST /engineering/work-done]", err.message);
    res.status(500).json({ error: err.message });
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
    const gross = body.GrossAmount != null ? toNumber(body.GrossAmount) : quantity * rate;
    const certified =
      body.CertifiedAmount != null ? toNumber(body.CertifiedAmount) : gross - deductions;

    const result = await pool
      .request()
      .input("ID", sql.Int, req.params.id)
      .input("DocNo", sql.NVarChar(100), body.DocNo || null)
      .input("DocTypeId", sql.Int, toIntOrNull(body.DocTypeId))
      .input("DocDate", sql.Date, body.DocDate || null)
      .input("CompanyId", sql.Int, toIntOrNull(body.CompanyId))
      .input("ProjectId", sql.Int, toIntOrNull(body.ProjectId))
      .input("FinYear", sql.NVarChar(20), body.FinYear || null)
      .input("SupplierId", sql.Int, toIntOrNull(body.SupplierId))
      .input("WorkOrderID", sql.Int, toIntOrNull(body.WorkOrderID))
      .input("PeriodFrom", sql.Date, body.PeriodFrom || null)
      .input("PeriodTo", sql.Date, body.PeriodTo || null)
      .input("DescriptionOfWork", sql.NVarChar(sql.MAX), body.DescriptionOfWork || null)
      .input("QuantityDone", sql.Decimal(18, 4), quantity)
      .input("Unit", sql.NVarChar(50), body.Unit || null)
      .input("RatePerUnit", sql.Decimal(18, 4), rate)
      .input("GrossAmount", sql.Decimal(18, 2), gross)
      .input("Deductions", sql.Decimal(18, 2), deductions)
      .input("CertifiedAmount", sql.Decimal(18, 2), certified)
      .input("Status", sql.NVarChar(50), body.Status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), body.Remarks || null)
      .input("UpdatedBy", sql.NVarChar(100), userEmail).query(`
        UPDATE dbo.EngineeringWorkDone SET
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
    console.error("[PUT /engineering/work-done/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/work-done/:id", async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ensureWorkDoneTable(pool, res))) return;

    const result = await pool
      .request()
      .input("ID", sql.Int, req.params.id)
      .query("DELETE FROM dbo.EngineeringWorkDone WHERE ID = @ID");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Work Done entry not found" });
    }

    await bumpCacheVersion(WORK_DONE_CACHE);
    await bumpCacheVersion("engineering-dashboard");
    res.json({ message: "Work Done entry deleted" });
  } catch (err) {
    console.error("[DELETE /engineering/work-done/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/work-done/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition("work-done", id, "Pending", userEmail, req.user?.role);
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
    const result = await transition("work-done", id, "Approved", userEmail, req.user?.role);
    await bumpCacheVersion(WORK_DONE_CACHE);
    await bumpCacheVersion("engineering-dashboard");
    res.json({ message: "Work Done approved", ...result });
  } catch (err) {
    res.status(err.message.includes("not authorized") ? 403 : 400).json({ error: err.message });
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
    res.status(err.message.includes("not authorized") ? 403 : 400).json({ error: err.message });
  }
});

module.exports = router;
