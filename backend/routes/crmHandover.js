const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
// Project access: a restricted user gets 403 on records outside their projects.
{ const { crmProjectGuards, crmViaBookingSql } = require("../services/projectScope"); crmProjectGuards(router, crmViaBookingSql("CrmHandover")); }
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { emitNotification } = require("../services/notify");
const { requireActiveBooking, maybeAutoCreateSalesDeed } = require("../services/crmWorkflowGuards");
const { assertBookingProjectScope } = require("../services/assertBookingProjectScope");
const { getBookingFunding, bookingFullyFundedSql } = require("../services/crmPaymentFunding");

router.use(authMiddleware);
router.use(apiRateLimit);

const SNAG_CATEGORIES = ["Electrical", "Plumbing", "Civil", "Paint", "Carpentry", "Other"];

const HANDOVER_SELECT = `
  SELECT
    h.Id, h.BookingId, h.ScheduledDate, h.ActualHandoverDate, h.KeyHandoverBy,
    h.FinalDuesCleared, h.CustomerAcknowledged, h.Status, h.Notes,
    h.CreatedAt, h.UpdatedAt,
    b.BookingNo,
    COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
    COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
    b.TotalValue, b.AssignedTo,
    a.ApplicantName, a.Mobile,
    kh.name AS KeyHandoverByName,
    (SELECT COUNT(*) FROM dbo.CrmSnagItem s WHERE s.HandoverId = h.Id AND s.Status IN ('${CrmStatus.OPEN}','${CrmStatus.IN_PROGRESS}')) AS OpenSnagCount
  FROM dbo.CrmHandover h
  JOIN  dbo.CrmBooking b     ON b.Id = h.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.Users kh     ON kh.id = h.KeyHandoverBy
`;

// ── List: server-side paging / search / sort / status counts ─────────────────
// Same contract as CrmPossessionNotice / CrmMutation / CrmNoc:
//   GET /?page=1&pageSize=25&search=&status=&sortKey=&sortDir=&companyId=&projectId=&blockId=
//   → { rows, total, counts: { All, Scheduled, SnagInspection, SnagPending, Completed, Cancelled } }
// `counts` honours search + company/project/block but NOT status, so the
// tabs always show what each status would contain. `?bookingId=` is a
// separate deep-link lookup mode that always returns the small bare-array
// result, bypassing pagination entirely. Without `page` the legacy
// full-array response is returned so existing callers keep working.
const HO_STATUSES = ["Scheduled", "SnagInspection", "SnagPending", "Completed", "Cancelled"];
const HO_SORT = {
  ApplicantName: "a.ApplicantName",
  BookingNo: "b.BookingNo",
  Status: "h.Status",
  ScheduledDate: "h.ScheduledDate",
  ActualHandoverDate: "h.ActualHandoverDate",
  CreatedAt: "h.CreatedAt",
};
function buildHoWhere(request, query, includeStatus, projectScope = null) {
  const conds = [];
  if (projectScope) conds.push(require("../services/projectScope").projectPredicate(projectScope, "b.ProjectId", "").trim());
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
    conds.push("(a.ApplicantName LIKE @search OR b.BookingNo LIKE @search OR COALESCE(bn.UnitNo, b.UnitNo) LIKE @search)");
  }
  if (includeStatus && HO_STATUSES.includes(query.status)) {
    request.input("status", sql.NVarChar(30), query.status);
    conds.push("h.Status = @status");
  }
  return conds.length ? "WHERE " + conds.join(" AND ") : "";
}

// GET / — all handovers
router.get("/", requirePageRight("crm-handover", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { bookingId } = req.query;
    const SELECT_WITH_BLOCK = `${HANDOVER_SELECT} LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId`;
    const ORDER = "ORDER BY h.ScheduledDate ASC, h.CreatedAt DESC";

    // Deep-link lookup mode ("does this one booking already have a
    // handover?") — always returns the small bare-array result, bypassing
    // pagination entirely, same convention as crmBookings.js's applicationId
    // scope and crmMoneyReceipts.js's bookingId scope.
    if (bookingId) {
      const r0 = pool.request().input("bid", sql.Int, parseInt(bookingId, 10));
      const scope = req.projectScope ? `AND ${require("../services/projectScope").projectPredicate(req.projectScope, "b.ProjectId", "").trim()}` : "";
      const result = await r0.query(`${SELECT_WITH_BLOCK} WHERE h.BookingId = @bid ${scope} ${ORDER}`);
      return res.json(result.recordset);
    }

    if (req.query.page === undefined) {
      const r0 = pool.request();
      const where = buildHoWhere(r0, req.query, true, req.projectScope);
      const result = await r0.query(`${SELECT_WITH_BLOCK} ${where} ${ORDER}`);
      return res.json(result.recordset);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const sortCol = Object.hasOwn(HO_SORT, req.query.sortKey) ? HO_SORT[req.query.sortKey] : HO_SORT.ScheduledDate;
    const dir = req.query.sortDir === "asc" ? "ASC" : "DESC";

    const countReq = pool.request();
    const countWhere = buildHoWhere(countReq, req.query, false, req.projectScope);
    const countRes = await countReq.query(
      `SELECT h.Status, COUNT(*) AS C FROM dbo.CrmHandover h
       JOIN dbo.CrmBooking b ON b.Id = h.BookingId
       JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
       LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
       ${countWhere} GROUP BY h.Status`
    );
    const counts = { All: 0 };
    for (const row of countRes.recordset) { counts[row.Status] = row.C; counts.All += row.C; }
    const total = HO_STATUSES.includes(req.query.status) ? (counts[req.query.status] || 0) : counts.All;

    const pageReq = pool.request();
    const pageWhere = buildHoWhere(pageReq, req.query, true, req.projectScope);
    pageReq.input("offset", sql.Int, (page - 1) * pageSize);
    pageReq.input("pageSize", sql.Int, pageSize);
    const rowsRes = await pageReq.query(
      `${SELECT_WITH_BLOCK} ${pageWhere} ORDER BY ${sortCol} ${dir}, h.Id DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`
    );
    res.json({ rows: rowsRes.recordset, total, counts });
  } catch (e) {
    console.error("[crm-handover] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /eligible-bookings — bookings that satisfy every handover prerequisite
// (AFS Registered, Possession Notice Acknowledged, no pending NOCs). Mirrors
// the POST / guard exactly so the frontend dropdown never shows bookings that
// will fail on submit.
// Registered ahead of GET /:id so "eligible-bookings" is not swallowed by :id.
router.get("/eligible-bookings", requirePageRight("crm-handover", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const scope = req.projectScope ? require("../services/projectScope").projectPredicate(req.projectScope, "b.ProjectId") : "";
    // Single query replacing the prior N+1 loop (4 individual queries per booking).
    // All four prerequisite checks are inlined as EXISTS/NOT EXISTS / subquery
    // conditions so only one round-trip is needed regardless of how many
    // candidate bookings exist.
    const result = await pool.request().query(`
      SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}', 'Expired','Transferred')
        ${scope}
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmHandover h WHERE h.BookingId = b.Id AND h.Status <> '${CrmStatus.CANCELLED}')
        -- 1. Agreement must be Registered
        AND EXISTS (
          SELECT 1 FROM dbo.CrmAgreement ag
          WHERE ag.BookingId = b.Id AND ag.Status = '${CrmStatus.REGISTERED}'
        )
        -- 2. Possession Notice must be Acknowledged
        AND EXISTS (
          SELECT 1 FROM dbo.CrmPossessionNotice pn
          WHERE pn.BookingId = b.Id AND pn.Status = 'Acknowledged'
            AND pn.CreatedAt = (
              SELECT MAX(CreatedAt) FROM dbo.CrmPossessionNotice WHERE BookingId = b.Id
            )
        )
        -- 3. No NOC left in Pending or Approved
        AND NOT EXISTS (
          SELECT 1 FROM dbo.CrmNoc n WHERE n.BookingId = b.Id AND n.Status IN ('Pending','Approved')
        )
        -- 4. Net booking funding covers every non-waived due.
        AND (${bookingFullyFundedSql("b.Id")})
      ORDER BY b.BookingNo
    `);

    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-handover] GET /eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});


// GET /:id — handover with snag list
router.get("/:id", requirePageRight("crm-handover", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const [hRes, sRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${HANDOVER_SELECT} WHERE h.Id = @id`),
      pool.request().input("id", sql.Int, id).query(`
        SELECT s.*, rb.name AS RaisedByName, rs.name AS ResolvedByName
        FROM dbo.CrmSnagItem s
        LEFT JOIN dbo.Users rb ON rb.id = s.RaisedBy
        LEFT JOIN dbo.Users rs ON rs.id = s.ResolvedBy
        WHERE s.HandoverId = @id ORDER BY s.CreatedAt DESC
      `),
    ]);
    if (!hRes.recordset[0]) return res.status(404).json({ error: "Handover not found" });
    res.json({ handover: hRes.recordset[0], snags: sRes.recordset });
  } catch (e) {
    console.error("[crm-handover] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — schedule handover for a booking
router.post("/", requirePageRight("crm-handover", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });

    const projectId = await assertBookingProjectScope(req, res, b.BookingId);
    if (projectId === false) return;

    const activeErr = await requireActiveBooking(pool, parseInt(b.BookingId));
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Workflow guard: Agreement for Sale must be Registered (physically
    // registered at Sub-Registrar, own Doc No recorded). Executed alone is
    // not sufficient — the AFS registration is the binding legal anchor.
    // Mandatory for every booking, regardless of project type.
    const agr = await pool.request()
      .input("bid", sql.Int, parseInt(b.BookingId))
      .query(`SELECT TOP 1 Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CASE WHEN Status = 'Cancelled' THEN 1 ELSE 0 END, Id DESC`);
    if (!agr.recordset.length || agr.recordset[0].Status !== CrmStatus.REGISTERED) {
      return res.status(400).json({ error: "Handover requires the Agreement for Sale to be Registered (AFS registered at Sub-Registrar) first" });
    }

    // Workflow guard: Possession Notice must be Acknowledged by the customer
    // before keys are handed over — the customer's written acceptance of the
    // possession offer is the trigger for the physical handover event.
    const pn = await pool.request()
      .input("bid", sql.Int, parseInt(b.BookingId))
      .query(`SELECT TOP 1 Status FROM dbo.CrmPossessionNotice WHERE BookingId = @bid ORDER BY CreatedAt DESC`);
    if (!pn.recordset.length || pn.recordset[0].Status !== "Acknowledged") {
      return res.status(400).json({ error: "Handover requires the Possession Notice to be Acknowledged by the customer first" });
    }

    // Workflow guard: if an NOC (Org or Bank) was ever requested for this
    // booking, it has to have actually been issued before handover — a NOC
    // in Pending/Approved-but-not-yet-issued means the paperwork isn't
    // physically done yet. Bookings that never needed an NOC (no loan, no
    // society clearance required) aren't blocked — this only fires when a
    // request exists and was left unfinished.
    const openNoc = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query(`SELECT TOP 1 NocType, Status FROM dbo.CrmNoc WHERE BookingId = @bid AND Status IN ('${CrmStatus.PENDING}', '${CrmStatus.APPROVED}')`);
    if (openNoc.recordset.length) {
      return res.status(400).json({ error: `Handover requires the ${openNoc.recordset[0].NocType} NOC to be issued first (currently ${openNoc.recordset[0].Status})` });
    }

    // Under the full-booking hold rule, milestone rows can remain unpaid while
    // valid customer funds are still available On Account. Gate on net booking
    // funding so those funds count once and invalid deposits never clear dues.
    const funding = await getBookingFunding(pool, b.BookingId);
    if (funding.shortfall > 0.009) {
      const bal = Math.round(funding.shortfall);
      return res.status(400).json({ error: `Handover cannot be scheduled — the booking has an outstanding balance of ₹${bal.toLocaleString("en-IN")}` });
    }

    const result = await pool.request()
      .input("bid",  sql.Int,  parseInt(b.BookingId))
      .input("sdt",  sql.Date, b.ScheduledDate || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,  actorId(req))
      .query(`
        INSERT INTO dbo.CrmHandover (BookingId, ScheduledDate, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @sdt, 'Scheduled', @note, @cb, SYSDATETIME())
      `);

    // Notify assigned salesperson
    const bk = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT AssignedTo, BookingNo FROM dbo.CrmBooking WHERE Id = @bid");
    if (bk.recordset[0]?.AssignedTo) {
      await emitNotification(pool, bk.recordset[0].AssignedTo, "handover_scheduled",
        "Handover Scheduled", `Handover scheduled for booking ${bk.recordset[0].BookingNo}`,
        result.recordset[0].Id, "handover");
    }

    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "This booking already has a handover in progress or completed — a new one can be scheduled only after cancelling it" });
    console.error("[crm-handover] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — progress handover through the forward-only state machine:
//   Scheduled → SnagInspection → SnagPending → Completed
//   Any non-terminal state → Cancelled
// Generic field updates (ScheduledDate, Notes) are always allowed regardless
// of the Status transition requested. Completing requires all 4 mandatory
// fields: ActualHandoverDate, KeyHandoverBy, FinalDuesCleared=true, CustomerAcknowledged=true.
router.put("/:id", requirePageRight("crm-handover", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    const cur0 = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmHandover WHERE Id = @id");
    if (!cur0.recordset.length) return res.status(404).json({ error: "Handover not found" });
    const activeErr0 = await requireActiveBooking(pool, cur0.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    const currentStatus = cur0.recordset[0].Status;

    // Enforce forward-only state machine transitions when a new Status is requested
    if (b.Status && b.Status !== currentStatus) {
      const ALLOWED_TRANSITIONS = {
        Scheduled:      ["SnagInspection", CrmStatus.CANCELLED],
        SnagInspection: ["SnagPending", "Completed", CrmStatus.CANCELLED],
        SnagPending:    ["Completed", CrmStatus.CANCELLED],
        Completed:      [],   // terminal
        Cancelled:      [],   // terminal
      };
      const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(b.Status)) {
        return res.status(400).json({
          error: `Cannot transition from '${currentStatus}' to '${b.Status}'. Allowed: ${allowed.length ? allowed.join(", ") : "none (terminal state)"}`,
        });
      }
    }

    // Guard: cannot mark Completed while open snags remain
    if (b.Status === "Completed") {
      const openSnags = await pool.request().input("id", sql.Int, id)
        .query(`SELECT COUNT(*) AS cnt FROM dbo.CrmSnagItem WHERE HandoverId = @id AND Status IN ('${CrmStatus.OPEN}','${CrmStatus.IN_PROGRESS}')`);
      if (openSnags.recordset[0].cnt > 0) {
        return res.status(400).json({ error: "Cannot complete handover — unresolved snag items remain" });
      }
      // All four completion fields are mandatory — these record the physical event
      if (!b.ActualHandoverDate) {
        return res.status(400).json({ error: "ActualHandoverDate is required to complete a handover" });
      }
      if (!b.KeyHandoverBy) {
        return res.status(400).json({ error: "KeyHandoverBy (the staff member who handed the key) is required" });
      }
      if (!b.FinalDuesCleared) {
        return res.status(400).json({ error: "FinalDuesCleared must be confirmed before completing handover" });
      }
      // Recheck net funding at completion because new charges or a bounced
      // receipt can change the balance after the handover was scheduled.
      {
        const funding = await getBookingFunding(pool, cur0.recordset[0].BookingId);
        if (funding.shortfall > 0.009) {
          return res.status(400).json({ error: `Cannot complete handover — the booking still owes ₹${Math.round(funding.shortfall).toLocaleString("en-IN")}` });
        }
      }
      if (!b.CustomerAcknowledged) {
        return res.status(400).json({ error: "CustomerAcknowledged must be confirmed before completing handover" });
      }
    }

    const hRow = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmHandover WHERE Id = @id");
    const handoverBookingId = hRow.recordset[0]?.BookingId;

    await pool.request()
      .input("id",   sql.Int,  id)
      .input("sdt",  sql.Date, b.ScheduledDate || null)
      .input("adt",  sql.Date, b.ActualHandoverDate || null)
      .input("khb",  sql.Int,  b.KeyHandoverBy ? parseInt(b.KeyHandoverBy) : null)
      // A field the caller didn't send keeps its value (a stage move sends
      // only Status) — it used to reset both ticks to "no" and wipe the notes.
      .input("fdc",  sql.Bit,  b.FinalDuesCleared === undefined ? null : (b.FinalDuesCleared ? 1 : 0))
      .input("ack",  sql.Bit,  b.CustomerAcknowledged === undefined ? null : (b.CustomerAcknowledged ? 1 : 0))
      .input("st",   sql.NVarChar(30), b.Status || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes === undefined ? null : (b.Notes || ""))
      .input("keepNote", sql.Bit, b.Notes === undefined ? 1 : 0)
      .input("ub",   sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmHandover SET
          ScheduledDate = ISNULL(@sdt, ScheduledDate),
          ActualHandoverDate = ISNULL(@adt, ActualHandoverDate),
          KeyHandoverBy = ISNULL(@khb, KeyHandoverBy),
          FinalDuesCleared = ISNULL(@fdc, FinalDuesCleared), CustomerAcknowledged = ISNULL(@ack, CustomerAcknowledged),
          Status = ISNULL(@st, Status), Notes = CASE WHEN @keepNote = 1 THEN Notes ELSE NULLIF(@note, N'') END,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Auto-create the Sale Deed shell when handover is completed — the deed
    // is now the next legal document in the sequence (post-possession).
    if (b.Status === "Completed" && handoverBookingId) {
      try { await maybeAutoCreateSalesDeed(pool, handoverBookingId, actorId(req)); } catch (e) {
        console.error("[crm-handover] maybeAutoCreateSalesDeed failed:", e.message);
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-handover] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/snags — raise a snag/defect item
router.post("/:id/snags", requirePageRight("crm-handover", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const handoverId = parseId(req.params.id);
    if (handoverId === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body;

    const cur0 = await pool.request().input("id", sql.Int, handoverId).query("SELECT BookingId FROM dbo.CrmHandover WHERE Id = @id");
    if (!cur0.recordset.length) return res.status(404).json({ error: "Handover not found" });
    const activeErr0 = await requireActiveBooking(pool, cur0.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    if (!SNAG_CATEGORIES.includes(b.Category))
      return res.status(400).json({ error: `Invalid Category. Must be: ${SNAG_CATEGORIES.join(", ")}` });
    if (!b.Description?.trim()) return res.status(400).json({ error: "Description is required" });

    // Snag INSERT + the handover's own Status advance to SnagPending — wrapped
    // so a failure between them can't leave a snag raised while the handover
    // still reads Scheduled/SnagInspection, which would let it be marked
    // Completed (gated on "no open snags") without this one ever being seen.
    const tx = pool.transaction();
    await tx.begin();
    let newId;
    try {
      const result = await tx.request()
        .input("hid",  sql.Int,            handoverId)
        .input("cat",  sql.NVarChar(50),   b.Category)
        .input("desc", sql.NVarChar(sql.MAX), b.Description.trim())
        .input("photo",sql.NVarChar(2000), b.PhotoUrl || null)
        .input("rb",   sql.Int,            actorId(req))
        .query(`
          INSERT INTO dbo.CrmSnagItem (HandoverId, Category, Description, PhotoUrl, Status, RaisedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (@hid, @cat, @desc, @photo, 'Open', @rb, SYSDATETIME())
        `);
      newId = result.recordset[0].Id;

      // Move handover into SnagPending if it was in inspection
      await tx.request().input("hid", sql.Int, handoverId)
        .query(`UPDATE dbo.CrmHandover SET Status = 'SnagPending' WHERE Id = @hid AND Status IN ('Scheduled','SnagInspection')`);

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      throw txErr;
    }

    res.status(201).json({ success: true, id: newId });
  } catch (e) {
    console.error("[crm-handover] POST snags error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/snags/:snagId — resolve/update a snag item
router.put("/:id/snags/:snagId", requirePageRight("crm-handover", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const snagId = parseInt(req.params.snagId);
    if (!Number.isFinite(snagId)) return res.status(400).json({ error: "Invalid snag id" });

    const snagCur = await pool.request().input("id", sql.Int, snagId).query(`
      SELECT h.BookingId FROM dbo.CrmSnagItem s JOIN dbo.CrmHandover h ON h.Id = s.HandoverId WHERE s.Id = @id
    `);
    if (!snagCur.recordset.length) return res.status(404).json({ error: "Snag not found" });
    const activeErr0 = await requireActiveBooking(pool, snagCur.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    const result = await pool.request()
      .input("id", sql.Int, snagId)
      .input("st", sql.NVarChar(30), b.Status || null)
      .input("rb", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmSnagItem SET
          Status = ISNULL(@st, Status),
          ResolvedBy = CASE WHEN @st = 'Resolved' THEN @rb ELSE ResolvedBy END,
          ResolvedAt = CASE WHEN @st = 'Resolved' THEN SYSDATETIME() ELSE ResolvedAt END
        WHERE Id = @id
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Snag not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-handover] PUT snags error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
