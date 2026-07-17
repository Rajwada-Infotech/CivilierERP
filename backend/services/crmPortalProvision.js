/**
 * Auto-provisions a CRM customer portal login the first time an agreement
 * enters preparation for a booking. Username = applicant email, initial
 * password = the applicant's mobile number (hashed, MustChangePassword=1
 * so the customer is forced to set their own password on first login).
 */
const bcrypt = require("bcrypt");
const { sql } = require("../db");

async function ensurePortalUser(pool, applicationId) {
  const existing = await pool.request().input("aid", sql.Int, applicationId)
    .query("SELECT Id FROM dbo.CrmCustomerPortalUser WHERE ApplicationId = @aid");
  if (existing.recordset.length) return { created: false, id: existing.recordset[0].Id };

  // CrmCustomer is the canonical identity record (migration 181) — prefer
  // its Email/Mobile over CrmApplication's own copies, which are only a
  // snapshot taken at application-creation time and can drift or contain a
  // typo that was later corrected on the Customer record without anyone
  // realizing the Application's copy (and therefore the portal login) never
  // got updated. Falls back to the Application's own fields only if it
  // somehow has no linked CustomerId.
  const app = await pool.request().input("aid", sql.Int, applicationId).query(`
    SELECT
      COALESCE(c.Email, a.Email) AS Email,
      COALESCE(c.Mobile, a.Mobile) AS Mobile
    FROM dbo.CrmApplication a
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    WHERE a.Id = @aid
  `);
  const row = app.recordset[0];
  if (!row?.Email) return { created: false, error: "Applicant has no email on file — cannot provision portal login" };
  if (!row?.Mobile) return { created: false, error: "Applicant has no mobile on file — cannot provision portal login" };

  const email = row.Email.trim().toLowerCase();

  // dbo.CrmCustomerPortalUser has Email UNIQUE — a customer with two
  // applications sharing the same email would otherwise crash the second
  // agreement's portal provisioning on this constraint. Reuse the existing
  // login instead of inserting a duplicate: repoint it at the new
  // application. Known limitation, not a full fix: the portal is built
  // entirely around a single ApplicationId per login (every query in
  // crmPortal.js scopes by it), so this makes the customer's portal show
  // their MOST RECENT application/booking, not both at once — true
  // multi-application portal support would need crmPortal.js's queries
  // reworked to scope by Email/Customer instead, which is out of scope here.
  const byEmail = await pool.request().input("em", sql.NVarChar(200), email)
    .query("SELECT Id FROM dbo.CrmCustomerPortalUser WHERE Email = @em");
  if (byEmail.recordset.length) {
    const portalId = byEmail.recordset[0].Id;
    await pool.request().input("id", sql.Int, portalId).input("aid", sql.Int, applicationId)
      .query("UPDATE dbo.CrmCustomerPortalUser SET ApplicationId = @aid WHERE Id = @id");
    return { created: false, id: portalId, reused: true };
  }

  const passwordHash = await bcrypt.hash(row.Mobile, 10);
  const result = await pool.request()
    .input("aid",  sql.Int, applicationId)
    .input("em",   sql.NVarChar(200), email)
    .input("hash", sql.NVarChar(200), passwordHash)
    .query(`
      INSERT INTO dbo.CrmCustomerPortalUser (ApplicationId, Email, PasswordHash, MustChangePassword, IsActive, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@aid, @em, @hash, 1, 1, SYSDATETIME())
    `);
  return { created: true, id: result.recordset[0].Id };
}

module.exports = { ensurePortalUser };
