"use strict";

/**
 * Residents for the Civilier Security app, from the CRM: every active booking whose key handover is done
 * (dbo.CrmHandover Status 'Completed', or an actual handover date) gives its flat to the booking's applicant
 * (primary) and its active co-applicants (members). Residents sign in with their customer-portal account.
 *
 * Only rows this sync made (Source 'CRM_SYNC') are changed: one whose booking is no longer handed over, cancelled or
 * moved to another customer is deactivated, so a customer who no longer owns the flat loses access. Rows an admin
 * added (Source 'ADMIN': tenants, family) are left alone. Every change writes a dbo.SecurityResidentAudit row.
 *
 *   syncSecurityResidents(pool, { projectId?, bookingId?, byUserId? }) -> { added, reactivated, updated, deactivated }
 *   startSecurityResidentSyncEngine()   hourly run of the whole sync
 */
const { sql } = require("../db");
const logger = require("../logger");
const { DEAD_BOOKING_SQL } = require("../constants/crmStatuses");

const INTERVAL_MS = 60 * 60 * 1000;
const keyOf = (r) => `${r.CustomerId}|${r.ProjectId}|${(r.Block || "").toLowerCase()}|${String(r.FlatNo).toLowerCase()}`;

async function syncSecurityResidents(pool, { projectId = null, bookingId = null, byUserId = null } = {}) {
  const want = (
    await pool.request().input("p", sql.Int, projectId).input("b", sql.Int, bookingId).query(`
      WITH hb AS (
        SELECT b.Id AS BookingId, b.ProjectId, ISNULL(d.BlockName, N'') AS Block, d.UnitNo AS FlatNo, a.Id AS ApplicationId, a.CustomerId
        FROM dbo.CrmBooking b
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        JOIN dbo.vw_CrmBookingDisplay d ON d.BookingId = b.Id
        WHERE b.IsActive = 1 AND b.Status NOT IN ${DEAD_BOOKING_SQL} AND b.ProjectId IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(d.UnitNo)), N'') IS NOT NULL
          AND (@p IS NULL OR b.ProjectId = @p) AND (@b IS NULL OR b.Id = @b)
          AND EXISTS (SELECT 1 FROM dbo.CrmHandover h WHERE h.BookingId = b.Id AND (h.Status = N'Completed' OR h.ActualHandoverDate IS NOT NULL) AND h.Status <> N'Cancelled')
      )
      SELECT BookingId, ProjectId, Block, FlatNo, CustomerId, CAST(1 AS BIT) AS IsPrimary FROM hb WHERE CustomerId IS NOT NULL
      UNION
      SELECT hb.BookingId, hb.ProjectId, hb.Block, hb.FlatNo, co.CustomerId, CAST(0 AS BIT)
      FROM hb JOIN dbo.CrmCoApplicant co ON co.IsActive = 1 AND co.CustomerId IS NOT NULL
        AND (co.BookingId = hb.BookingId OR co.ApplicationId = hb.ApplicationId)
      WHERE co.CustomerId <> ISNULL(hb.CustomerId, -1)`)
  ).recordset;

  // One row per customer and flat; the applicant's row wins over a co-applicant one.
  const wanted = new Map();
  for (const r of want) {
    const k = keyOf(r);
    if (!wanted.has(k) || r.IsPrimary) wanted.set(k, r);
  }

  // For one booking: its own rows, plus any row already on its flat (so an admin's row isn't duplicated).
  const flat = bookingId ? want[0] : null;
  const have = (
    await pool.request().input("p", sql.Int, projectId).input("b", sql.Int, bookingId)
      .input("fp", sql.Int, flat?.ProjectId ?? null).input("fb", sql.NVarChar(50), flat?.Block ?? null).input("ff", sql.NVarChar(50), flat ? String(flat.FlatNo).trim() : null).query(`
      SELECT ResidentId, CustomerId, ProjectId, Block, FlatNo, IsPrimary, IsActive, Source, BookingId
      FROM dbo.SecurityResident
      WHERE (@p IS NULL OR ProjectId = @p)
        AND (@b IS NULL OR BookingId = @b OR (ProjectId = @fp AND Block = @fb AND FlatNo = @ff))`)
  ).recordset;
  const haveByKey = new Map(have.map((r) => [keyOf(r), r]));

  const out = { added: 0, reactivated: 0, updated: 0, deactivated: 0 };
  const tx = pool.transaction();
  await tx.begin();
  try {
    const audit = (residentId, action, detail) =>
      tx.request().input("r", sql.Int, residentId).input("a", sql.NVarChar(20), action).input("u", sql.Int, byUserId).input("d", sql.NVarChar(500), detail)
        .query(`INSERT INTO dbo.SecurityResidentAudit (ResidentId, Action, ByUserId, Source, Detail) VALUES (@r, @a, @u, N'CRM_SYNC', @d)`);

    for (const [k, w] of wanted) {
      const h = haveByKey.get(k);
      if (!h) {
        const ins = await tx.request().input("c", sql.Int, w.CustomerId).input("p", sql.Int, w.ProjectId).input("bl", sql.NVarChar(50), w.Block)
          .input("f", sql.NVarChar(50), String(w.FlatNo).trim()).input("pr", sql.Bit, w.IsPrimary).input("bk", sql.Int, w.BookingId).query(`
            INSERT INTO dbo.SecurityResident (CustomerId, ProjectId, Block, FlatNo, IsPrimary, Source, BookingId)
            OUTPUT INSERTED.ResidentId VALUES (@c, @p, @bl, @f, @pr, N'CRM_SYNC', @bk)`);
        await audit(ins.recordset[0].ResidentId, "ADDED", `Handed over (booking ${w.BookingId})`);
        out.added++;
        continue;
      }
      if (h.Source !== "CRM_SYNC") continue; // an admin's row for the same customer and flat stays as the admin set it
      const changed = !h.IsActive || !!h.IsPrimary !== !!w.IsPrimary || h.BookingId !== w.BookingId;
      if (!changed) continue;
      await tx.request().input("r", sql.Int, h.ResidentId).input("pr", sql.Bit, w.IsPrimary).input("bk", sql.Int, w.BookingId).query(`
        UPDATE dbo.SecurityResident SET IsActive = 1, DeactivatedAt = NULL, IsPrimary = @pr, BookingId = @bk, UpdatedAt = SYSUTCDATETIME()
        WHERE ResidentId = @r`);
      if (!h.IsActive) {
        await audit(h.ResidentId, "REACTIVATED", `Handed over (booking ${w.BookingId})`);
        out.reactivated++;
      } else {
        await audit(h.ResidentId, "UPDATED", w.IsPrimary ? "Now the applicant" : "Now a co-applicant");
        out.updated++;
      }
    }

    for (const h of have) {
      if (h.Source !== "CRM_SYNC" || !h.IsActive || wanted.has(keyOf(h))) continue;
      await tx.request().input("r", sql.Int, h.ResidentId).query(`
        UPDATE dbo.SecurityResident SET IsActive = 0, DeactivatedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE ResidentId = @r`);
      await audit(h.ResidentId, "DEACTIVATED", "No longer a handed-over owner of this flat in the CRM");
      out.deactivated++;
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  return out;
}

let timer = null;
function startSecurityResidentSyncEngine() {
  if (timer) return;
  const run = () => {
    const { getPool } = require("../db");
    syncSecurityResidents(getPool())
      .then((s) => {
        if (s.added + s.reactivated + s.updated + s.deactivated) logger.info({ event: "SECURITY_RESIDENT_SYNC", ...s }, "Security residents synced from CRM handovers");
      })
      // 208: the tables aren't there yet (migration 715 not run) — nothing to sync.
      .catch((e) => e.number !== 208 && logger.error({ event: "SECURITY_RESIDENT_SYNC_FAILED", err: e.message }, "Security resident sync failed"));
  };
  setTimeout(run, 60 * 1000);
  timer = setInterval(run, INTERVAL_MS);
}

module.exports = { syncSecurityResidents, startSecurityResidentSyncEngine };
