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

  const app = await pool.request().input("aid", sql.Int, applicationId)
    .query("SELECT Email, Mobile FROM dbo.CrmApplication WHERE Id = @aid");
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
