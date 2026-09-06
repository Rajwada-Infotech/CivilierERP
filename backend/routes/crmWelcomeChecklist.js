const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireApprovedBooking } = require("../services/crmWorkflowGuards");
const { logCommunication } = require("../services/crmCommunicationLog");
const { emitNotification } = require("../services/notify");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// ─── Checklist template ──────────────────────────────────────────────────
// ALWAYS_TEMPLATE applies to every booking — these facts exist for every
// single booking with no exception, so there's always something real to
// confirm. There is no admin UI to add/remove items — the set is small and
// deliberate, matching what actually needs to be verified with the customer
// on the welcome call.
const ALWAYS_TEMPLATE = [
  { section: "ProjectUnit", key: "project_name", label: "Project name confirmed with customer" },
  { section: "ProjectUnit", key: "unit_no", label: "Unit number, type & structural area confirmed" },
  { section: "ProjectUnit", key: "booking_date", label: "Booking date confirmed" },
  { section: "ProjectUnit", key: "total_value", label: "Total booking value / grand total confirmed" },

  // One combined confirmation, not two — "which milestones are due when" is
  // part of explaining the plan structure itself, not a separately
  // verifiable fact with its own data to check against.
  { section: "PaymentPlan", key: "plan_structure", label: "Payment plan structure & milestone schedule confirmed with customer" },
  { section: "PaymentPlan", key: "outstanding_balance", label: "Outstanding balance confirmed" },

  { section: "PersonalContact", key: "applicant_name", label: "Applicant name confirmed" },
  { section: "PersonalContact", key: "mobile_number", label: "Mobile number confirmed" },
  { section: "PersonalContact", key: "email", label: "Email address confirmed" },
  { section: "PersonalContact", key: "address", label: "Communication address confirmed" },

  { section: "Documents", key: "documents_uploaded", label: "All required KYC/booking documents uploaded" },
  { section: "Documents", key: "documents_verified", label: "All uploaded documents verified against originals" },
];
// CONDITIONAL_TEMPLATE items exist on the checklist ONLY when the booking
// actually has that kind of data on file — a booking with no co-applicant,
// no parking, or no extra charges has nothing to verify there, so forcing a
// checkbox (previously ticked as "N/A") added a click with no real fact
// behind it. `existsCol` names the flag computed per-booking in
// loadItems()'s existence query; the item is included only when it's truthy.
// `legacyKeys` lets a booking that already had its old, more granular items
// checked keep showing as verified under the new merged item instead of
// silently reverting to unchecked.
const CONDITIONAL_TEMPLATE = [
  {
    section: "CoApplicant", key: "co_applicant_details",
    label: "Co-applicant name, relation, KYC & contact details confirmed",
    existsCol: "HasCoApplicant",
    legacyKeys: ["co_applicant_identity", "co_applicant_kyc", "co_applicant_contact"],
  },
  {
    section: "Parking", key: "parking_selection",
    label: "Parking slot(s) & charges confirmed with customer",
    existsCol: "HasParking",
  },
  {
    section: "ExtraCharges", key: "extra_charges",
    label: "Extra work / additional charges confirmed with customer",
    existsCol: "HasExtraCharges",
  },
];
const SECTION_LABELS = {
  ProjectUnit: "Project & Unit Details",
  PaymentPlan: "Payment Plan",
  CoApplicant: "Co-Applicant Details",
  PersonalContact: "Customer Personal & Contact Details",
  Parking: "Parking",
  ExtraCharges: "Extra Charges",
  Documents: "Documents & Attachments",
};
// Every key the checklist could ever use, for validating a PUT/recheck
// itemKey exists at all (applicability to THIS booking is checked
// separately via getActiveTemplate, since that depends on real booking data).
const ITEM_BY_KEY = Object.fromEntries([...ALWAYS_TEMPLATE, ...CONDITIONAL_TEMPLATE].map((t) => [t.key, t]));

// The real, per-booking checklist: every ALWAYS item, plus each CONDITIONAL
// item only when this booking actually has that kind of data. Total item
// count is therefore not a fixed 18 — it's whatever genuinely applies to
// this specific booking (a self-funded, no-parking, no-extra-charges,
// no-co-applicant booking has fewer real facts to confirm, and its
// checklist reflects exactly that).
async function getActiveTemplate(pool, bookingId) {
  const ctx = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT
      CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmCoApplicant WHERE BookingId = @bid AND IsActive = 1) THEN 1 ELSE 0 END AS HasCoApplicant,
      CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmParkingAllotment WHERE BookingId = @bid AND IsActive = 1) THEN 1 ELSE 0 END AS HasParking,
      CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmExtraCharge WHERE BookingId = @bid AND IsActive = 1) THEN 1 ELSE 0 END AS HasExtraCharges
  `);
  const flags = ctx.recordset[0] || {};
  return [
    ...ALWAYS_TEMPLATE,
    ...CONDITIONAL_TEMPLATE.filter((t) => flags[t.existsCol] === 1),
  ];
}

async function loadItems(pool, bookingId) {
  const [saved, activeTemplate] = await Promise.all([
    pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT ItemKey, IsChecked, Remarks, CheckedBy, CheckedAt,
             RecheckStatus, RecheckReason, RecheckRequestedBy, RecheckRequestedAt, ResolvedBy, ResolvedAt
      FROM dbo.CrmWelcomeChecklistItem WHERE BookingId = @bid
    `),
    getActiveTemplate(pool, bookingId),
  ]);
  const savedByKey = Object.fromEntries(saved.recordset.map((r) => [r.ItemKey, r]));

  const items = activeTemplate.map((t) => {
    const s = savedByKey[t.key];
    // Continuity: a merged item with no row of its own yet, whose every
    // legacy sub-item was already checked, counts as already checked —
    // staff already confirmed those facts under the old, more granular
    // items; merging the checklist must not silently un-verify real work.
    const legacyAllChecked = !s && t.legacyKeys?.length > 0 && t.legacyKeys.every((lk) => savedByKey[lk]?.IsChecked);
    return {
      Section: t.section,
      SectionLabel: SECTION_LABELS[t.section],
      ItemKey: t.key,
      Label: t.label,
      IsChecked: !!s?.IsChecked || legacyAllChecked,
      Remarks: s?.Remarks || "",
      CheckedBy: s?.CheckedBy || null,
      CheckedAt: s?.CheckedAt || null,
      RecheckStatus: s?.RecheckStatus || null,
      RecheckReason: s?.RecheckReason || null,
      RecheckRequestedAt: s?.RecheckRequestedAt || null,
      ResolvedAt: s?.ResolvedAt || null,
    };
  });

  // Only sections that actually have an applicable item this time — a
  // booking with no co-applicant simply has no "Co-Applicant Details"
  // section at all, not an empty/trivially-complete one.
  const sections = Object.keys(SECTION_LABELS)
    .filter((section) => items.some((i) => i.Section === section))
    .map((section) => {
      const secItems = items.filter((i) => i.Section === section);
      return {
        section,
        label: SECTION_LABELS[section],
        items: secItems,
        complete: secItems.every((i) => i.IsChecked && i.RecheckStatus !== CrmStatus.OPEN),
        hasOpenRecheck: secItems.some((i) => i.RecheckStatus === CrmStatus.OPEN),
      };
    });

  const totalCount = items.length;
  const checkedCount = items.filter((i) => i.IsChecked && i.RecheckStatus !== CrmStatus.OPEN).length;
  const openRecheckCount = items.filter((i) => i.RecheckStatus === CrmStatus.OPEN).length;

  return { items, sections, totalCount, checkedCount, openRecheckCount, canSubmit: checkedCount === totalCount && openRecheckCount === 0 };
}

// GET /:bookingId — full checklist state + submission/lock status
router.get("/:bookingId", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const state = await loadItems(pool, bookingId);
    const sub = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT IsLocked, SubmittedBy, SubmittedAt FROM dbo.CrmWelcomeCallSubmission WHERE BookingId = @bid");
    // Surfaced so the frontend can disable Submit with a clear reason up
    // front, instead of only finding out on a failed submit attempt — see
    // the same gate enforced (never just trusted from the client) in POST /submit.
    const called = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 1 AS x FROM dbo.CrmWelcomeCall WHERE BookingId = @bid AND Outcome = 'Welcomed'");
    res.json({ ...state, submission: sub.recordset[0] || null, hasWelcomedCall: !!called.recordset.length });
  } catch (e) {
    console.error("[crm-welcome-checklist] GET /:bookingId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

function assertUnlocked(pool, bookingId) {
  return pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT IsLocked FROM dbo.CrmWelcomeCallSubmission WHERE BookingId = @bid")
    .then((r) => !!r.recordset[0]?.IsLocked);
}

// PUT /:bookingId/items/:itemKey — tick/untick + save remarks for ONE item.
// Saved individually by design — staff confirm each fact with the customer
// one at a time, not as a single blanket "select all".
router.put("/:bookingId/items/:itemKey", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const itemKey = req.params.itemKey;
    if (!ITEM_BY_KEY[itemKey]) return res.status(400).json({ error: "Unknown checklist item" });

    const activeTemplate = await getActiveTemplate(pool, bookingId);
    if (!activeTemplate.some((t) => t.key === itemKey)) {
      return res.status(400).json({ error: "This checklist item doesn't apply to this booking (no matching data on file)" });
    }

    if (await assertUnlocked(pool, bookingId)) {
      return res.status(400).json({ error: "This checklist has already been submitted and locked. Reopen it first." });
    }

    const existing = await pool.request().input("bid", sql.Int, bookingId).input("k", sql.NVarChar(80), itemKey)
      .query("SELECT RecheckStatus FROM dbo.CrmWelcomeChecklistItem WHERE BookingId = @bid AND ItemKey = @k");
    if (existing.recordset[0]?.RecheckStatus === CrmStatus.OPEN && req.body.IsChecked) {
      return res.status(400).json({ error: "This item has an open recheck flag — resolve it before ticking it off." });
    }

    const isChecked = !!req.body.IsChecked;
    const remarks = req.body.Remarks != null ? String(req.body.Remarks).trim() : null;

    await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("sec", sql.NVarChar(50), ITEM_BY_KEY[itemKey].section)
      .input("k", sql.NVarChar(80), itemKey)
      .input("chk", sql.Bit, isChecked ? 1 : 0)
      .input("rem", sql.NVarChar(1000), remarks)
      .input("by", sql.Int, actorId(req))
      .query(`
        MERGE dbo.CrmWelcomeChecklistItem AS tgt
        USING (SELECT @bid AS BookingId, @k AS ItemKey) AS src
          ON tgt.BookingId = src.BookingId AND tgt.ItemKey = src.ItemKey
        WHEN MATCHED THEN UPDATE SET
          IsChecked = @chk, Remarks = @rem,
          CheckedBy = CASE WHEN @chk = 1 THEN @by ELSE CheckedBy END,
          CheckedAt = CASE WHEN @chk = 1 THEN SYSDATETIME() ELSE CheckedAt END,
          UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (BookingId, Section, ItemKey, IsChecked, Remarks, CheckedBy, CheckedAt, UpdatedAt)
          VALUES (@bid, @sec, @k, @chk, @rem, CASE WHEN @chk = 1 THEN @by ELSE NULL END, CASE WHEN @chk = 1 THEN SYSDATETIME() ELSE NULL END, SYSDATETIME());
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-checklist] PUT /:bookingId/items/:itemKey error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:bookingId/items/:itemKey/recheck — flag a mismatch/conflict.
// Blocks that item (and therefore Submit) until someone resolves it, AND
// notifies the assigned salesperson AND logs it to the Communication Log so
// it's visible on the customer's timeline too.
router.post("/:bookingId/items/:itemKey/recheck", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const itemKey = req.params.itemKey;
    if (!ITEM_BY_KEY[itemKey]) return res.status(400).json({ error: "Unknown checklist item" });
    const reason = String(req.body.Reason || "").trim();
    if (!reason) return res.status(400).json({ error: "A reason is required to send an item for recheck" });

    const activeTemplate = await getActiveTemplate(pool, bookingId);
    if (!activeTemplate.some((t) => t.key === itemKey)) {
      return res.status(400).json({ error: "This checklist item doesn't apply to this booking (no matching data on file)" });
    }

    if (await assertUnlocked(pool, bookingId)) {
      return res.status(400).json({ error: "This checklist has already been submitted and locked. Reopen it first." });
    }

    await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("sec", sql.NVarChar(50), ITEM_BY_KEY[itemKey].section)
      .input("k", sql.NVarChar(80), itemKey)
      .input("reason", sql.NVarChar(1000), reason)
      .input("by", sql.Int, actorId(req))
      .query(`
        MERGE dbo.CrmWelcomeChecklistItem AS tgt
        USING (SELECT @bid AS BookingId, @k AS ItemKey) AS src
          ON tgt.BookingId = src.BookingId AND tgt.ItemKey = src.ItemKey
        WHEN MATCHED THEN UPDATE SET
          IsChecked = 0, RecheckStatus = '${CrmStatus.OPEN}', RecheckReason = @reason,
          RecheckRequestedBy = @by, RecheckRequestedAt = SYSDATETIME(),
          ResolvedBy = NULL, ResolvedAt = NULL, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (BookingId, Section, ItemKey, IsChecked, RecheckStatus, RecheckReason, RecheckRequestedBy, RecheckRequestedAt, UpdatedAt)
          VALUES (@bid, @sec, @k, 0, 'Open', @reason, @by, SYSDATETIME(), SYSDATETIME());
      `);

    const bkg = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT BookingNo, ApplicationId, AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
    const booking = bkg.recordset[0];
    if (booking) {
      await logCommunication(pool, {
        applicationId: booking.ApplicationId, bookingId,
        direction: "Inbound",
        subject: `Recheck Requested — ${ITEM_BY_KEY[itemKey].label}`,
        summary: reason,
        createdBy: actorId(req),
      });
      if (booking.AssignedTo) {
        await emitNotification(pool, booking.AssignedTo, "crm_welcome_checklist_recheck",
          "Data Mismatch Flagged on Welcome Call",
          `${booking.BookingNo}: ${ITEM_BY_KEY[itemKey].label} — ${reason}`,
          bookingId, "crm_booking");
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-checklist] POST recheck error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:bookingId/items/:itemKey/resolve — clear an open recheck flag once
// the conflict has actually been fixed. Deliberately does NOT re-check the
// box — whoever resolves it still has to verify and tick it explicitly.
router.post("/:bookingId/items/:itemKey/resolve", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const itemKey = req.params.itemKey;
    if (!ITEM_BY_KEY[itemKey]) return res.status(400).json({ error: "Unknown checklist item" });

    const result = await pool.request()
      .input("bid", sql.Int, bookingId).input("k", sql.NVarChar(80), itemKey).input("by", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmWelcomeChecklistItem
        SET RecheckStatus = '${CrmStatus.RESOLVED}', ResolvedBy = @by, ResolvedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
        WHERE BookingId = @bid AND ItemKey = @k AND RecheckStatus = '${CrmStatus.OPEN}'
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "No open recheck found for this item" });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-checklist] POST resolve error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:bookingId/submit — final submit. Requires every item checked, zero
// open recheck flags, AND an actual Welcome Call already logged with
// Outcome = 'Welcomed' — the checklist is staff sign-off on facts confirmed
// DURING that call, so it can't be legitimately complete if the call itself
// never happened. Before this gate, the checklist and the call log were two
// entirely independent completion paths that could silently disagree: staff
// could tick every box and lock the checklist without ever placing a
// successful call, while the dashboard's "pending welcome call" alert (which
// checks for a real Outcome = 'Welcomed' row) would still correctly show the
// booking as not done — a locked, "submitted" checklist next to a booking
// the rest of the system still considered un-called.
router.post("/:bookingId/submit", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    // Same gate as the rest of the Welcome Call workflow (crmWelcomeCalls.js
    // POST / uses requireApprovedBooking) — this checklist can't be
    // meaningfully "verified" on a booking that isn't itself Approved.
    const activeErr = await requireApprovedBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const state = await loadItems(pool, bookingId);
    if (!state.canSubmit) {
      return res.status(400).json({
        error: state.openRecheckCount > 0
          ? `${state.openRecheckCount} item(s) still have an open recheck flag — resolve them before submitting.`
          : `${state.totalCount - state.checkedCount} item(s) are not yet checked off.`,
      });
    }

    const called = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 1 AS x FROM dbo.CrmWelcomeCall WHERE BookingId = @bid AND Outcome = 'Welcomed'");
    if (!called.recordset.length) {
      return res.status(400).json({
        error: "Log a call with outcome 'Welcomed' before submitting the verification checklist — the checklist confirms facts checked during that call.",
      });
    }

    await pool.request()
      .input("bid", sql.Int, bookingId).input("by", sql.Int, actorId(req))
      .query(`
        MERGE dbo.CrmWelcomeCallSubmission AS tgt
        USING (SELECT @bid AS BookingId) AS src ON tgt.BookingId = src.BookingId
        WHEN MATCHED THEN UPDATE SET IsLocked = 1, SubmittedBy = @by, SubmittedAt = SYSDATETIME(), ReopenedBy = NULL, ReopenedAt = NULL
        WHEN NOT MATCHED THEN INSERT (BookingId, IsLocked, SubmittedBy, SubmittedAt) VALUES (@bid, 1, @by, SYSDATETIME());
      `);

    const bkg = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT BookingNo, ApplicationId FROM dbo.CrmBooking WHERE Id = @bid");
    const booking = bkg.recordset[0];
    if (booking) {
      await logCommunication(pool, {
        applicationId: booking.ApplicationId, bookingId,
        direction: "Outbound",
        subject: "Welcome Call Verification Submitted",
        summary: `All ${state.totalCount} checklist items verified and submitted.`,
        createdBy: actorId(req),
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-checklist] POST submit error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:bookingId/reopen — unlock a submitted checklist for correction.
router.post("/:bookingId/reopen", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bookingId).input("by", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmWelcomeCallSubmission
        SET IsLocked = 0, ReopenedBy = @by, ReopenedAt = SYSDATETIME()
        WHERE BookingId = @bid
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "No submission found for this booking" });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-checklist] POST reopen error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /recheck/queue — bookings that currently have at least one open
// recheck flag, so they can be worked from a dedicated tab instead of
// hunting through the whole call queue.
router.get("/recheck/queue", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        b.Id AS BookingId, b.BookingNo,
        COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
        COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
        a.ApplicantName, a.Mobile,
        COUNT(ci.Id) AS OpenRecheckCount,
        MIN(ci.RecheckRequestedAt) AS OldestFlaggedAt
      FROM dbo.CrmWelcomeChecklistItem ci
      JOIN dbo.CrmBooking b ON b.Id = ci.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE ci.RecheckStatus = '${CrmStatus.OPEN}'
      GROUP BY b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo), COALESCE(bn.ProjectName, b.ProjectName), a.ApplicantName, a.Mobile
      ORDER BY MIN(ci.RecheckRequestedAt)
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-welcome-checklist] GET /recheck/queue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
