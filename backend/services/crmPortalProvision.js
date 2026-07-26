/**
 * Auto-provisions a CRM customer portal login the first time an agreement
 * enters preparation for a booking. Identity anchor is CrmCustomer (by
 * Mobile — the canonical unique key), NOT ApplicationId, so a customer with
 * multiple applications/bookings gets one portal account that can access all
 * of them, rather than having their portal context silently repointed to the
 * newest application each time.
 *
 * Initial credential: Mobile number (hashed), MustChangePassword=1 so the
 * customer must set their own password on first login.
 *
 * Previous behaviour (ApplicationId-keyed, repoint-on-collision) was
 * replaced by migration 254. Zero portal users existed at migration time —
 * no data migration needed.
 */
const bcrypt = require("bcrypt");
const { sql } = require("../db");

async function ensurePortalUser(pool, applicationId) {
  // Resolve ApplicationId → CrmCustomer (preferred) → Email + Mobile.
  // CrmCustomer is the canonical identity record; falls back to Application's
  // own snapshot only if CustomerId is somehow null (shouldn't happen post-181).
  const app = await pool.request().input("aid", sql.Int, applicationId).query(`
    SELECT
      a.Id          AS ApplicationId,
      a.CustomerId,
      COALESCE(c.Email,   a.Email)  AS Email,
      COALESCE(c.Mobile,  a.Mobile) AS Mobile
    FROM dbo.CrmApplication a
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    WHERE a.Id = @aid AND a.IsActive = 1
  `);
  if (!app.recordset.length) return { created: false, error: "Application not found" };
  const row = app.recordset[0];

  if (!row.CustomerId) return { created: false, error: "Application has no linked Customer record — cannot provision portal login" };
  if (!row.Mobile)     return { created: false, error: "Customer has no mobile on file — cannot provision portal login" };
  if (!row.Email)      return { created: false, error: "Customer has no email on file — cannot provision portal login" };

  const customerId = row.CustomerId;

  // Idempotent: if a portal account already exists for this CustomerId, reuse
  // it — a second Agreement on the same customer simply picks up the existing
  // login without changing anything. The ApplicationId column is no longer
  // written here (it's nullable and unused for routing since migration 254).
  const existing = await pool.request().input("cid", sql.Int, customerId)
    .query("SELECT Id FROM dbo.CrmCustomerPortalUser WHERE CustomerId = @cid");
  if (existing.recordset.length) {
    const portalId = existing.recordset[0].Id;
    const email = row.Email.trim().toLowerCase();
    await pool.request()
      .input("id", sql.Int, portalId)
      .input("em", sql.NVarChar(200), email)
      .query("UPDATE dbo.CrmCustomerPortalUser SET Email = @em WHERE Id = @id");
    return { created: false, id: portalId };
  }

  // New customer — create their portal account keyed to CustomerId.
  // Password seed = Mobile number (hashed), same as before.
  const email = row.Email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(row.Mobile, 10);

  const result = await pool.request()
    .input("cid",  sql.Int,          customerId)
    .input("em",   sql.NVarChar(200), email)
    .input("hash", sql.NVarChar(200), passwordHash)
    .query(`
      INSERT INTO dbo.CrmCustomerPortalUser
        (CustomerId, Email, PasswordHash, MustChangePassword, IsActive, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@cid, @em, @hash, 1, 1, SYSDATETIME())
    `);
  return { created: true, id: result.recordset[0].Id };
}

module.exports = { ensurePortalUser };
