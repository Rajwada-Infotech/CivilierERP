const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(apiRateLimit);

const PN_SELECT = `
  SELECT n.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile
  FROM dbo.CrmPossessionNotice n
  JOIN dbo.CrmBooking b ON b.Id = n.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
`;

router.get("/", requirePageRight("crm-possession-notice", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${PN_SELECT} ORDER BY n.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-possession-notice] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Workflow guard: a possession notice is a formal offer to hand over the
// unit. It requires the pre-possession inspection to be Ready — the unit
// must physically pass before the offer goes out. The Sale Deed is prepared
// and registered separately, usually at or after possession for under-
// construction projects; gating this notice on Sale Deed execution was
// sequentially inverted.
router.post("/", requirePageRight("crm-possession-notice", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const pp = await pool.request().input("bid", sql.Int, bookingId)
      .query(`SELECT TOP 1 Status FROM dbo.CrmPrePossession WHERE BookingId = @bid ORDER BY CreatedAt DESC`);
    if (!pp.recordset.length || pp.recordset[0].Status !== "Ready") {
      return res.status(400).json({ error: "Possession notice requires the pre-possession check to be Ready first" });
    }

    // OC / CC must be received for the project (same check as Pre-Possession).
    const bk = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 ProjectId FROM dbo.CrmBooking WHERE Id = @bid");
    if (bk.recordset[0]?.ProjectId) {
      const occc = await pool.request().input("pid", sql.Int, bk.recordset[0].ProjectId)
        .query("SELECT TOP 1 Id FROM dbo.CrmOccupancyCertificate WHERE ProjectId = @pid AND Status = 'Received'");
      if (!occc.recordset.length) {
        return res.status(400).json({ error: "Possession notice requires the project's OC / CC to be received first" });
      }
    }

    const noticeNo = await getNextDocNumber(pool, "PN", "PN");

    const result = await pool.request()
      .input("no",   sql.NVarChar(30), noticeNo)
      .input("bid",  sql.Int,          parseInt(b.BookingId))
      .input("odt",  sql.Date,         b.OfferedDate || null)
      .input("rdl",  sql.Date,         b.ResponseDeadline || null)
      .input("mode", sql.NVarChar(50), b.DeliveryMode || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,          actorId(req))
      .query(`
        INSERT INTO dbo.CrmPossessionNotice
          (NoticeNo, BookingId, OfferedDate, ResponseDeadline, DeliveryMode, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @odt, @rdl, @mode, 'Draft', @note, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, NoticeNo: noticeNo });
  } catch (e) {
    console.error("[crm-possession-notice] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Generic PUT never accepts Status — it only ever advances via the sequential,
// forward-only action endpoints below (mark-sent/mark-acknowledged/mark-disputed),
// each recording the real-world event (a timestamp) that justifies the step.
router.put("/:id", requirePageRight("crm-possession-notice", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmPossessionNotice WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Possession notice not found" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id", sql.Int, id)
      .input("odt", sql.Date, b.OfferedDate || null)
      .input("rdl", sql.Date, b.ResponseDeadline || null)
      .input("mode", sql.NVarChar(50), b.DeliveryMode || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmPossessionNotice SET
          OfferedDate = ISNULL(@odt, OfferedDate), ResponseDeadline = ISNULL(@rdl, ResponseDeadline),
          DeliveryMode = ISNULL(@mode, DeliveryMode), Notes = @note,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-possession-notice] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/mark-sent — Draft -> Sent. Requires a DeliveryMode on record (the
// notice must actually have been dispatched some way before it can be "Sent").
router.put("/:id/mark-sent", requirePageRight("crm-possession-notice", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    const actor = actorId(req);

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, DeliveryMode FROM dbo.CrmPossessionNotice WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Possession notice not found" });
    if (cur.recordset[0].Status !== CrmStatus.DRAFT) {
      return res.status(400).json({ error: `Cannot mark-sent from status '${cur.recordset[0].Status}'` });
    }
    if (!cur.recordset[0].DeliveryMode && !b.DeliveryMode) {
      return res.status(400).json({ error: "DeliveryMode is required to mark the notice sent" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("mode", sql.NVarChar(50), b.DeliveryMode || null)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmPossessionNotice SET
          Status = 'Sent', DeliveryMode = ISNULL(@mode, DeliveryMode),
          SentAt = SYSDATETIME(), UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: "Sent" });
  } catch (e) {
    console.error("[crm-possession-notice] mark-sent error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/mark-acknowledged — Sent -> Acknowledged.
router.put("/:id/mark-acknowledged", requirePageRight("crm-possession-notice", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmPossessionNotice WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Possession notice not found" });
    if (cur.recordset[0].Status !== "Sent") {
      return res.status(400).json({ error: `Cannot mark-acknowledged from status '${cur.recordset[0].Status}'` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmPossessionNotice SET
          Status = 'Acknowledged', AcknowledgedAt = SYSDATETIME(), UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: "Acknowledged" });
  } catch (e) {
    console.error("[crm-possession-notice] mark-acknowledged error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/mark-disputed — Sent -> Disputed. Requires a reason.
router.put("/:id/mark-disputed", requirePageRight("crm-possession-notice", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    const actor = actorId(req);
    if (!b.DisputeReason) return res.status(400).json({ error: "DisputeReason is required" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmPossessionNotice WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Possession notice not found" });
    if (cur.recordset[0].Status !== "Sent") {
      return res.status(400).json({ error: `Cannot mark-disputed from status '${cur.recordset[0].Status}'` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("reason", sql.NVarChar(sql.MAX), b.DisputeReason)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmPossessionNotice SET
          Status = 'Disputed', DisputedAt = SYSDATETIME(), DisputeReason = @reason,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: "Disputed" });
  } catch (e) {
    console.error("[crm-possession-notice] mark-disputed error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/retract-dispute — Disputed -> Draft. Allows staff to address the
// customer's concern and re-issue the notice. Without this, a Disputed notice
// permanently blocks the booking from reaching Handover.
router.put("/:id/retract-dispute", requirePageRight("crm-possession-notice", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.RetractReason?.trim()) {
      return res.status(400).json({ error: "RetractReason is required — document how the dispute was resolved" });
    }

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmPossessionNotice WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Possession notice not found" });
    if (cur.recordset[0].Status !== "Disputed") {
      return res.status(400).json({ error: `Can only retract a Disputed notice (current status: '${cur.recordset[0].Status}')` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("reason", sql.NVarChar(sql.MAX), b.RetractReason.trim())
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmPossessionNotice SET
          Status = '${CrmStatus.DRAFT}', DisputedAt = NULL, DisputeReason = NULL,
          Notes = ISNULL(Notes + CHAR(10), '') + 'Dispute retracted: ' + @reason,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: CrmStatus.DRAFT });
  } catch (e) {
    console.error("[crm-possession-notice] retract-dispute error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Staff proxy actions for non-portal customers ───────────────────────────
const PROXY_METHODS_PN = ["Phone", "InPerson", "Email", "WhatsApp", "Other"];

// PUT /:id/proxy-acknowledge — record that the customer acknowledged the
// possession notice without using the portal.
router.put("/:id/proxy-acknowledge", requirePageRight("crm-possession-notice", "edit"), async (req, res) => {
  try {
    const pool  = getPool();
    const id    = parseInt(req.params.id);
    const { ProxyMethod, ProxyRemarks } = req.body;

    if (!ProxyMethod || !PROXY_METHODS_PN.includes(ProxyMethod)) {
      return res.status(400).json({ error: `ProxyMethod is required. Must be one of: ${PROXY_METHODS_PN.join(", ")}` });
    }
    if (!ProxyRemarks?.trim()) return res.status(400).json({ error: "ProxyRemarks are required" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, NoticeNo FROM dbo.CrmPossessionNotice WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Possession notice not found" });
    if (cur.recordset[0].Status !== "Sent") {
      return res.status(400).json({ error: `Can only record acknowledgement for a Sent notice (current: '${cur.recordset[0].Status}')` });
    }

    await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmPossessionNotice SET
        Status = 'Acknowledged', AcknowledgedAt = SYSDATETIME(),
        Notes = ISNULL(Notes + CHAR(10), '') + '[Acknowledged via ${ProxyMethod} — recorded by staff]',
        UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

    res.json({ success: true, status: "Acknowledged" });
  } catch (e) {
    console.error("[crm-possession-notice] proxy-acknowledge error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/proxy-dispute — record that the customer disputed the possession
// notice without using the portal.
router.put("/:id/proxy-dispute", requirePageRight("crm-possession-notice", "edit"), async (req, res) => {
  try {
    const pool  = getPool();
    const id    = parseInt(req.params.id);
    const { ProxyMethod, ProxyRemarks } = req.body;

    if (!ProxyMethod || !PROXY_METHODS_PN.includes(ProxyMethod)) {
      return res.status(400).json({ error: `ProxyMethod is required. Must be one of: ${PROXY_METHODS_PN.join(", ")}` });
    }
    if (!ProxyRemarks?.trim()) return res.status(400).json({ error: "ProxyRemarks (customer's dispute reason) are required" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, NoticeNo FROM dbo.CrmPossessionNotice WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Possession notice not found" });
    if (cur.recordset[0].Status !== "Sent") {
      return res.status(400).json({ error: `Can only record a dispute for a Sent notice (current: '${cur.recordset[0].Status}')` });
    }

    await pool.request()
      .input("id",     sql.Int, id)
      .input("reason", sql.NVarChar(sql.MAX), `[via ${ProxyMethod}] ${ProxyRemarks.trim()}`)
      .input("ub",     sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmPossessionNotice SET
          Status = 'Disputed', DisputedAt = SYSDATETIME(),
          DisputeReason = @reason,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    res.json({ success: true, status: "Disputed" });
  } catch (e) {
    console.error("[crm-possession-notice] proxy-dispute error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
