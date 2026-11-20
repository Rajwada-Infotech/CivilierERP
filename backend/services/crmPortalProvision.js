/**
 * Auto-provisions a CRM customer portal login the first time an agreement
 * enters preparation for a booking. Identity anchor is CrmCustomer (by
 * Mobile — the canonical unique key), NOT ApplicationId, so a customer with
 * multiple applications/bookings gets one portal account that can access all
 * of them, rather than having their portal context silently repointed to the
 * newest application each time.
 *
 * Sign-in: the customer's registered mobile number (normalizeMobile below). The first password is
 * defaultPortalPassword: the first 4 letters of their name + the last 4 digits of that mobile, all small
 * (Rahul Adhikari, 98765 43210 → rahu3210). Setting their own password stays their choice, never forced.
 * Email is optional (migration 698).
 *
 * Previous behaviour (ApplicationId-keyed, repoint-on-collision) was
 * replaced by migration 254.
 */
const bcrypt = require("bcrypt");
const { sql } = require("../db");

/** A mobile number as the sign-in key: its last 10 digits ("+91 98765 43210" → "9876543210"); null when shorter. */
function normalizeMobile(mobile) {
  const digits = String(mobile || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * The customer's first portal password — the one rule sign-in, account creation, staff reset and the bulk reset use:
 * the first 4 letters of the name (letters only; spaces, dots and titles' punctuation skipped) + the last 4 digits of
 * the mobile, all small. A name with fewer letters gives what it has. Null when either part is missing.
 */
function defaultPortalPassword(name, mobile) {
  const letters = String(name || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 4);
  const m = normalizeMobile(mobile);
  return letters && m ? letters + m.slice(-4) : null;
}

/** The same rule, written for staff and customers (no example values of a real person). */
const DEFAULT_PASSWORD_RULE = "the first 4 letters of the name and the last 4 digits of the mobile number, in small letters";

async function ensurePortalUser(pool, applicationId, customerId = null) {
  let row = null;
  if (customerId) {
    const cust = await pool.request().input("cid", sql.Int, customerId).query(`
      SELECT Id AS CustomerId, CustomerName, Email, Mobile
      FROM dbo.CrmCustomer
      WHERE Id = @cid AND IsActive = 1
    `);
    if (!cust.recordset.length) return { created: false, error: "Customer not found" };
    row = cust.recordset[0];
  } else if (applicationId) {
    // Resolve ApplicationId → CrmCustomer (preferred) → name, email, mobile.
    // CrmCustomer is the canonical identity record; falls back to Application's
    // own snapshot only if CustomerId is somehow null (shouldn't happen post-181).
    const app = await pool.request().input("aid", sql.Int, applicationId).query(`
      SELECT
        a.Id          AS ApplicationId,
        a.CustomerId,
        COALESCE(c.CustomerName, a.ApplicantName) AS CustomerName,
        COALESCE(c.Email,   a.Email)  AS Email,
        COALESCE(c.Mobile,  a.Mobile) AS Mobile
      FROM dbo.CrmApplication a
      LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
      WHERE a.Id = @aid AND a.IsActive = 1
    `);
    if (!app.recordset.length) return { created: false, error: "Application not found" };
    row = app.recordset[0];
  } else {
    return { created: false, error: "Either applicationId or customerId is required" };
  }

  if (!row.CustomerId) return { created: false, error: "Application has no linked Customer record — cannot provision portal login" };
  if (!normalizeMobile(row.Mobile)) return { created: false, error: "Customer has no 10-digit mobile number on file — it is their portal sign-in" };
  const password = defaultPortalPassword(row.CustomerName, row.Mobile);
  if (!password) return { created: false, error: "Customer has no name on file — it makes their first portal password" };

  const resolvedCustomerId = row.CustomerId;
  const email = row.Email ? String(row.Email).trim().toLowerCase() || null : null;

  // Idempotent: if a portal account already exists for this CustomerId, reuse
  // it — a second Agreement on the same customer simply picks up the existing
  // login without changing anything (its email is kept in step, when there is one).
  const existing = await pool.request().input("cid", sql.Int, resolvedCustomerId)
    .query("SELECT Id FROM dbo.CrmCustomerPortalUser WHERE CustomerId = @cid");
  if (existing.recordset.length) {
    const portalId = existing.recordset[0].Id;
    if (email) {
      await pool.request()
        .input("id", sql.Int, portalId)
        .input("em", sql.NVarChar(200), email)
        .query("UPDATE dbo.CrmCustomerPortalUser SET Email = @em WHERE Id = @id");
    }
    return { created: false, id: portalId };
  }

  // New customer — create their portal account keyed to CustomerId, with the first password (hashed).
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.request()
    .input("cid",  sql.Int,          resolvedCustomerId)
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

module.exports = { ensurePortalUser, normalizeMobile, defaultPortalPassword, DEFAULT_PASSWORD_RULE };
