// backend/services/crmApplicationChecklist.js
//
// Level-1 (Application) and Level-2 (Booking) verification checklists.
// Both levels share this one service and one table
// (dbo.CrmApplicationVerificationChecklist, keyed by ApplicationId + Level)
// since a Booking is always 1:1 with the Application it came from — this is
// exactly the extensibility migration 302's own comment anticipated when it
// added the Level column ahead of there being a second level. L2's own
// routes live in crmBookings.js (GET/PUT /:id/checklist/*), not here.
//
// Before this, PUT /:id/approve (crmApplications.js, via approvalService's
// generic transition()) let a verifier mark an entire Application "Approved"
// with one click — no requirement to actually look at any individual field.
// This module makes that impossible: every item in CHECKLIST_ITEMS below has
// to be explicitly ticked before Approved is reachable at all. The moment
// the last item is ticked, this fires the existing
// approvalTransition("crm-applications", id, "Approved", ...) automatically
// (see crmApplications.js PUT /:id/checklist/:itemKey/check) — nothing about
// the generic approval engine changes (audit log, GL posting, multi-level
// LevelsData all still run exactly as before); this only gates when that
// call happens.
//
// A flagged item (verifier finds something wrong) never touches
// CrmApplication.Status. PUT /:id already allows editing while Status is
// Pending (see crmApplications.js), so the preparer just fixes the
// field(s) in place and calls PUT /:id/checklist/:itemKey/resubmit on that
// one item to hand it back to the verifier — the whole Application never
// bounces back to Draft/Rejected, and every other already-checked item
// keeps its state. This is the "revert for recheck, per item, with its own
// remarks" behaviour that was asked for, instead of the old all-or-nothing
// single Reject button.
//
// CHECKLIST_ITEMS is the Level-1 checklist (Application). Edit this array to
// add/remove/reword items — ensureChecklistRows() below only ever INSERTs
// rows for keys missing on a given application, so editing this list never
// disturbs already-recorded checks on existing applications, and a removed
// key's old rows simply stop being surfaced (harmless orphan row, never
// deleted).
const CHECKLIST_ITEMS = [
  { key: "ApplicantKyc", label: "Applicant & co-applicant details match KYC (name, mobile, email, PAN, address)" },
  { key: "ProjectUnitRate", label: "Project, Unit and Rate/SqFt are correct and the unit is genuinely available" },
  { key: "PaymentPlanAmounts", label: "Payment Plan and Token/Booking Amount match what was quoted to the customer" },
  // onlyWhen: an item with nothing to verify is not on the checklist at all —
  // shown (and required) only while this SQL finds data for the application.
  { key: "ParkingExtraCharges", label: "Parking (type, quantity, rate) and extra charges are correct",
    onlyWhen: `EXISTS (SELECT 1 FROM dbo.CrmParkingAllotment WHERE ApplicationId = @aid AND IsActive = 1)
            OR EXISTS (SELECT 1 FROM dbo.CrmExtraCharge WHERE ApplicationId = @aid AND IsActive = 1)` },
  { key: "BankDepositMode", label: "Deposit bank, payment mode and instrument reference (cheque/txn) are correct" },
  { key: "BrokerDetails", label: "Broker / Channel Partner and brokerage rate/split are correctly recorded (if applicable)" },
  { key: "SourceAssignment", label: "Source and Assigned To are correctly set" },
  { key: "Documents", label: "Required KYC / ID / Address / Income-proof documents are uploaded and legible" },
];

// A plot (land) sale verifies the same facts in land terms: plots instead of
// a unit, and a Booking Amount + balance schedule instead of a payment plan.
// Applied when the checklist is read (labelsFor), never stored, so the same
// keys and saved ticks serve both kinds of sale and an application that
// switches between unit and plots always shows the right wording.
const PLOT_SALE_LABELS = {
  ProjectUnitRate: "Project, Plot(s) and Rate/SqFt are correct and the plots are genuinely available",
  PaymentPlanAmounts: "Booking Amount and balance match what was quoted to the customer (no payment plan for land)",
  ParkingExtraCharges: "Extra charges are correct (no parking with land)",
};

// There is no longer a separate Level-2 checklist — the two-level
// Marketing Head -> Director approval (crmBookingStageService.js) replaced
// it. CHECKLIST_ITEMS above is the only checklist now, applied at Level=1
// as the content of the Booking's own "Review" stage (see crmBookings.js).
function itemsForLevel() {
  return CHECKLIST_ITEMS;
}

const { sql } = require("../db");

/**
 * Makes sure every CHECKLIST_ITEMS key has a row for this application/level,
 * inserting only what's missing, then returns the full current row set.
 */
// The items that apply to this application: every item without onlyWhen, and
// each onlyWhen item whose data exists.
async function applicableItems(pool, applicationId, level) {
  const all = itemsForLevel(level);
  const conditional = all.filter((it) => it.onlyWhen);
  if (!conditional.length) return all;
  const r = await pool.request().input("aid", sql.Int, applicationId).query(
    `SELECT ${conditional.map((it) => `CASE WHEN ${it.onlyWhen} THEN 1 ELSE 0 END AS [${it.key}]`).join(", ")}`);
  const row = r.recordset[0] || {};
  return all.filter((it) => !it.onlyWhen || row[it.key] === 1);
}

async function ensureChecklistRows(pool, applicationId, level = 1) {
  const items = await applicableItems(pool, applicationId, level);
  const existing = await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("lvl", sql.Int, level)
    .query("SELECT ItemKey FROM dbo.CrmApplicationVerificationChecklist WHERE ApplicationId = @aid AND Level = @lvl");
  const have = new Set(existing.recordset.map((r) => r.ItemKey));
  const missing = items.filter((it) => !have.has(it.key));

  for (const it of missing) {
    await pool.request()
      .input("aid", sql.Int, applicationId)
      .input("lvl", sql.Int, level)
      .input("key", sql.NVarChar(50), it.key)
      .input("label", sql.NVarChar(200), it.label)
      .query(`
        INSERT INTO dbo.CrmApplicationVerificationChecklist
          (ApplicationId, Level, ItemKey, ItemLabel, IsChecked, CheckStatus, CreatedAt, UpdatedAt)
        VALUES (@aid, @lvl, @key, @label, 0, 'Pending', SYSDATETIME(), SYSDATETIME())
      `);
  }

  const result = await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("lvl", sql.Int, level)
    .query(`
      SELECT c.*,
             CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmApplicationPlot ap WHERE ap.ApplicationId = c.ApplicationId AND ap.Status = N'Active')
                       THEN 1 ELSE 0 END AS BIT) AS IsPlotSale
      FROM dbo.CrmApplicationVerificationChecklist c
      WHERE c.ApplicationId = @aid AND c.Level = @lvl ORDER BY c.Id`);
  const keys = new Set(items.map((it) => it.key));
  return result.recordset.filter((r) => keys.has(r.ItemKey)).map(withSaleLabel);
}

// The wording the reader sees for a checklist row, by kind of sale.
function withSaleLabel(row) {
  if (!row.IsPlotSale || !PLOT_SALE_LABELS[row.ItemKey]) return row;
  return { ...row, ItemLabel: PLOT_SALE_LABELS[row.ItemKey] };
}

function assertKnownItem(itemKey, level = 1) {
  const def = itemsForLevel(level).find((c) => c.key === itemKey);
  if (!def) {
    const e = new Error(`Unknown checklist item: ${itemKey}`);
    e.status = 400;
    throw e;
  }
  return def;
}

// Data Review items change only while the booking is still in Data Review —
// checked inside the same UPDATE, so a write that waits behind a send (which
// holds these rows locked) finds the booking already sent and changes nothing.
// Level 2+ items are not tied to the booking's stage.
function inDataReviewSql(level) {
  if (Number(level) !== 1) return "";
  const { STAGE_REVIEW } = require("./crmBookingStageService");
  return ` AND EXISTS (SELECT 1 FROM dbo.CrmBooking b WHERE b.ApplicationId = @aid AND b.IsActive = 1
             AND ISNULL(b.WorkflowStage, N'${STAGE_REVIEW}') = N'${STAGE_REVIEW}')`;
}

// Nothing updated: the item does not exist (404), or the booking left Data Review (409).
async function notUpdated(pool, applicationId, itemKey, level) {
  const row = (await pool.request().input("aid", sql.Int, applicationId).input("lvl", sql.Int, level).input("key", sql.NVarChar(50), itemKey)
    .query("SELECT 1 AS x FROM dbo.CrmApplicationVerificationChecklist WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key")).recordset[0];
  return row
    ? Object.assign(new Error("This booking has already been sent for approval — its Data Review checklist can no longer change"), { status: 409 })
    : Object.assign(new Error("Checklist item not found"), { status: 404 });
}

/** Verifier ticks an item as checked. `remarks` is optional here (a confirming note). */
async function checkItem(pool, applicationId, itemKey, { actor, remarks, level = 1 } = {}) {
  assertKnownItem(itemKey, level);
  const result = await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("lvl", sql.Int, level)
    .input("key", sql.NVarChar(50), itemKey)
    .input("rem", sql.NVarChar(1000), remarks && remarks.trim() ? remarks.trim() : null)
    .input("by", sql.Int, actor)
    .query(`
      UPDATE dbo.CrmApplicationVerificationChecklist
      SET IsChecked = 1, CheckStatus = 'Checked',
          Remarks = ISNULL(@rem, Remarks), CheckedBy = @by, CheckedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.*
      WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key${inDataReviewSql(level)}
    `);
  if (!result.recordset.length) throw await notUpdated(pool, applicationId, itemKey, level);
  return result.recordset[0];
}

/** Verifier flags an item as wrong. `remarks` is mandatory — this is the "tell the preparer what to fix" note. */
async function flagItem(pool, applicationId, itemKey, { actor, remarks, level = 1 } = {}) {
  assertKnownItem(itemKey, level);
  if (!remarks || !remarks.trim()) {
    const e = new Error("A remark is required to flag a checklist item for recheck");
    e.status = 400;
    throw e;
  }
  const result = await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("lvl", sql.Int, level)
    .input("key", sql.NVarChar(50), itemKey)
    .input("rem", sql.NVarChar(1000), remarks.trim())
    .input("by", sql.Int, actor)
    .query(`
      UPDATE dbo.CrmApplicationVerificationChecklist
      SET IsChecked = 0, CheckStatus = 'NeedsRecheck',
          Remarks = @rem, CheckedBy = @by, CheckedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.*
      WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key${inDataReviewSql(level)}
    `);
  if (!result.recordset.length) throw await notUpdated(pool, applicationId, itemKey, level);
  return result.recordset[0];
}

/**
 * Verifier un-checks an item they'd already checked — a plain retract (e.g.
 * mis-click, or they want to look again before moving on), NOT the same
 * action as flagItem(). This never requires a remark and never touches
 * Remarks — flagItem() is the deliberate "send this back to the preparer
 * with a reason" action; uncheckItem() just puts the item back to Pending
 * so the verifier can review it again themselves. Only valid coming from
 * 'Checked' — uncheck-ing something already NeedsRecheck or Pending is a
 * no-op state-wise, so it's rejected rather than silently doing nothing.
 */
async function uncheckItem(pool, applicationId, itemKey, { actor, level = 1 } = {}) {
  assertKnownItem(itemKey, level);
  const cur = await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("lvl", sql.Int, level)
    .input("key", sql.NVarChar(50), itemKey)
    .query("SELECT CheckStatus FROM dbo.CrmApplicationVerificationChecklist WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key");
  if (!cur.recordset.length) { const e = new Error("Checklist item not found"); e.status = 404; throw e; }
  if (cur.recordset[0].CheckStatus !== "Checked") {
    const e = new Error("Only a checked item can be unchecked");
    e.status = 400;
    throw e;
  }

  const result = await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("lvl", sql.Int, level)
    .input("key", sql.NVarChar(50), itemKey)
    .input("by", sql.Int, actor)
    .query(`
      UPDATE dbo.CrmApplicationVerificationChecklist
      SET IsChecked = 0, CheckStatus = 'Pending',
          CheckedBy = @by, CheckedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.*
      WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key AND CheckStatus = 'Checked'${inDataReviewSql(level)}
    `);
  if (!result.recordset.length) throw await notUpdated(pool, applicationId, itemKey, level);
  return result.recordset[0];
}

/** Preparer marks a flagged item as revised — sends it back to 'Pending' (unchecked) for the verifier to look at again. */
async function resubmitItem(pool, applicationId, itemKey, { actor, level = 1 } = {}) {
  assertKnownItem(itemKey, level);
  const cur = await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("lvl", sql.Int, level)
    .input("key", sql.NVarChar(50), itemKey)
    .query("SELECT CheckStatus FROM dbo.CrmApplicationVerificationChecklist WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key");
  if (!cur.recordset.length) { const e = new Error("Checklist item not found"); e.status = 404; throw e; }
  if (cur.recordset[0].CheckStatus !== "NeedsRecheck") {
    const e = new Error("This item isn't currently flagged for recheck");
    e.status = 400;
    throw e;
  }

  const result = await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("lvl", sql.Int, level)
    .input("key", sql.NVarChar(50), itemKey)
    .query(`
      UPDATE dbo.CrmApplicationVerificationChecklist
      SET CheckStatus = 'Pending', UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.*
      WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key AND CheckStatus = 'NeedsRecheck'${inDataReviewSql(level)}
    `);
  if (!result.recordset.length) throw await notUpdated(pool, applicationId, itemKey, level);
  return result.recordset[0];
}

// ── A ticked item whose data changes goes back to be verified ───────────────
// The verifier ticked what they saw; when the preparer then changes that data
// (allowed during Data Review), the tick no longer vouches for it. Only items
// that are Checked go back — to Pending, with a note of what changed (which
// lists show as "Resubmitted — to recheck"); flagged or untouched items stay.
// Best-effort: it must never fail the save that triggered it.

// The application's own columns each item checks (what its save can change).
const APPLICATION_ITEM_COLUMNS = {
  ProjectUnitRate: ["CompanyId", "ProjectId", "PreferredUnitId", "RatePerSqFt"],
  PaymentPlanAmounts: ["PaymentPlanId", "TokenType", "TokenValue", "BookingAmount"],
  BrokerDetails: ["BrokerId", "BrokerageRatePercent", "BrokeragePaymentPlan", "ChannelPartnerId"],
  SourceAssignment: ["Source", "PlatformId", "CampaignId", "AdId"],
  BankDepositMode: ["PaymentMode", "DepositBankId"],
  ApplicantKyc: ["ApplicantName", "Mobile", "AltMobile", "Email"],
};
// The Bank / KYC record's columns each item checks. The buyer's own bank
// account is checked by no item, so changing it resets nothing.
const BANK_DETAIL_ITEM_COLUMNS = {
  ApplicantKyc: ["PanNo", "AadhaarNo", "AccountHolderName"],
  BankDepositMode: ["ChequeNo", "ChequeDate", "TransactionRef"],
};

async function resolveApplicationId(pool, { applicationId = null, bookingId = null, table = null, id = null }) {
  if (applicationId != null) return Number(applicationId);
  if (table && id != null && ["CrmCoApplicant", "CrmExtraCharge", "CrmBookingDocument"].includes(table)) {
    const r = (await pool.request().input("id", sql.Int, id).query(`SELECT ApplicationId, BookingId FROM dbo.${table} WHERE Id = @id`)).recordset[0];
    if (r?.ApplicationId != null) return Number(r.ApplicationId);
    bookingId = r?.BookingId ?? bookingId;
  }
  if (bookingId != null) {
    const r = (await pool.request().input("bid", sql.Int, bookingId).query("SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @bid")).recordset[0];
    return r?.ApplicationId != null ? Number(r.ApplicationId) : null;
  }
  return null;
}

/** Items (keys) back to "To verify" because their data changed: `what` says what. Returns the keys reset. */
async function resetVerifiedItems(pool, where, itemKeys, what) {
  try {
    const keys = [...new Set(itemKeys)].filter((k) => CHECKLIST_ITEMS.some((i) => i.key === k));
    if (!keys.length) return [];
    const aid = await resolveApplicationId(pool, where || {});
    if (aid == null) return [];
    const req0 = pool.request().input("aid", sql.Int, aid).input("what", sql.NVarChar(500), `Changed after it was verified: ${what}`.slice(0, 500));
    const names = keys.map((k, i) => { req0.input(`k${i}`, sql.NVarChar(50), k); return `@k${i}`; });
    const r = await req0.query(`
      UPDATE dbo.CrmApplicationVerificationChecklist
      SET CheckStatus = 'Pending', IsChecked = 0, Remarks = @what, UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.ItemKey
      WHERE ApplicationId = @aid AND Level = 1 AND CheckStatus = 'Checked' AND ItemKey IN (${names.join(", ")})${inDataReviewSql(1)}`);
    return r.recordset.map((x) => x.ItemKey);
  } catch (e) {
    console.error("[crm-checklist] reset of changed items failed:", e.message);
    return [];
  }
}

/** The columns an item map covers, from one row (before / after a save). */
async function snapshotColumns(pool, table, keyColumn, keyValue, itemColumns) {
  const cols = [...new Set(Object.values(itemColumns).flat())];
  try {
    const r = (await pool.request().input("k", sql.Int, keyValue)
      .query(`SELECT TOP 1 ${cols.map((c) => `[${c}]`).join(", ")} FROM dbo.${table} WHERE [${keyColumn}] = @k`)).recordset[0];
    return r || null;
  } catch (e) {
    console.error("[crm-checklist] snapshot failed:", e.message);
    return null;
  }
}

const normCol = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null || v === "" ? null : String(v));

/** Items whose columns differ between two snapshots of one row. */
function changedItems(itemColumns, before, after) {
  if (!before || !after) return [];
  return Object.entries(itemColumns)
    .filter(([, cols]) => cols.some((c) => normCol(before[c]) !== normCol(after[c])))
    .map(([key]) => key);
}

/** After a save: reset every item whose columns differ between the two snapshots. */
async function resetForChangedColumns(pool, where, itemColumns, before, after, label) {
  const changed = changedItems(itemColumns, before, after);
  if (!changed.length) return [];
  const norm = normCol;
  const fields = [...new Set(Object.entries(itemColumns).filter(([k]) => changed.includes(k)).flatMap(([, cols]) => cols.filter((c) => norm(before[c]) !== norm(after[c]))))];
  return resetVerifiedItems(pool, where, changed, `${label} (${fields.join(", ")})`);
}

module.exports = {
  CHECKLIST_ITEMS, itemsForLevel, ensureChecklistRows, checkItem, uncheckItem, flagItem, resubmitItem,
  APPLICATION_ITEM_COLUMNS, BANK_DETAIL_ITEM_COLUMNS, resetVerifiedItems, snapshotColumns, resetForChangedColumns, changedItems,
};