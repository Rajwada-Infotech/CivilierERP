"use strict";

/**
 * System maintenance switch (dbo.SystemMaintenance, one row, migration 548).
 * While it is on, everyone except a super admin is held on the Maintenance page. The state is read on every API
 * call, so it is cached for a few seconds in memory; a change made here clears the cache straight away.
 * Before the migration has run the switch simply reads as "off".
 */

const { getPool, sql } = require("../db");

const CACHE_MS = 5000;
const OFF = Object.freeze({ active: false, enforced: false, title: null, message: null, startedAt: null, startsAt: null, endsAt: null, updatedBy: null });

let cache = null; // { at, state }

const iso = (d) => (d ? new Date(d).toISOString() : null);

function fromRow(row) {
  if (!row || !row.IsActive) return { ...OFF };
  return {
    active: true,
    enforced: true, // worked out against the clock on every read, see withEnforced()
    title: row.Title || null,
    message: row.Message || null,
    startedAt: iso(row.StartedAt),
    startsAt: iso(row.StartsAt),
    endsAt: iso(row.EndsAt),
    updatedBy: row.UpdatedBy || null,
  };
}

/** Maintenance is announced as soon as it is switched on, but only holds people from startsAt on. */
function withEnforced(state) {
  if (!state.active) return state;
  return { ...state, enforced: !state.startsAt || Date.parse(state.startsAt) <= Date.now() };
}

async function getMaintenanceState({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return withEnforced(cache.state);
  let state = OFF;
  try {
    const r = await getPool().request().query("SELECT TOP 1 * FROM dbo.SystemMaintenance WHERE Id = 1");
    state = fromRow(r.recordset[0]);
  } catch {
    state = OFF; // table not there yet (migration 548) or a DB hiccup: never lock people out because of it
  }
  cache = { at: Date.now(), state };
  return withEnforced(state);
}

/** Turns maintenance on or off. Throws {status: 503} when migration 548 has not run. */
async function setMaintenance({ active, title, message, startsAt, endsAt, by }) {
  const req = getPool()
    .request()
    .input("active", sql.Bit, active ? 1 : 0)
    .input("title", sql.NVarChar(120), active ? title || null : null)
    .input("message", sql.NVarChar(500), active ? message || null : null)
    .input("startsAt", sql.DateTime2, active && startsAt ? new Date(startsAt) : null)
    .input("endsAt", sql.DateTime2, active && endsAt ? new Date(endsAt) : null)
    .input("by", sql.NVarChar(200), by || null);
  try {
    await req.query(`
      UPDATE dbo.SystemMaintenance
         SET IsActive = @active, Title = @title, Message = @message, StartsAt = @startsAt, EndsAt = @endsAt,
             StartedAt = CASE WHEN @active = 1 THEN SYSUTCDATETIME() ELSE StartedAt END,
             UpdatedBy = @by, UpdatedAt = SYSUTCDATETIME()
       WHERE Id = 1;
      IF @@ROWCOUNT = 0
        INSERT INTO dbo.SystemMaintenance (Id, IsActive, Title, Message, StartedAt, StartsAt, EndsAt, UpdatedBy)
        VALUES (1, @active, @title, @message, CASE WHEN @active = 1 THEN SYSUTCDATETIME() END, @startsAt, @endsAt, @by);
    `);
  } catch (err) {
    if (/Invalid object name|Invalid column name 'StartsAt'/i.test(err.message)) {
      const e = new Error("Maintenance mode needs migrations 548 and 549 - ask an administrator to run the database migrations.");
      e.status = 503;
      throw e;
    }
    throw err;
  }
  cache = null;
  return getMaintenanceState({ fresh: true });
}

function resetMaintenanceCache() {
  cache = null;
}

module.exports = { getMaintenanceState, setMaintenance, resetMaintenanceCache, OFF };
