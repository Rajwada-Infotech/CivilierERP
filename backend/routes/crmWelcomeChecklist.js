const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { logCommunication } = require("../services/crmCommunicationLog");
const { emitNotification } = require("../services/notify");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// ─── Fixed checklist template ────────────────────────────────────────────
// Every booking gets exactly these items. There is no admin UI to add/remove
// items — the set is small and deliberate, matching what actually needs to
// be verified with the customer on the welcome call. Adding a new mandatory
// check later just means adding a row here (existing bookings simply won't
// have a saved row for it yet, which the GET endpoint treats as unchecked).
const CHECKLIST_TEMPLATE = [
  { section: "ProjectUnit", key: "project_name", label: "Project name confirmed with customer" },
  { section: "ProjectUnit", key: "unit_no", label: "Unit number & type confirmed" },
  { section: "ProjectUnit", key: "booking_date", label: "Booking date confirmed" },
  { section: "ProjectUnit", key: "total_value", label: "Total booking value / grand total confirmed" },

  { section: "PaymentPlan", key: "plan_structure", label: "Payment plan name & milestone structure confirmed" },
  { section: "PaymentPlan", key: "milestone_dates", label: "Milestone due dates explained to customer" },
  { section: "PaymentPlan", key: "outstanding_balance", label: "Outstanding balance confirmed" },

  { section: "BankNominee", key: "bank_account", label: "Bank name & account number confirmed" },
  { section: "BankNominee", key: "ifsc_branch", label: "IFSC code & branch confirmed" },
  { section: "BankNominee", key: "pan", label: "PAN number confirmed" },
  { section: "BankNominee", key: "aadhaar", label: "Aadhaar number confirmed" },
  { section: "BankNominee", key: "occupation_income", label: "Occupation & annual income confirmed" },
  { section: "BankNominee", key: "nominee_details", label: "Nominee name & relation confirmed" },
  { section: "BankNominee", key: "nominee_contact", label: "Nominee contact & address confirmed" },

  { section: "CoApplicant", key: "co_applicant_identity", label: "Co-applicant name & relation confirmed (or marked N/A)" },
  { section: "CoApplicant", key: "co_applicant_kyc", label: "Co-applicant PAN/Aadhaar confirmed (or marked N/A)" },
  { section: "CoApplicant", key: "co_applicant_contact", label: "Co-applicant contact details confirmed (or marked N/A)" },

  { section: "PersonalContact", key: "applicant_name", label: "Applicant name confirmed" },
  { section: "PersonalContact", key: "mobile_number", label: "Mobile number confirmed" },
  { section: "PersonalContact", key: "email", label: "Email address confirmed" },
  { section: "PersonalContact", key: "address", label: "Communication address confirmed" },

  { section: "Parking", key: "parking_selection", label: "Parking slot(s) & charges confirmed with customer (or marked N/A if none)" },

  { section: "ExtraCharges", key: "extra_charges", label: "Extra work / additional charges confirmed with customer (or marked N/A if none)" },

  { section: "Documents", key: "documents_uploaded", label: "All required KYC/booking documents uploaded" },
  { section: "Documents", key: "documents_verified", label: "All uploaded documents verified against originals" },
];
const SECTION_LABELS = {
  ProjectUnit: "Project & Unit Details",
  PaymentPlan: "Payment Plan",
  BankNominee: "Bank & Nominee (KYC)",
  CoApplicant: "Co-Applicant Details",
  PersonalContact: "Customer Personal & Contact Details",
  Parking: "Parking",
  ExtraCharges: "Extra Work / Additional Charges",
  Documents: "Documents & Attachments",
};
const ITEM_BY_KEY = Object.fromEntries(CHECKLIST_TEMPLATE.map((t) => [t.key, t]));

async function loadItems(pool, bookingId) {
  const saved = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT ItemKey, IsChecked, Remarks, CheckedBy, CheckedAt,
           RecheckStatus, RecheckReason, RecheckRequestedBy, RecheckRequestedAt, ResolvedBy, ResolvedAt
    FROM dbo.CrmWelcomeChecklistItem WHERE BookingId = @bid
  `);
  const savedByKey = Object.fromEntries(saved.recordset.map((r) => [r.ItemKey, r]));

  const items = CHECKLIST_TEMPLATE.map((t) => {
    const s = savedByKey[t.key];
    return {
      Section: t.section,
      SectionLabel: SECTION_LABELS[t.section],
      ItemKey: t.key,
      Label: t.label,
      IsChecked: !!s?.IsChecked,
      Remarks: s?.Remarks || "",
      CheckedBy: s?.CheckedBy || null,
      CheckedAt: s?.CheckedAt || null,
      RecheckStatus: s?.RecheckStatus || null,
      RecheckReason: s?.RecheckReason || null,
      RecheckRequestedAt: s?.RecheckRequestedAt || null,
      ResolvedAt: s?.ResolvedAt || null,
    };
  });

  const sections = Object.keys(SECTION_LABELS).map((section) => {
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
    res.json({ ...state, submission: sub.recordset[0] || null });
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

// POST /:bookingId/submit — final submit. Requires every item checked and
// zero open recheck flags. Locks the checklist read-only and stamps who/when.
router.post("/:bookingId/submit", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const state = await loadItems(pool, bookingId);
    if (!state.canSubmit) {
      return res.status(400).json({
        error: state.openRecheckCount > 0
          ? `${state.openRecheckCount} item(s) still have an open recheck flag — resolve them before submitting.`
          : `${state.totalCount - state.checkedCount} item(s) are not yet checked off.`,
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
        b.Id AS BookingId, b.BookingNo, b.UnitNo, b.ProjectName,
        a.ApplicantName, a.Mobile,
        COUNT(ci.Id) AS OpenRecheckCount,
        MIN(ci.RecheckRequestedAt) AS OldestFlaggedAt
      FROM dbo.CrmWelcomeChecklistItem ci
      JOIN dbo.CrmBooking b ON b.Id = ci.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE ci.RecheckStatus = '${CrmStatus.OPEN}'
      GROUP BY b.Id, b.BookingNo, b.UnitNo, b.ProjectName, a.ApplicantName, a.Mobile
      ORDER BY MIN(ci.RecheckRequestedAt)
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-welcome-checklist] GET /recheck/queue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;