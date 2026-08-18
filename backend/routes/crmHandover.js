const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { emitNotification } = require("../services/notify");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(apiRateLimit);

const SNAG_CATEGORIES = ["Electrical", "Plumbing", "Civil", "Paint", "Carpentry", "Other"];

const HANDOVER_SELECT = `
  SELECT
    h.Id, h.BookingId, h.ScheduledDate, h.ActualHandoverDate, h.KeyHandoverBy,
    h.FinalDuesCleared, h.CustomerAcknowledged, h.Status, h.Notes,
    h.CreatedAt, h.UpdatedAt,
    b.BookingNo, b.UnitNo, b.ProjectName, b.TotalValue, b.AssignedTo,
    a.ApplicantName, a.Mobile,
    kh.name AS KeyHandoverByName,
    (SELECT COUNT(*) FROM dbo.CrmSnagItem s WHERE s.HandoverId = h.Id AND s.Status IN ('Open','InProgress')) AS OpenSnagCount
  FROM dbo.CrmHandover h
  JOIN  dbo.CrmBooking b     ON b.Id = h.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.Users kh     ON kh.id = h.KeyHandoverBy
`;

// GET / — all handovers
router.get("/", requirePageRight("crm-handover", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("h.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${HANDOVER_SELECT} ${where} ORDER BY h.ScheduledDate ASC, h.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-handover] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /eligible-bookings — bookings that satisfy every handover prerequisite
// (executed/registered agreement, sales deed customer+director approved, no
// pending/approved-but-not-issued NOCs). Mirrors the POST / guard exactly so
// the frontend dropdown never shows bookings that will fail on submit.
// Registered ahead of GET /:id so "eligible-bookings" is not swallowed by :id.
router.get("/eligible-bookings", requirePageRight("crm-handover", "create"), async (req, res) => {
  try {
    const pool = getPool();
    // Candidates: active bookings with no handover yet
    const candidates = await pool.request().query(`
      SELECT b.Id, b.BookingNo, b.UnitNo, a.ApplicantName
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.IsActive = 1 AND b.Status NOT IN ('Cancelled','Rejected')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmHandover h WHERE h.BookingId = b.Id)
      ORDER BY b.BookingNo
    `);

    const eligible = [];
    for (const c of candidates.recordset) {
      const bid = c.Id;
      // 1. Agreement must be Executed or Registered
      const agr = await pool.request().input("bid", sql.Int, bid)
        .query("SELECT Status FROM dbo.CrmAgreement WHERE BookingId = @bid");
      if (!agr.recordset.length || !["Executed", "Registered"].includes(agr.recordset[0].Status)) continue;

      // 2. Sales deed must exist, customer-approved, and director-approved
      const deed = await pool.request().input("bid", sql.Int, bid)
        .query("SELECT TOP 1 CustomerApprovalStatus, DirectorApprovalStatus FROM dbo.CrmSalesDeed WHERE BookingId = @bid ORDER BY CreatedAt DESC");
      if (!deed.recordset.length) continue;
      if (deed.recordset[0].CustomerApprovalStatus !== "Approved") continue;
      if (deed.recordset[0].DirectorApprovalStatus !== "Approved") continue;

      // 3. No NOC left in Pending or Approved (must be Issued or never requested)
      const openNoc = await pool.request().input("bid", sql.Int, bid)
        .query("SELECT TOP 1 Id FROM dbo.CrmNoc WHERE BookingId = @bid AND Status IN ('Pending','Approved')");
      if (openNoc.recordset.length) continue;

      eligible.push({ Id: c.Id, BookingNo: c.BookingNo, UnitNo: c.UnitNo, ApplicantName: c.ApplicantName });
    }

    res.json(eligible);
  } catch (e) {
    console.error("[crm-handover] GET /eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — handover with snag list
router.get("/:id", requirePageRight("crm-handover", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
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

// POST / — schedule handover for a booking (requires agreement executed)
router.post("/", requirePageRight("crm-handover", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });

    const activeErr = await requireActiveBooking(pool, parseInt(b.BookingId));
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Workflow guard: booking must have an executed/registered agreement first
    const agr = await pool.request()
      .input("bid", sql.Int, parseInt(b.BookingId))
      .query(`SELECT Status FROM dbo.CrmAgreement WHERE BookingId = @bid`);
    if (!agr.recordset.length || !["Executed", "Registered"].includes(agr.recordset[0].Status)) {
      return res.status(400).json({ error: "Handover requires an Executed or Registered agreement first" });
    }

    // Workflow guard: the sales deed itself must exist, be customer-
    // approved, AND director-approved before handover — matching the spec's
    // SALES DEED -> APPROVAL FROM BOTH SIDES -> DIRECTOR APPROVAL -> SALES
    // DEED COMPLETE -> KEY HANDOVER chain. An Executed agreement alone used
    // to be enough to schedule a handover, which let staff skip past both
    // the sales deed and director sign-off steps entirely.
    const deed = await pool.request()
      .input("bid", sql.Int, parseInt(b.BookingId))
      .query(`SELECT TOP 1 CustomerApprovalStatus, DirectorApprovalStatus FROM dbo.CrmSalesDeed WHERE BookingId = @bid ORDER BY CreatedAt DESC`);
    if (!deed.recordset.length) {
      return res.status(400).json({ error: "Handover requires the sales deed to be created first" });
    }
    if (deed.recordset[0].CustomerApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Handover requires the customer to approve the sales deed first" });
    }
    if (deed.recordset[0].DirectorApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Handover requires director approval of the sales deed first" });
    }

    // Workflow guard: if an NOC (Org or Bank) was ever requested for this
    // booking, it has to have actually been issued before handover — a NOC
    // in Pending/Approved-but-not-yet-issued means the paperwork isn't
    // physically done yet. Bookings that never needed an NOC (no loan, no
    // society clearance required) aren't blocked — this only fires when a
    // request exists and was left unfinished.
    const openNoc = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query(`SELECT TOP 1 NocType, Status FROM dbo.CrmNoc WHERE BookingId = @bid AND Status IN ('Pending', 'Approved')`);
    if (openNoc.recordset.length) {
      return res.status(400).json({ error: `Handover requires the ${openNoc.recordset[0].NocType} NOC to be issued first (currently ${openNoc.recordset[0].Status})` });
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
      return res.status(409).json({ error: "A handover already exists for this booking" });
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
    const id = parseInt(req.params.id);

    const cur0 = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmHandover WHERE Id = @id");
    if (!cur0.recordset.length) return res.status(404).json({ error: "Handover not found" });
    const activeErr0 = await requireActiveBooking(pool, cur0.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    const currentStatus = cur0.recordset[0].Status;

    // Enforce forward-only state machine transitions when a new Status is requested
    if (b.Status && b.Status !== currentStatus) {
      const ALLOWED_TRANSITIONS = {
        Scheduled:      ["SnagInspection", "Cancelled"],
        SnagInspection: ["SnagPending", "Cancelled"],
        SnagPending:    ["Completed", "Cancelled"],
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
        .query(`SELECT COUNT(*) AS cnt FROM dbo.CrmSnagItem WHERE HandoverId = @id AND Status IN ('Open','InProgress')`);
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
      if (!b.CustomerAcknowledged) {
        return res.status(400).json({ error: "CustomerAcknowledged must be confirmed before completing handover" });
      }
    }

    await pool.request()
      .input("id",   sql.Int,  id)
      .input("sdt",  sql.Date, b.ScheduledDate || null)
      .input("adt",  sql.Date, b.ActualHandoverDate || null)
      .input("khb",  sql.Int,  b.KeyHandoverBy ? parseInt(b.KeyHandoverBy) : null)
      .input("fdc",  sql.Bit,  b.FinalDuesCleared ? 1 : 0)
      .input("ack",  sql.Bit,  b.CustomerAcknowledged ? 1 : 0)
      .input("st",   sql.NVarChar(30), b.Status || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmHandover SET
          ScheduledDate = ISNULL(@sdt, ScheduledDate),
          ActualHandoverDate = ISNULL(@adt, ActualHandoverDate),
          KeyHandoverBy = ISNULL(@khb, KeyHandoverBy),
          FinalDuesCleared = @fdc, CustomerAcknowledged = @ack,
          Status = ISNULL(@st, Status), Notes = @note,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

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
    const handoverId = parseInt(req.params.id);
    const b = req.body;

    const cur0 = await pool.request().input("id", sql.Int, handoverId).query("SELECT BookingId FROM dbo.CrmHandover WHERE Id = @id");
    if (!cur0.recordset.length) return res.status(404).json({ error: "Handover not found" });
    const activeErr0 = await requireActiveBooking(pool, cur0.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    if (!SNAG_CATEGORIES.includes(b.Category))
      return res.status(400).json({ error: `Invalid Category. Must be: ${SNAG_CATEGORIES.join(", ")}` });
    if (!b.Description?.trim()) return res.status(400).json({ error: "Description is required" });

    const result = await pool.request()
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

    // Move handover into SnagPending if it was in inspection
    await pool.request().input("hid", sql.Int, handoverId)
      .query(`UPDATE dbo.CrmHandover SET Status = 'SnagPending' WHERE Id = @hid AND Status IN ('Scheduled','SnagInspection')`);

    res.status(201).json({ success: true, id: result.recordset[0].Id });
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
