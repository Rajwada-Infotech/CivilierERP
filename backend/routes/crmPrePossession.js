const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(apiRateLimit);

// DuesClearedCheck is computed live from CrmPaymentMilestone.DemandStatus —
// the stored BIT column is intentionally not read (schema artefact; auto-derive
// is the source of truth). OutstandingDemandCount is included so the frontend
// can show "N demands outstanding" without a second round-trip.
const PP_SELECT = `
  SELECT
    p.Id, p.BookingId,
    p.ScheduledInspectionDate, p.InspectionCompletedDate,
    p.DocumentationCheck, p.QualityInspectionCheck, p.UtilityReadinessCheck,
    p.Status, p.Notes, p.CreatedAt, p.UpdatedAt,
    b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
    a.ApplicantName, a.Mobile,
    -- Auto-derived dues status: 1 when no milestone is in Demanded-but-unpaid state
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM dbo.CrmPaymentMilestone m
      WHERE m.BookingId = p.BookingId AND m.DemandStatus = 'Demanded'
    ) THEN 1 ELSE 0 END AS DuesClearedCheck,
    (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m
     WHERE m.BookingId = p.BookingId AND m.DemandStatus = 'Demanded'
    ) AS OutstandingDemandCount
  FROM dbo.CrmPrePossession p
  JOIN dbo.CrmBooking b ON b.Id = p.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
`;

router.get("/", requirePageRight("crm-pre-possession", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${PP_SELECT} ORDER BY p.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-pre-possession] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /gateway-status — all active bookings without a pre-possession record,
// each annotated with per-sub-gate pass/fail so the UI can show the full
// Gate-1 chain (AFS Query Payment → AFS Registry → Agreement Registered)
// and Gate-2 (project OC/CC Received). Single SQL, no N+1.
router.get("/gateway-status", requirePageRight("crm-pre-possession", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cancelled = CrmStatus.CANCELLED;
    const rejected  = CrmStatus.REJECTED;
    const q = [
      "SELECT",
      "  b.Id AS BookingId, b.BookingNo, b.ProjectId,",
      "  COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,",
      "  a.ApplicantName,",
      "  ag_disp.Status                 AS AgreementStatus,",
      "  aqp_disp.Status                AS AfsQpStatus,",
      "  areg_disp.Status               AS AfsRegStatus,",
      "  CASE WHEN EXISTS (",
      "    SELECT 1 FROM dbo.CrmAgreement ag WHERE ag.BookingId = b.Id AND ag.Status IN ('Executed','Registered')",
      "  ) THEN 1 ELSE 0 END AS Gate0_AgreementExecuted,",
      "  CASE WHEN EXISTS (",
      "    SELECT 1 FROM dbo.CrmAgreement ag WHERE ag.BookingId = b.Id AND ag.Status = 'Registered'",
      "  ) THEN 1 ELSE 0 END AS Gate1_AfsRegistered,",
      "  CASE WHEN EXISTS (",
      "    SELECT 1 FROM dbo.CrmAfsQueryPayment aqp WHERE aqp.BookingId = b.Id AND aqp.Status = 'Confirmed'",
      "  ) THEN 1 ELSE 0 END AS Gate1a_AfsQueryPayment,",
      "  CASE WHEN EXISTS (",
      "    SELECT 1 FROM dbo.CrmAfsRegistry areg WHERE areg.BookingId = b.Id AND areg.Status = 'Completed'",
      "  ) THEN 1 ELSE 0 END AS Gate1b_AfsRegistryCompleted,",
      "  CASE WHEN b.ProjectId IS NULL OR EXISTS (",
      "    SELECT 1 FROM dbo.CrmOccupancyCertificate oc",
      "    WHERE oc.ProjectId = b.ProjectId AND oc.Status = 'Received'",
      "  ) THEN 1 ELSE 0 END AS Gate2_OcCcReceived",
      "FROM dbo.CrmBooking b",
      "JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId",
      "LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id",
      "OUTER APPLY (SELECT TOP 1 Status FROM dbo.CrmAgreement       WHERE BookingId = b.Id ORDER BY CreatedAt DESC) ag_disp",
      "OUTER APPLY (SELECT TOP 1 Status FROM dbo.CrmAfsQueryPayment WHERE BookingId = b.Id ORDER BY CreatedAt DESC) aqp_disp",
      "OUTER APPLY (SELECT TOP 1 Status FROM dbo.CrmAfsRegistry     WHERE BookingId = b.Id ORDER BY CreatedAt DESC) areg_disp",
      "WHERE b.IsActive = 1",
      "  AND b.Status NOT IN ('" + cancelled + "', '" + rejected + "')",
      "  AND NOT EXISTS (SELECT 1 FROM dbo.CrmPrePossession pp WHERE pp.BookingId = b.Id)",
      "ORDER BY b.BookingNo",
    ].join(" ");
    const result = await pool.request().query(q);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-pre-possession] GET /gateway-status error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /eligible-bookings — bookings that satisfy all gates (for the create dropdown).
// Uses EXISTS for the agreement check to avoid duplicate rows when a booking
// has multiple agreement revisions. Single SQL pass; no N+1.
router.get("/eligible-bookings", requirePageRight("crm-pre-possession", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const cancelled = CrmStatus.CANCELLED;
    const rejected  = CrmStatus.REJECTED;
    const q = [
      "SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName",
      "FROM dbo.CrmBooking b",
      "JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId",
      "LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id",
      "WHERE b.IsActive = 1",
      "  AND b.Status NOT IN ('" + cancelled + "', '" + rejected + "')",
      "  AND NOT EXISTS (SELECT 1 FROM dbo.CrmPrePossession pp WHERE pp.BookingId = b.Id)",
      "  AND EXISTS (SELECT 1 FROM dbo.CrmAgreement ag WHERE ag.BookingId = b.Id AND ag.Status = 'Registered')",
      "  AND (b.ProjectId IS NULL OR EXISTS (",
      "    SELECT 1 FROM dbo.CrmOccupancyCertificate oc",
      "    WHERE oc.ProjectId = b.ProjectId AND oc.Status = 'Received'",
      "  ))",
      "ORDER BY b.BookingNo",
    ].join(" ");
    const result = await pool.request().query(q);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-pre-possession] GET /eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create a new pre-possession check record.
// Gates: active booking, AFS Registered, project OC/CC Received.
router.post("/", requirePageRight("crm-pre-possession", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const agr = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC");
    if (!agr.recordset.length)
      return res.status(400).json({ error: "Pre-possession check requires an Agreement for Sale to exist first" });
    if (agr.recordset[0].Status !== CrmStatus.REGISTERED)
      return res.status(400).json({ error: "Pre-possession check requires the Agreement for Sale to be Registered (AFS registered at Sub-Registrar) first" });

    const bk = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 ProjectId FROM dbo.CrmBooking WHERE Id = @bid");
    if (bk.recordset[0]?.ProjectId) {
      const occc = await pool.request().input("pid", sql.Int, bk.recordset[0].ProjectId)
        .query("SELECT TOP 1 Id FROM dbo.CrmOccupancyCertificate WHERE ProjectId = @pid AND Status = 'Received'");
      if (!occc.recordset.length)
        return res.status(400).json({ error: "Pre-possession inspection requires the project's OC / CC to be received first" });
    }

    const result = await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("sdt", sql.Date, b.ScheduledInspectionDate || null)
      .input("cb",  sql.Int,  actorId(req))
      .query(`
        INSERT INTO dbo.CrmPrePossession
          (BookingId, ScheduledInspectionDate, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @sdt, '${CrmStatus.PENDING}', @cb, SYSDATETIME())
      `);

    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    // SQL Server error 2627 = unique constraint violation; 2601 = unique index violation
    if (e.number === 2627 || e.number === 2601 ||
        e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Pre-possession check already exists for this booking" });
    console.error("[crm-pre-possession] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update manual checklist items and persist dates/notes.
// DuesClearedCheck is NOT accepted as input — it is always auto-derived from
// CrmPaymentMilestone (see PP_SELECT). Status is fully recomputed on every PUT:
//
//   All three manual checks done AND dues auto-cleared → Ready
//   Any check done (or dues cleared) but not all done  → InProgress
//   Nothing done                                        → Pending
//
// Blocked is not auto-assigned here; it is reserved for an explicit future
// operator action (e.g. a flagged dispute). The transition never gets stuck at
// Ready: if a manual check is unticked, status falls back to InProgress/Pending.
router.put("/:id", requirePageRight("crm-pre-possession", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    // Fetch the BookingId so we can compute dues clearance in the UPDATE.
    const ppRow = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmPrePossession WHERE Id = @id");
    if (!ppRow.recordset.length) return res.status(404).json({ error: "Pre-possession record not found" });
    const bookingId = ppRow.recordset[0].BookingId;

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const result = await pool.request()
      .input("id",   sql.Int,  id)
      .input("bid",  sql.Int,  bookingId)
      .input("doc",  sql.Bit,  b.DocumentationCheck     !== undefined ? (b.DocumentationCheck     ? 1 : 0) : null)
      .input("qc",   sql.Bit,  b.QualityInspectionCheck !== undefined ? (b.QualityInspectionCheck ? 1 : 0) : null)
      .input("util", sql.Bit,  b.UtilityReadinessCheck  !== undefined ? (b.UtilityReadinessCheck  ? 1 : 0) : null)
      .input("sdt",  sql.Date, b.ScheduledInspectionDate || null)
      .input("icd",  sql.Date, b.InspectionCompletedDate || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes !== undefined ? b.Notes : null)
      .input("ub",   sql.Int,  actorId(req))
      .query(`
        DECLARE @doc_eff  BIT = ISNULL(@doc,  (SELECT DocumentationCheck     FROM dbo.CrmPrePossession WHERE Id = @id));
        DECLARE @qc_eff   BIT = ISNULL(@qc,   (SELECT QualityInspectionCheck FROM dbo.CrmPrePossession WHERE Id = @id));
        DECLARE @util_eff BIT = ISNULL(@util, (SELECT UtilityReadinessCheck  FROM dbo.CrmPrePossession WHERE Id = @id));

        -- Dues clearance: computed live — true when no milestone has DemandStatus = 'Demanded'
        DECLARE @dues_cleared BIT = CASE WHEN NOT EXISTS (
          SELECT 1 FROM dbo.CrmPaymentMilestone m
          WHERE m.BookingId = @bid AND m.DemandStatus = 'Demanded'
        ) THEN 1 ELSE 0 END;

        DECLARE @new_status NVARCHAR(30) =
          CASE
            -- All four checks pass → Ready
            WHEN @dues_cleared = 1 AND @doc_eff = 1 AND @qc_eff = 1 AND @util_eff = 1 THEN 'Ready'
            -- At least one check done or dues clear → InProgress
            WHEN @dues_cleared = 1 OR @doc_eff = 1 OR @qc_eff = 1 OR @util_eff = 1   THEN 'InProgress'
            -- Nothing done → Pending
            ELSE 'Pending'
          END;

        DECLARE @upd TABLE (Status NVARCHAR(30));

        UPDATE dbo.CrmPrePossession SET
          DocumentationCheck      = ISNULL(@doc,  DocumentationCheck),
          QualityInspectionCheck  = ISNULL(@qc,   QualityInspectionCheck),
          UtilityReadinessCheck   = ISNULL(@util, UtilityReadinessCheck),
          ScheduledInspectionDate = ISNULL(@sdt,  ScheduledInspectionDate),
          InspectionCompletedDate = ISNULL(@icd,  InspectionCompletedDate),
          Notes                   = ISNULL(@note, Notes),
          Status                  = @new_status,
          UpdatedBy               = @ub,
          UpdatedAt               = SYSDATETIME()
        OUTPUT INSERTED.Status INTO @upd
        WHERE Id = @id;

        SELECT u.Status, @dues_cleared AS DuesClearedCheck FROM @upd u;
      `);

    const row = result.recordset[0];
    res.json({ success: true, status: row?.Status, duesClearedCheck: row?.DuesClearedCheck === 1 });
  } catch (e) {
    console.error("[crm-pre-possession] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
