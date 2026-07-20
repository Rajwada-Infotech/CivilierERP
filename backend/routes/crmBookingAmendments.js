// Approval queue for Unit/Parking/Extra-Charge changes requested after a
// booking's Agreement has documents under verification (see
// isLegalWorkStarted() in crmWorkflowGuards.js, and the gate wired into
// crmExtraCharges.js / crmParking.js). Approving here actually applies the
// queued change by replaying it through the exact same apply* functions the
// direct (pre-legal) path uses — never duplicated logic.
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { CRM_APPROVER_ROLES } = require("../services/approvalService");
const { emitNotification } = require("../services/notify");
const extraChargesRouter = require("./crmExtraCharges");
const parkingRouter = require("./crmParking");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

function isApprover(req) {
  return CRM_APPROVER_ROLES.includes(String(req.user?.role || "").toLowerCase());
}

const LIST_SELECT = `
  SELECT r.*, b.BookingNo, b.ProjectName, b.UnitNo, a.ApplicantName,
         reqBy.name AS RequestedByName, revBy.name AS ReviewedByName
  FROM dbo.CrmBookingAmendmentRequest r
  JOIN dbo.CrmBooking b ON b.Id = r.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.Users reqBy ON reqBy.id = r.RequestedBy
  LEFT JOIN dbo.Users revBy ON revBy.id = r.ReviewedBy
`;

// GET / — every amendment request, optionally filtered by ?status=Pending.
// Powers the approver-facing review list.
router.get("/", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); conds.push("r.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${LIST_SELECT} ${where} ORDER BY r.RequestedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-booking-amendments] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId — pending requests for one booking, for the
// pending-badge shown on the Booking Detail page's Extra Charges/Parking
// sections.
router.get("/booking/:bookingId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${LIST_SELECT} WHERE r.BookingId = @bid AND r.Status = 'Pending' ORDER BY r.RequestedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-booking-amendments] GET /booking error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/approve — apply the queued change for real, then notify the
// Agreement's assigned legal executive (if any) that a booking's financial
// details changed after documents were already under verification, so they
// know to check whether anything needs re-issuing. Admin/super_admin/
// marketing_head only, same approver set crm-bookings itself uses.
router.put("/:id/approve", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  if (!isApprover(req)) return res.status(403).json({ error: "Only admin, super_admin, or marketing_head can approve a booking amendment" });
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const notes = req.body?.Notes || null;

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.CrmBookingAmendmentRequest WHERE Id = @id");
    if (!row.recordset.length) return res.status(404).json({ error: "Amendment request not found" });
    const reqRow = row.recordset[0];
    if (reqRow.Status !== "Pending") return res.status(400).json({ error: `This request is already ${reqRow.Status}` });

    const proposedChange = JSON.parse(reqRow.ProposedChange || "{}");
    const actor = actorId(req);
    let applyResult;

    if (reqRow.ChangeType === "ExtraCharge") {
      if (reqRow.Action === "Add") applyResult = await extraChargesRouter.applyAddExtraCharge(pool, reqRow.BookingId, proposedChange, actor);
      else if (reqRow.Action === "Edit") applyResult = await extraChargesRouter.applyEditExtraCharge(pool, reqRow.TargetId, proposedChange, actor);
      else if (reqRow.Action === "Release") applyResult = await extraChargesRouter.applyReleaseExtraCharge(pool, reqRow.TargetId);
    } else if (reqRow.ChangeType === "ParkingAllotment") {
      if (reqRow.Action === "Add") applyResult = await parkingRouter.applyAddParking(pool, reqRow.BookingId, proposedChange, actor);
      else if (reqRow.Action === "Edit") applyResult = await parkingRouter.applyEditParking(pool, reqRow.TargetId, proposedChange);
      else if (reqRow.Action === "Release") applyResult = await parkingRouter.applyReleaseParking(pool, reqRow.TargetId);
    } else {
      return res.status(400).json({ error: `Unknown ChangeType: ${reqRow.ChangeType}` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("rb", sql.Int, actor)
      .input("notes", sql.NVarChar(500), notes)
      .query(`
        UPDATE dbo.CrmBookingAmendmentRequest SET
          Status = 'Approved', ReviewedBy = @rb, ReviewedAt = SYSDATETIME(), ReviewNotes = @notes
        WHERE Id = @id
      `);

    // Legal visibility — this booking's financial details just changed
    // after its Agreement documents were already under verification.
    const agreement = await pool.request().input("bid", sql.Int, reqRow.BookingId)
      .query("SELECT Id, AgreementNo, LegalExecutiveId FROM dbo.CrmAgreement WHERE BookingId = @bid");
    if (agreement.recordset.length && agreement.recordset[0].LegalExecutiveId) {
      const ag = agreement.recordset[0];
      await emitNotification(pool, ag.LegalExecutiveId, "crm_booking_amendment_approved",
        "Booking Details Changed — Recheck Documents",
        `${ag.AgreementNo}: a ${reqRow.ChangeType} ${reqRow.Action.toLowerCase()} was approved after documents were already under verification (reason: ${reqRow.Reason}). Please check whether anything needs re-issuing.`,
        ag.Id, "crm_agreement");
    }

    res.json({ success: true, ...applyResult });
  } catch (e) {
    console.error("[crm-booking-amendments] approve error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id/reject — close the request without applying anything.
router.put("/:id/reject", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  if (!isApprover(req)) return res.status(403).json({ error: "Only admin, super_admin, or marketing_head can reject a booking amendment" });
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const notes = req.body?.Notes || null;

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, RequestedBy FROM dbo.CrmBookingAmendmentRequest WHERE Id = @id");
    if (!row.recordset.length) return res.status(404).json({ error: "Amendment request not found" });
    if (row.recordset[0].Status !== "Pending") return res.status(400).json({ error: `This request is already ${row.recordset[0].Status}` });

    await pool.request()
      .input("id", sql.Int, id)
      .input("rb", sql.Int, actorId(req))
      .input("notes", sql.NVarChar(500), notes)
      .query(`
        UPDATE dbo.CrmBookingAmendmentRequest SET
          Status = 'Rejected', ReviewedBy = @rb, ReviewedAt = SYSDATETIME(), ReviewNotes = @notes
        WHERE Id = @id
      `);

    if (row.recordset[0].RequestedBy) {
      await emitNotification(pool, row.recordset[0].RequestedBy, "crm_booking_amendment_rejected",
        "Amendment Request Rejected",
        notes ? `Your requested change was rejected: ${notes}` : "Your requested change was rejected.",
        id, "crm_booking_amendment");
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-booking-amendments] reject error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
