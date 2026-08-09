/**
 * Unified Unit/Parking hold engine — a single place/release/convert API
 * shared by both crmBookings.js (Unit) and crmParking.js (Parking), so the
 * "on hold" rule is enforced identically everywhere instead of being
 * reimplemented per entity type.
 */
const { sql } = require("../db");
const { bumpCacheVersion } = require("../redis");

const ENTITY_TYPES = ["Unit", "Parking"];
const MAX_HOLD_DAYS = 90;

// Live availability check — same table each entity type's own route already
// queries, kept here so placeHold() can't put a hold on something already
// taken without duplicating that logic.
async function assertEntityNotTaken(pool, entityType, entityId) {
  if (entityType === "Unit") {
    const taken = await pool.request().input("uid", sql.Int, entityId)
      .query("SELECT Id FROM dbo.CrmBooking WHERE UnitId = @uid AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected')");
    if (taken.recordset.length) { const e = new Error("This unit is already booked"); e.status = 409; throw e; }
  } else {
    const taken = await pool.request().input("sid", sql.Int, entityId)
      .query("SELECT Id FROM dbo.CrmParkingAllotment WHERE ParkingSlotId = @sid AND IsActive = 1");
    if (taken.recordset.length) { const e = new Error("This parking slot is already allotted"); e.status = 409; throw e; }
  }
}

async function findActiveHold(pool, entityType, entityId) {
  const r = await pool.request()
    .input("et", sql.NVarChar(20), entityType)
    .input("eid", sql.Int, entityId)
    .query("SELECT * FROM dbo.CrmInventoryHold WHERE EntityType = @et AND EntityId = @eid AND Status = 'Active' AND HoldUntil >= SYSDATETIME()");
  return r.recordset[0] || null;
}

async function placeHold(pool, { entityType, entityId, applicationId, holdDays, reason, userId, applicationProjectId }) {
  if (!ENTITY_TYPES.includes(entityType)) { const e = new Error("Invalid EntityType"); e.status = 400; throw e; }
  if (!entityId) { const e = new Error("EntityId is required"); e.status = 400; throw e; }
  if (!applicationId) { const e = new Error("ApplicationId is required"); e.status = 400; throw e; }
  const days = parseInt(holdDays);
  if (!Number.isFinite(days) || days < 1 || days > MAX_HOLD_DAYS) {
    const e = new Error(`HoldDays must be between 1 and ${MAX_HOLD_DAYS}`); e.status = 400; throw e;
  }

  const app = await pool.request().input("aid", sql.Int, applicationId)
    .query("SELECT Id, ApplicantName, ProjectId FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
  if (!app.recordset.length) { const e = new Error("Application not found"); e.status = 404; throw e; }

  // The Unit/Parking Matrix's own "Place Hold" dropdown lists every
  // Application system-wide with no project filter — without this check, a
  // hold placed for the wrong customer's Application (a different project
  // entirely) would sail through silently: a genuinely nonsensical, unsynced
  // record where the "who's holding this" data doesn't even belong to the
  // same building the entity is in.
  const entityProject = entityType === "Unit"
    ? await pool.request().input("eid", sql.Int, entityId).query("SELECT ProjectId FROM dbo.UnitMaster WHERE Id = @eid")
    : await pool.request().input("eid", sql.Int, entityId).query("SELECT ProjectId FROM dbo.ParkingSlot WHERE Id = @eid");
  if (!entityProject.recordset.length) { const e = new Error(`${entityType} not found`); e.status = 404; throw e; }

  // Callers that are placing this hold as PART OF the same request that's
  // also changing the Application's ProjectId (e.g. crmApplications.js's
  // PUT /:id, saving Project+Unit together) must pass that new ProjectId
  // in explicitly — the SELECT above runs before their own UPDATE commits,
  // so app.recordset[0].ProjectId here is still the OLD value and would
  // false-positive this check against the very project the caller is about
  // to save. applicationProjectId is that caller-supplied effective value;
  // falls back to the DB row for callers not also touching ProjectId (e.g.
  // Booking/Parking creation, submit-time re-hold).
  const effectiveAppProjectId = applicationProjectId !== undefined ? applicationProjectId : app.recordset[0].ProjectId;
  if (entityProject.recordset[0].ProjectId !== effectiveAppProjectId) {
    const e = new Error(`This Application is for a different project than the ${entityType.toLowerCase()} being held`);
    e.status = 400;
    throw e;
  }

  await assertEntityNotTaken(pool, entityType, entityId);

  const existing = await findActiveHold(pool, entityType, entityId);
  if (existing) { const e = new Error("This item already has an active hold"); e.status = 409; throw e; }

  const result = await pool.request()
    .input("et", sql.NVarChar(20), entityType)
    .input("eid", sql.Int, entityId)
    .input("aid", sql.Int, applicationId)
    .input("days", sql.Int, days)
    .input("reason", sql.NVarChar(500), reason || null)
    .input("cb", sql.Int, userId)
    .query(`
      INSERT INTO dbo.CrmInventoryHold (EntityType, EntityId, ApplicationId, HoldDays, HoldUntil, Reason, Status, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id, INSERTED.HoldUntil
      VALUES (@et, @eid, @aid, @days, DATEADD(DAY, @days, SYSDATETIME()), @reason, 'Active', @cb, SYSDATETIME())
    `);

  // unitMaster.js's GET / caches LockHoldId/LockBookingNo per unit (server-side,
  // via the cache() middleware) and only ever gets invalidated by Unit Master's
  // own CRUD routes calling bumpCacheVersion("unit-master") — never by a hold
  // actually being placed here. Without this, the unit dropdown/matrix can keep
  // showing a just-held unit as free for the rest of that cache entry's TTL,
  // regardless of any client-side staleTime. Non-blocking: a failed bump just
  // means the cache catches up on its own TTL instead of instantly — it must
  // never fail the hold itself.
  if (entityType === "Unit") {
    bumpCacheVersion("unit-master").catch(() => {});
  }

  return { id: result.recordset[0].Id, holdUntil: result.recordset[0].HoldUntil, applicantName: app.recordset[0].ApplicantName };
}

// Wraps placeHold() for automatic (non-staff-initiated) callers — e.g. the
// Application submit flow, which may run again if a Draft/Rejected
// application gets resubmitted. A genuine "already held by someone else"
// conflict still throws (409) so the caller can log it; only "already
// actively held by this SAME application" is treated as a no-op success,
// since re-placing an identical hold isn't an error, it's a re-submit.
async function placeHoldIfNeeded(pool, params) {
  try {
    return await placeHold(pool, params);
  } catch (e) {
    if (e.status === 409 && e.message === "This item already has an active hold") {
      const existing = await findActiveHold(pool, params.entityType, params.entityId);
      if (existing && existing.ApplicationId === params.applicationId) {
        return { id: existing.Id, holdUntil: existing.HoldUntil, alreadyHeld: true };
      }
    }
    throw e;
  }
}

async function releaseHold(pool, holdId, userId) {
  const row = await pool.request().input("id", sql.Int, holdId)
    .query("SELECT Id, Status, EntityType FROM dbo.CrmInventoryHold WHERE Id = @id");
  if (!row.recordset.length) { const e = new Error("Hold not found"); e.status = 404; throw e; }
  if (row.recordset[0].Status !== "Active") { const e = new Error("Only an active hold can be released"); e.status = 400; throw e; }

  await pool.request().input("id", sql.Int, holdId).input("ub", sql.Int, userId)
    .query("UPDATE dbo.CrmInventoryHold SET Status = 'Released', ReleasedBy = @ub, ReleasedAt = SYSDATETIME() WHERE Id = @id");

  // Same reasoning as placeHold's bump above — a released hold means the unit
  // is free again, and the unit-master cache needs to know that immediately,
  // not just whenever someone next edits Unit Master itself.
  if (row.recordset[0].EntityType === "Unit") {
    bumpCacheVersion("unit-master").catch(() => {});
  }
}

// Called from booking/parking-allotment creation. If the entity has an
// active hold for the SAME application, it converts (closes cleanly);
// if it's held for a DIFFERENT application, the sale is blocked — this is
// the server-side enforcement backing what the matrix already hides from
// "Available".
async function guardAndConvertHold(pool, entityType, entityId, applicationId) {
  const hold = await findActiveHold(pool, entityType, entityId);
  if (!hold) return;
  if (hold.ApplicationId !== applicationId) {
    const e = new Error(`This ${entityType.toLowerCase()} is on hold for another applicant until ${new Date(hold.HoldUntil).toLocaleString("en-IN")}`);
    e.status = 409;
    throw e;
  }
  await pool.request().input("id", sql.Int, hold.Id)
    .query("UPDATE dbo.CrmInventoryHold SET Status = 'Converted', ReleasedAt = SYSDATETIME() WHERE Id = @id");
  if (entityType === "Unit") {
    bumpCacheVersion("unit-master").catch(() => {});
  }
}

// Releases every still-Active hold (Unit and/or Parking) tied to an
// Application — called when the Application itself is rejected/cancelled/
// expired, so a dead Application never keeps real inventory tied up until
// the hourly SLA sweep eventually notices HoldUntil has passed. Booking
// cancellation already has its own equivalent cascade
// (crmCancellations.js) for the post-Booking stage; this covers the
// pre-Booking stage, where the Application itself is the only thing that
// was ever holding the entity.
async function releaseAllHoldsForApplication(pool, applicationId, userId) {
  const rows = await pool.request().input("aid", sql.Int, applicationId)
    .query("SELECT Id FROM dbo.CrmInventoryHold WHERE ApplicationId = @aid AND Status = 'Active'");
  for (const row of rows.recordset) {
    try {
      await releaseHold(pool, row.Id, userId);
    } catch (e) {
      // Non-blocking — same partial-failure tolerance as every other
      // cascade release in this codebase (see crmCancellations.js).
      console.error("[crm-hold-service] releaseAllHoldsForApplication failed for hold", row.Id, e.message);
    }
  }
  return { released: rows.recordset.length };
}

module.exports = {
  ENTITY_TYPES, MAX_HOLD_DAYS, findActiveHold, placeHold, placeHoldIfNeeded, releaseHold,
  guardAndConvertHold, releaseAllHoldsForApplication, assertEntityNotTaken,
};