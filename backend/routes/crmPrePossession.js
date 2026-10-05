const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireActiveBooking, resolveOcCcGate } = require("../services/crmWorkflowGuards");

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
    -- Auto-derived dues status: 1 when no milestone has an outstanding balance.
    -- Uses the same AmountDue/AmountPaid check as Handover — consistent source of truth.
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM dbo.CrmPaymentMilestone m
      WHERE m.BookingId = p.BookingId
        AND m.Status NOT IN ('Paid', 'Waived')
        AND m.AmountDue > ISNULL(m.AmountPaid, 0)
    ) THEN 1 ELSE 0 END AS DuesClearedCheck,
    (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m
     WHERE m.BookingId = p.BookingId
       AND m.Status NOT IN ('Paid', 'Waived')
       AND m.AmountDue > ISNULL(m.AmountPaid, 0)
    ) AS OutstandingDemandCount
  FROM dbo.CrmPrePossession p
  JOIN dbo.CrmBooking b ON b.Id = p.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
`;

// ── List: server-side paging / search / sort / status counts ─────────────────
//   GET /?page=1&pageSize=25&search=&status=&sortKey=&sortDir=&companyId=&projectId=&blockId=
//   → { rows, total, counts: { All, Pending, InProgress, Ready, Blocked } }
// `counts` honours search + company/project/block but NOT status. Without
// `page` the legacy full-array response is returned.
const PP_STATUSES = ["Pending", "InProgress", "Ready", "Blocked"];
const PP_SORT = {
  // Actionable first: Ready → InProgress → Pending → Blocked
  Priority: "CASE p.Status WHEN 'Ready' THEN 0 WHEN 'InProgress' THEN 1 WHEN 'Pending' THEN 2 ELSE 3 END",
  ApplicantName: "a.ApplicantName",
  BookingNo: "b.BookingNo",
  ScheduledInspectionDate: "p.ScheduledInspectionDate",
  InspectionCompletedDate: "p.InspectionCompletedDate",
  CreatedAt: "p.CreatedAt",
};
const PP_JOINS = `
  JOIN dbo.CrmBooking b ON b.Id = p.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
`;

function bindListFilters(request, query) {
  const conds = [];
  const intOf = (v) => { const x = parseInt(v, 10); return Number.isInteger(x) ? x : null; };
  const companyId = intOf(query.companyId);
  const projectId = intOf(query.projectId);
  const blockId = intOf(query.blockId);
  if (companyId) { request.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
  if (projectId) { request.input("projectId", sql.Int, projectId); conds.push("b.ProjectId = @projectId"); }
  if (blockId)   { request.input("blockId", sql.Int, blockId);     conds.push("b.BlockId = @blockId"); }
  const search = String(query.search || "").trim().slice(0, 100);
  if (search) {
    request.input("search", sql.NVarChar(220), `%${search.replace(/[\[%_]/g, "[$&]")}%`);
    conds.push("(a.ApplicantName LIKE @search OR b.BookingNo LIKE @search OR COALESCE(bn.UnitNo, b.UnitNo) LIKE @search OR a.Mobile LIKE @search)");
  }
  return conds;
}

router.get("/", requirePageRight("crm-pre-possession", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const baseCond = "b.Status NOT IN ('Cancelled','Rejected')";

    if (req.query.page === undefined) {
      const r0 = pool.request();
      const conds = [baseCond, ...bindListFilters(r0, req.query)];
      const result = await r0.query(`${PP_SELECT} LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId WHERE ${conds.join(" AND ")} ORDER BY p.CreatedAt DESC`);
      return res.json(result.recordset);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    // Own keys only: "constructor" / "__proto__" would otherwise resolve to built-ins and break the SQL.
    const sortExpr = Object.hasOwn(PP_SORT, req.query.sortKey) ? PP_SORT[req.query.sortKey] : PP_SORT.Priority;
    const dir = req.query.sortDir === "desc" ? "DESC" : "ASC";

    const countReq = pool.request();
    const countConds = [baseCond, ...bindListFilters(countReq, req.query)];
    const countRes = await countReq.query(
      `SELECT p.Status, COUNT(*) AS C FROM dbo.CrmPrePossession p ${PP_JOINS} WHERE ${countConds.join(" AND ")} GROUP BY p.Status`
    );
    const counts = { All: 0 };
    for (const row of countRes.recordset) { counts[row.Status] = row.C; counts.All += row.C; }
    const total = PP_STATUSES.includes(req.query.status) ? (counts[req.query.status] || 0) : counts.All;

    const pageReq = pool.request();
    const pageConds = [baseCond, ...bindListFilters(pageReq, req.query)];
    if (PP_STATUSES.includes(req.query.status)) {
      pageReq.input("status", sql.NVarChar(30), req.query.status);
      pageConds.push("p.Status = @status");
    }
    pageReq.input("offset", sql.Int, (page - 1) * pageSize);
    pageReq.input("pageSize", sql.Int, pageSize);
    const rowsRes = await pageReq.query(
      `${PP_SELECT} LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
       WHERE ${pageConds.join(" AND ")}
       ORDER BY ${sortExpr} ${dir}, p.CreatedAt DESC, p.Id DESC
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`
    );
    res.json({ rows: rowsRes.recordset, total, counts });
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

    const bindConds = (request) => [
      "b.IsActive = 1",
      "b.Status NOT IN ('" + cancelled + "', '" + rejected + "')",
      "NOT EXISTS (SELECT 1 FROM dbo.CrmPrePossession pp WHERE pp.BookingId = b.Id)",
      ...bindListFilters(request, req.query),
    ];
    const buildSelect = (conds) => [
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
      // Block-level OC/CC (see migration 447) is authoritative when this
      // booking's own block has a Received cert of its own; otherwise the
      // project's blanket (BlockId IS NULL) cert still clears the gate —
      // same fallback resolveOcCcGate (crmWorkflowGuards.js) implements in
      // JS for single-booking lookups. Kept inline here since this is one
      // big multi-row query, not a per-booking JS call.
      "  CASE WHEN b.ProjectId IS NULL OR EXISTS (",
      "    SELECT 1 FROM dbo.CrmOccupancyCertificate oc",
      "    WHERE oc.Status = 'Received' AND (",
      "      (um.BlockId IS NOT NULL AND oc.BlockId = um.BlockId)",
      "      OR (oc.ProjectId = b.ProjectId AND oc.BlockId IS NULL)",
      "    )",
      "  ) THEN 1 ELSE 0 END AS Gate2_OcCcReceived",
      "FROM dbo.CrmBooking b",
      "JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId",
      "LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id",
      "LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId",
      "OUTER APPLY (SELECT TOP 1 Status FROM dbo.CrmAgreement       WHERE BookingId = b.Id ORDER BY CreatedAt DESC) ag_disp",
      "OUTER APPLY (SELECT TOP 1 Status FROM dbo.CrmAfsQueryPayment WHERE BookingId = b.Id ORDER BY CreatedAt DESC) aqp_disp",
      "OUTER APPLY (SELECT TOP 1 Status FROM dbo.CrmAfsRegistry     WHERE BookingId = b.Id ORDER BY CreatedAt DESC) areg_disp",
      "WHERE " + conds.join(" AND "),
    ].join(" ");

    const r1 = pool.request();
    const select = buildSelect(bindConds(r1));

    // Legacy: full array, no paging.
    if (req.query.page === undefined) {
      const result = await r1.query(select + " ORDER BY b.BookingNo");
      return res.json(result.recordset);
    }

    // Paged:  GET /gateway-status?page=&pageSize=&search=&status=Eligible&sortKey=&sortDir=&companyId=…
    //   → { rows, total, counts: { All, Eligible } }   (counts ignore the Eligible filter)
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const GW_SORT = { BookingNo: "BookingNo", ApplicantName: "ApplicantName", UnitNo: "UnitNo" };
    const sortCol = Object.hasOwn(GW_SORT, req.query.sortKey) ? GW_SORT[req.query.sortKey] : "BookingNo";
    const dir = req.query.sortDir === "desc" ? "DESC" : "ASC";
    const eligibleOnly = req.query.status === "Eligible";

    const countRes = await r1.query(
      `WITH g AS (${select})
       SELECT COUNT(*) AS Total,
              ISNULL(SUM(CASE WHEN Gate1_AfsRegistered = 1 AND Gate2_OcCcReceived = 1 THEN 1 ELSE 0 END), 0) AS Eligible
       FROM g`
    );
    const counts = { All: countRes.recordset[0].Total, Eligible: countRes.recordset[0].Eligible };

    const r2 = pool.request();
    bindConds(r2);
    r2.input("offset", sql.Int, (page - 1) * pageSize);
    r2.input("pageSize", sql.Int, pageSize);
    const rowsRes = await r2.query(
      `WITH g AS (${select})
       SELECT * FROM g
       ${eligibleOnly ? "WHERE Gate1_AfsRegistered = 1 AND Gate2_OcCcReceived = 1" : ""}
       ORDER BY ${sortCol} ${dir}, BookingId
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`
    );
    res.json({ rows: rowsRes.recordset, total: eligibleOnly ? counts.Eligible : counts.All, counts });
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
      "LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId",
      "WHERE b.IsActive = 1",
      "  AND b.Status NOT IN ('" + cancelled + "', '" + rejected + "', 'Transferred')",
      "  AND NOT EXISTS (SELECT 1 FROM dbo.CrmPrePossession pp WHERE pp.BookingId = b.Id)",
      // Agreement for Sale, registered at the Sub-Registrar, is mandatory
      // for every booking regardless of project type — no exception.
      "  AND EXISTS (SELECT 1 FROM dbo.CrmAgreement ag WHERE ag.BookingId = b.Id AND ag.Status = 'Registered')",
      // Same block-then-project OC/CC fallback as /gateway-status above.
      "  AND (b.ProjectId IS NULL OR EXISTS (",
      "    SELECT 1 FROM dbo.CrmOccupancyCertificate oc",
      "    WHERE oc.Status = 'Received' AND (",
      "      (um.BlockId IS NOT NULL AND oc.BlockId = um.BlockId)",
      "      OR (oc.ProjectId = b.ProjectId AND oc.BlockId IS NULL)",
      "    )",
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

    // Agreement for Sale must be Registered — mandatory for every booking,
    // regardless of project type.
    const agr = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC");
    if (!agr.recordset.length)
      return res.status(400).json({ error: "Pre-possession check requires an Agreement for Sale to exist first" });
    if (agr.recordset[0].Status !== CrmStatus.REGISTERED)
      return res.status(400).json({ error: "Pre-possession check requires the Agreement for Sale to be Registered (AFS registered at Sub-Registrar) first" });

    const bk = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 ProjectId FROM dbo.CrmBooking WHERE Id = @bid");
    if (bk.recordset[0]?.ProjectId) {
      // Block-level OC/CC (migration 447) is checked first, falling back to
      // the project's blanket cert — see resolveOcCcGate.
      const gate = await resolveOcCcGate(pool, bookingId);
      if (!gate.received)
        return res.status(400).json({ error: "Pre-possession inspection requires the project's (or this unit's block's) OC / CC to be received first" });
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
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

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
      .input("sdt",       sql.Date,              b.ScheduledInspectionDate || null)
      .input("sdt_set",   sql.Bit,               "ScheduledInspectionDate" in b ? 1 : 0)
      .input("icd",       sql.Date,              b.InspectionCompletedDate || null)
      .input("icd_set",   sql.Bit,               "InspectionCompletedDate" in b ? 1 : 0)
      .input("note",      sql.NVarChar(sql.MAX), b.Notes ?? null)
      .input("note_set",  sql.Bit,               "Notes" in b ? 1 : 0)
      .input("ub",   sql.Int,  actorId(req))
      .query(`
        DECLARE @doc_eff  BIT = ISNULL(@doc,  (SELECT DocumentationCheck     FROM dbo.CrmPrePossession WHERE Id = @id));
        DECLARE @qc_eff   BIT = ISNULL(@qc,   (SELECT QualityInspectionCheck FROM dbo.CrmPrePossession WHERE Id = @id));
        DECLARE @util_eff BIT = ISNULL(@util, (SELECT UtilityReadinessCheck  FROM dbo.CrmPrePossession WHERE Id = @id));

        -- Dues clearance: computed live — true when no milestone has an outstanding balance.
        -- Consistent with the Handover payment gate (AmountDue/AmountPaid check).
        DECLARE @dues_cleared BIT = CASE WHEN NOT EXISTS (
          SELECT 1 FROM dbo.CrmPaymentMilestone m
          WHERE m.BookingId = @bid
            AND m.Status NOT IN ('Paid', 'Waived')
            AND m.AmountDue > ISNULL(m.AmountPaid, 0)
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
          ScheduledInspectionDate = CASE WHEN @sdt_set  = 1 THEN @sdt  ELSE ScheduledInspectionDate END,
          InspectionCompletedDate = CASE WHEN @icd_set  = 1 THEN @icd  ELSE InspectionCompletedDate END,
          Notes                   = CASE WHEN @note_set = 1 THEN @note ELSE Notes END,
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