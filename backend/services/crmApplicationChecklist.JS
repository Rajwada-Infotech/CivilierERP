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
  { key: "BankDepositMode", label: "Deposit bank, payment mode and instrument reference (cheque/txn) are correct" },
  { key: "BrokerDetails", label: "Broker / Channel Partner and brokerage rate/split are correctly recorded (if applicable)" },
  { key: "SourceAssignment", label: "Source and Assigned To are correctly set" },
  { key: "Documents", label: "Required KYC / ID / Address / Income-proof documents are uploaded and legible" },
];

// CHECKLIST_ITEMS_L2 is the Level-2 checklist — a second, independent
// verifier re-checks the BOOKING this application produced: is it a
// genuine sale, did the money actually land, does the payment schedule and
// everything else meet company policy. Stored in the exact same table as
// Level 1 (dbo.CrmApplicationVerificationChecklist, keyed by ApplicationId
// + Level — see migration 302's own comment anticipating this), since a
// Booking is always 1:1 with the Application it came from
// (createCrmBookingRecord enforces this). Call site: crmBookings.js's own
// GET/PUT /:id/checklist/* routes, gating PUT /:id/approve the same way
// Level 1 gates crmApplications.js's PUT /:id/approve.
const CHECKLIST_ITEMS_L2 = [
  { key: "BookingGenuine", label: "Booking's unit, rate and total/grand value genuinely match the approved Application — no unexplained change" },
  { key: "BookingAmountReceived", label: "Booking Amount / Milestone #1 payment is actually received and reconciled, not just marked paid" },
  { key: "PaymentScheduleCompliance", label: "Payment plan and milestone schedule are correctly generated and comply with company norms" },
  { key: "ParkingExtraCharges", label: "Parking and Extra Charges (if any) are correctly recorded and priced" },
  { key: "KycDocumentsComplete", label: "Customer KYC and required documents are complete and consistent, ready for the Welcome Call stage" },
  { key: "BrokerageTerms", label: "Broker / commission terms are correctly recorded and within policy (if applicable)" },
  { key: "CompanyRequirements", label: "Booking fulfills all other company requirements (minimum token %, discount/approval limits, etc.)" },
];

function itemsForLevel(level) {
  return level === 2 ? CHECKLIST_ITEMS_L2 : CHECKLIST_ITEMS;
}

const { sql } = require("../db");

/**
 * Makes sure every CHECKLIST_ITEMS key has a row for this application/level,
 * inserting only what's missing, then returns the full current row set.
 */
async function ensureChecklistRows(pool, applicationId, level = 1) {
  const items = itemsForLevel(level);
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
    .query("SELECT * FROM dbo.CrmApplicationVerificationChecklist WHERE ApplicationId = @aid AND Level = @lvl ORDER BY Id");
  return result.recordset;
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
      WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key
    `);
  if (!result.recordset.length) { const e = new Error("Checklist item not found"); e.status = 404; throw e; }
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
      WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key
    `);
  if (!result.recordset.length) { const e = new Error("Checklist item not found"); e.status = 404; throw e; }
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
      WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key
    `);
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
      WHERE ApplicationId = @aid AND Level = @lvl AND ItemKey = @key
    `);
  return result.recordset[0];
}

module.exports = { CHECKLIST_ITEMS, CHECKLIST_ITEMS_L2, itemsForLevel, ensureChecklistRows, checkItem, uncheckItem, flagItem, resubmitItem };