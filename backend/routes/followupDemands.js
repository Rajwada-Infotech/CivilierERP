// routes/followupDemands.js
// Finance → Demands: view and raise payment demand letters against booking milestones.

const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");
const rateLimit = require("express-rate-limit");

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false }));
router.use(authMiddleware);

const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "FinanceDemands";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseId(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getUserName(req, res) {
  const name = req.user?.name || req.user?.email || null;
  if (!name) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return name;
}

/** Build a demand number like DEM-BKG000042-003 */
function buildDemandNo(bookingNo, sortOrder) {
  const seq = String(sortOrder + 1).padStart(3, "0");
  return `DEM-${bookingNo}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/followup-demands
// List all booking payment term rows with demand status.
// Query params: projectId, status (Pending|Demanded|Paid), search, page, pageSize
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "read"),
  async (req, res) => {
    try {
      const pool = getPool();
      const page     = Math.max(1, parseInt(req.query.page     || "1",  10));
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "50", 10)));
      const skip     = (page - 1) * pageSize;

      const projectId    = parseId(req.query.projectId);
      const statusFilter = ["Pending", "Demanded", "Paid"].includes(req.query.status)
        ? req.query.status : null;
      const search = (req.query.search || "").trim();

      const conditions = ["fb.IsDeleted = 0"];
      const r = pool.request()
        .input("skip",     sql.Int, skip)
        .input("take",     sql.Int, pageSize);

      if (projectId) {
        conditions.push("fb.ProjectId = @projectId");
        r.input("projectId", sql.Int, projectId);
      }
      if (statusFilter) {
        conditions.push("bpt.DemandStatus = @status");
        r.input("status", sql.NVarChar(20), statusFilter);
      }
      if (search) {
        conditions.push(
          "(fa.ApplicantName LIKE @search OR fb.BookingNo LIKE @search OR bpt.DemandNo LIKE @search OR ptm.TermName LIKE @search)"
        );
        r.input("search", sql.NVarChar(200), `%${search}%`);
      }

      const WHERE = conditions.join(" AND ");

      const BASE = `
        FROM dbo.BookingPaymentTerms bpt
        JOIN dbo.FollowupBookings    fb  ON fb.Id  = bpt.BookingID
        JOIN dbo.FollowupApplications fa ON fa.Id  = fb.ApplicantId
        JOIN dbo.PaymentTermMaster   ptm ON ptm.TermID = bpt.TermID
        LEFT JOIN dbo.enterprise     pm  ON pm.id  = fb.ProjectId
        WHERE ${WHERE}
      `;

      const [countRes, dataRes] = await Promise.all([
        pool.request()
          .input("skip",      sql.Int, skip)
          .input("take",      sql.Int, pageSize)
          // Re-bind filters
          ...(projectId   ? [r.input] : [])  // handled via the same request below
        ,
        r.query(`
          SELECT
            bpt.Id,
            bpt.BookingID,
            fb.BookingNo,
            fb.ApplicantId,
            fa.ApplicantName,
            fa.PrimaryMobile,
            fb.ProjectId,
            pm.name        AS ProjectName,
            fb.UnitNo,
            fb.TotalValue  AS BookingTotalValue,
            bpt.TermID,
            ptm.TermName,
            bpt.ComputedAmount,
            bpt.DocRef,
            bpt.DueDate,
            bpt.SortOrder,
            bpt.DemandStatus,
            bpt.DemandNo,
            bpt.DemandRaisedOn,
            bpt.DemandNotes,
            bpt.IsPaid,
            bpt.PaidOn
          ${BASE}
          ORDER BY fb.BookingDate DESC, bpt.SortOrder ASC
          OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY
        `)
      ]);

      // Re-run count separately (simpler)
      const conditions2 = ["fb.IsDeleted = 0"];
      const r2 = pool.request();
      if (projectId)   { conditions2.push("fb.ProjectId = @p"); r2.input("p", sql.Int, projectId); }
      if (statusFilter) { conditions2.push("bpt.DemandStatus = @s"); r2.input("s", sql.NVarChar(20), statusFilter); }
      if (search)       { conditions2.push("(fa.ApplicantName LIKE @q OR fb.BookingNo LIKE @q OR bpt.DemandNo LIKE @q OR ptm.TermName LIKE @q)"); r2.input("q", sql.NVarChar(200), `%${search}%`); }

      const countResult = await r2.query(`
        SELECT COUNT(*) AS Total
        FROM dbo.BookingPaymentTerms bpt
        JOIN dbo.FollowupBookings    fb  ON fb.Id  = bpt.BookingID
        JOIN dbo.FollowupApplications fa ON fa.Id  = fb.ApplicantId
        JOIN dbo.PaymentTermMaster   ptm ON ptm.TermID = bpt.TermID
        LEFT JOIN dbo.enterprise     pm  ON pm.id  = fb.ProjectId
        WHERE ${conditions2.join(" AND ")}
      `);

      const total = countResult.recordset[0]?.Total ?? 0;

      // Summary aggregates
      const summaryConditions = ["fb.IsDeleted = 0"];
      const r3 = pool.request();
      if (projectId) { summaryConditions.push("fb.ProjectId = @pp"); r3.input("pp", sql.Int, projectId); }

      const summaryRes = await r3.query(`
        SELECT
          SUM(CASE WHEN bpt.DemandStatus = 'Pending'  THEN bpt.ComputedAmount ELSE 0 END) AS PendingAmount,
          SUM(CASE WHEN bpt.DemandStatus = 'Demanded' THEN bpt.ComputedAmount ELSE 0 END) AS DemandedAmount,
          SUM(CASE WHEN bpt.DemandStatus = 'Paid'     THEN bpt.ComputedAmount ELSE 0 END) AS PaidAmount,
          COUNT(CASE WHEN bpt.DemandStatus = 'Pending'  THEN 1 END) AS PendingCount,
          COUNT(CASE WHEN bpt.DemandStatus = 'Demanded' THEN 1 END) AS DemandedCount,
          COUNT(CASE WHEN bpt.DemandStatus = 'Paid'     THEN 1 END) AS PaidCount
        FROM dbo.BookingPaymentTerms bpt
        JOIN dbo.FollowupBookings    fb ON fb.Id = bpt.BookingID
        WHERE ${summaryConditions.join(" AND ")}
      `);

      res.json({
        data: dataRes.recordset,
        pagination: { page, pageSize, total },
        summary: summaryRes.recordset[0] ?? {},
      });
    } catch (err) {
      console.error("GET /followup-demands:", err);
      res.status(500).json({ error: "Failed to load demands" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/followup-demands/projects
// Distinct projects that have bookings (for the filter dropdown)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/projects",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "read"),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT DISTINCT pm.id AS ProjectId, pm.name AS ProjectName
        FROM dbo.FollowupBookings fb
        JOIN dbo.enterprise pm ON pm.id = fb.ProjectId
        WHERE fb.IsDeleted = 0 AND pm.id IS NOT NULL
        ORDER BY pm.name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("GET /followup-demands/projects:", err);
      res.status(500).json({ error: "Failed to load projects" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/followup-demands/booking/:bookingId
// All milestones for a single booking (for the detail drawer)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/booking/:bookingId",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "read"),
  async (req, res) => {
    try {
      const pool = getPool();
      const bookingId = parseId(req.params.bookingId);
      if (!bookingId) return res.status(400).json({ error: "Invalid booking ID" });

      const result = await pool.request()
        .input("BookingID", sql.Int, bookingId)
        .query(`
          SELECT
            bpt.Id,
            bpt.BookingID,
            fb.BookingNo,
            fa.ApplicantName,
            pm.name AS ProjectName,
            fb.UnitNo,
            fb.TotalValue AS BookingTotalValue,
            ptm.TermName,
            bpt.ComputedAmount,
            bpt.DocRef,
            bpt.DueDate,
            bpt.SortOrder,
            bpt.DemandStatus,
            bpt.DemandNo,
            bpt.DemandRaisedOn,
            bpt.DemandNotes,
            bpt.IsPaid,
            bpt.PaidOn
          FROM dbo.BookingPaymentTerms bpt
          JOIN dbo.FollowupBookings     fb  ON fb.Id  = bpt.BookingID
          JOIN dbo.FollowupApplications fa  ON fa.Id  = fb.ApplicantId
          JOIN dbo.PaymentTermMaster    ptm ON ptm.TermID = bpt.TermID
          LEFT JOIN dbo.enterprise      pm  ON pm.id  = fb.ProjectId
          WHERE bpt.BookingID = @BookingID AND fb.IsDeleted = 0
          ORDER BY bpt.SortOrder
        `);

      res.json(result.recordset);
    } catch (err) {
      console.error("GET /followup-demands/booking/:id:", err);
      res.status(500).json({ error: "Failed to load booking milestones" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/followup-demands/:id/raise
// Raise a demand for a single milestone (Pending → Demanded).
// Body: { dueDate?, notes? }
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/:id/raise",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "write"),
  async (req, res) => {
    try {
      const pool = getPool();
      const termRowId = parseId(req.params.id);
      if (!termRowId) return res.status(400).json({ error: "Invalid ID" });

      const userName = getUserName(req, res);
      if (!userName) return;

      // Fetch the row + booking info to build DemandNo
      const existing = await pool.request()
        .input("Id", sql.Int, termRowId)
        .query(`
          SELECT bpt.Id, bpt.DemandStatus, bpt.SortOrder, bpt.BookingID,
                 fb.BookingNo, fb.IsDeleted
          FROM dbo.BookingPaymentTerms bpt
          JOIN dbo.FollowupBookings fb ON fb.Id = bpt.BookingID
          WHERE bpt.Id = @Id
        `);

      const row = existing.recordset[0];
      if (!row)              return res.status(404).json({ error: "Milestone not found" });
      if (row.IsDeleted)     return res.status(400).json({ error: "Booking is deleted" });
      if (row.DemandStatus !== "Pending")
        return res.status(400).json({ error: `Cannot raise demand — current status is ${row.DemandStatus}` });

      const demandNo      = buildDemandNo(row.BookingNo, row.SortOrder);
      const demandRaisedOn = new Date().toISOString().slice(0, 10); // today
      const dueDate       = req.body?.dueDate  || null;
      const notes         = (req.body?.notes   || "").trim() || null;

      await pool.request()
        .input("Id",             sql.Int,         termRowId)
        .input("DemandStatus",   sql.NVarChar(20), "Demanded")
        .input("DemandNo",       sql.NVarChar(60), demandNo)
        .input("DemandRaisedOn", sql.Date,         demandRaisedOn)
        .input("DueDate",        sql.Date,         dueDate)
        .input("DemandNotes",    sql.NVarChar(500), notes)
        .query(`
          UPDATE dbo.BookingPaymentTerms
          SET DemandStatus   = @DemandStatus,
              DemandNo       = @DemandNo,
              DemandRaisedOn = @DemandRaisedOn,
              DueDate        = COALESCE(@DueDate, DueDate),
              DemandNotes    = COALESCE(@DemandNotes, DemandNotes)
          WHERE Id = @Id
        `);

      res.json({ success: true, demandNo, demandRaisedOn });
    } catch (err) {
      console.error("PATCH /followup-demands/:id/raise:", err);
      res.status(500).json({ error: "Failed to raise demand" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/followup-demands/:id/undo-raise
// Revert a demand back to Pending (before payment is recorded).
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/:id/undo-raise",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "write"),
  async (req, res) => {
    try {
      const pool = getPool();
      const termRowId = parseId(req.params.id);
      if (!termRowId) return res.status(400).json({ error: "Invalid ID" });

      const existing = await pool.request()
        .input("Id", sql.Int, termRowId)
        .query("SELECT DemandStatus FROM dbo.BookingPaymentTerms WHERE Id = @Id");

      const row = existing.recordset[0];
      if (!row) return res.status(404).json({ error: "Milestone not found" });
      if (row.DemandStatus === "Paid")
        return res.status(400).json({ error: "Cannot undo a paid demand" });

      await pool.request()
        .input("Id", sql.Int, termRowId)
        .query(`
          UPDATE dbo.BookingPaymentTerms
          SET DemandStatus   = 'Pending',
              DemandNo       = NULL,
              DemandRaisedOn = NULL,
              DemandNotes    = NULL
          WHERE Id = @Id
        `);

      res.json({ success: true });
    } catch (err) {
      console.error("PATCH /followup-demands/:id/undo-raise:", err);
      res.status(500).json({ error: "Failed to undo demand" });
    }
  }
);

module.exports = router;
