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

  const passwordHash = await bcrypt.hash(row.Mobile, 10);
  const result = await pool.request()
    .input("aid",  sql.Int, applicationId)
    .input("em",   sql.NVarChar(200), row.Email.trim().toLowerCase())
    .input("hash", sql.NVarChar(200), passwordHash)
    .query(`
      INSERT INTO dbo.CrmCustomerPortalUser (ApplicationId, Email, PasswordHash, MustChangePassword, IsActive, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@aid, @em, @hash, 1, 1, SYSDATETIME())
    `);
  return { created: true, id: result.recordset[0].Id };
}

module.exports = { ensurePortalUser };
