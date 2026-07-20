const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const STEPS = [
  "DocCollection", "LegalReview", "Drafting", "InternalApproval",
  "DocShared", "MutualAgreement", "DirectorMeeting", "FinalExecution",
];

const LM_SELECT = `
  SELECT m.*, b.BookingNo, b.UnitNo, a.ApplicantName, a.Mobile
  FROM dbo.CrmLegalMilestone m
  JOIN dbo.CrmBooking b ON b.Id = m.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
`;

// GET / — all legal milestone trackers
router.get("/", requirePageRight("crm-legal-milestones", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${LM_SELECT} ORDER BY m.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-legal-milestones] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId
router.get("/booking/:bookingId", requirePageRight("crm-legal-milestones", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("bid", sql.Int, parseInt(req.params.bookingId))
      .query(`${LM_SELECT} WHERE m.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-legal-milestones] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start the legal workflow for a booking. Its own steps
// (Drafting, DocShared, MutualAgreement, FinalExecution...) are literally
// about the agreement itself, so it can't exist before agreement
// preparation has actually started — the one structural fact we can assert
// without guessing at which exact CrmAgreement.Status this internal legal
// team process is supposed to align with.
router.post("/", requirePageRight("crm-legal-milestones", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const agr = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmAgreement WHERE BookingId = @bid");
    if (!agr.recordset.length) {
      return res.status(400).json({ error: "Legal milestone tracking requires an agreement to exist for this booking first" });
    }

    const milestoneNo = "LGL-" + Date.now().toString(36).toUpperCase().slice(-7);

    const result = await pool.request()
      .input("no",  sql.NVarChar(30), milestoneNo)
      .input("bid", sql.Int,          parseInt(b.BookingId))
      .input("cb",  sql.Int,          actorId(req))
      .query(`
        INSERT INTO dbo.CrmLegalMilestone (MilestoneNo, BookingId, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, MilestoneNo: milestoneNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Legal workflow already started for this booking" });
    console.error("[crm-legal-milestones] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/:step — update a single step (Due/Done/Status/Notes), advances CurrentStep
router.put("/:id/:step", requirePageRight("crm-legal-milestones", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const step = req.params.step;
    if (!STEPS.includes(step)) return res.status(400).json({ error: `Invalid step. Must be one of: ${STEPS.join(", ")}` });
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmLegalMilestone WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Legal milestone tracker not found" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const result = await pool.request()
      .input("id",   sql.Int,  id)
      .input("due",  sql.Date, b.Due  || null)
      .input("done", sql.Date, b.Done || null)
      .input("st",   sql.NVarChar(30), b.Status || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmLegalMilestone SET
          ${step}Due    = ISNULL(@due, ${step}Due),
          ${step}Done   = ISNULL(@done, ${step}Done),
          ${step}Status = ISNULL(@st, ${step}Status),
          ${step}Notes  = @note,
          CurrentStep = CASE WHEN @st = 'Completed' AND CurrentStep = ${STEPS.indexOf(step) + 1}
                             THEN ${Math.min(STEPS.indexOf(step) + 2, STEPS.length)} ELSE CurrentStep END,
          OverallStatus = CASE WHEN @st = 'Completed' AND '${step}' = 'FinalExecution' THEN 'Completed' ELSE OverallStatus END,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Legal milestone tracker not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-legal-milestones] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
