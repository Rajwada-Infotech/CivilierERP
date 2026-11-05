// Co-applicants are customers too.
//
// The 1st applicant is the application's own customer; co-applicants are
// Applicant 2, 3 … and each is a customer in the customer pool
// (dbo.CrmCustomer). linkCoApplicantToCustomer finds that customer — by
// mobile, then PAN, then email, the identifiers a person is known by — or
// creates one from the co-applicant's details, and records the link on
// CrmCoApplicant.CustomerId (migration 556). An existing customer is linked,
// never duplicated, and its own record is not overwritten.
const { sql } = require("../db");
const { getNextDocNumber } = require("./docNumber");

const clean = (v) => (v == null ? "" : String(v).trim());

async function findCustomer(db, { mobile, pan, email }) {
  const tries = [
    mobile && ["mob", sql.NVarChar(20), mobile, "Mobile = @mob"],
    pan && ["pan", sql.NVarChar(20), pan.toUpperCase(), "UPPER(LTRIM(RTRIM(PanNo))) = @pan"],
    email && ["em", sql.NVarChar(200), email.toLowerCase(), "LOWER(LTRIM(RTRIM(Email))) = @em"],
  ].filter(Boolean);
  for (const [name, type, value, where] of tries) {
    const r = await db.request().input(name, type, value)
      .query(`SELECT TOP 1 Id FROM dbo.CrmCustomer WHERE IsActive = 1 AND ${where} ORDER BY Id`);
    if (r.recordset[0]) return r.recordset[0].Id;
  }
  return null;
}

/** Links one co-applicant to its customer (found or created). Returns the CustomerId, or null. */
async function linkCoApplicantToCustomer(db, coApplicantId, actorUserId = null) {
  const has = (await db.request().query("SELECT COL_LENGTH('dbo.CrmCoApplicant', 'CustomerId') AS c")).recordset[0].c != null;
  if (!has) return null; // before migration 556
  const co = (await db.request().input("id", sql.Int, coApplicantId).query(`
    SELECT Id, Name, Mobile, Email, PanNo, AadhaarNo, DateOfBirth, Occupation, AnnualIncome, Address, City, [State], Pincode, CustomerId
    FROM dbo.CrmCoApplicant WHERE Id = @id AND IsActive = 1`)).recordset[0];
  if (!co || !clean(co.Name)) return null;
  const mobile = clean(co.Mobile), pan = clean(co.PanNo), email = clean(co.Email);
  let customerId = co.CustomerId || await findCustomer(db, { mobile, pan, email });
  if (!customerId) {
    const customerNo = await getNextDocNumber(require("../db").getPool(), "CUST", "CUST");
    const r = await db.request()
      .input("no", sql.NVarChar(30), customerNo).input("name", sql.NVarChar(200), clean(co.Name))
      .input("mob", sql.NVarChar(20), mobile || null).input("em", sql.NVarChar(200), email ? email.toLowerCase() : null)
      .input("pan", sql.NVarChar(20), pan ? pan.toUpperCase() : null).input("aad", sql.NVarChar(20), clean(co.AadhaarNo) || null)
      .input("dob", sql.Date, co.DateOfBirth || null).input("occ", sql.NVarChar(100), clean(co.Occupation) || null)
      .input("inc", sql.Decimal(18, 2), co.AnnualIncome != null ? Number(co.AnnualIncome) : null)
      .input("addr", sql.NVarChar(300), clean(co.Address) || null).input("city", sql.NVarChar(100), clean(co.City) || null)
      .input("st", sql.NVarChar(100), clean(co.State) || null).input("pin", sql.NVarChar(10), clean(co.Pincode) || null)
      .input("cb", sql.Int, actorUserId)
      .query(`INSERT INTO dbo.CrmCustomer (CustomerNo, CustomerName, Mobile, Email, PanNo, AadhaarNo, DateOfBirth, Occupation, AnnualIncome,
                Address, City, [State], Pincode, Notes, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id
              VALUES (@no, @name, @mob, @em, @pan, @aad, @dob, @occ, @inc, @addr, @city, @st, @pin, N'Added as a co-applicant', @cb, SYSDATETIME())`)
      .catch(async (e) => {
        // a customer with this mobile was created in the meantime — link to it
        if (/UNIQUE|unique/.test(e.message)) return { recordset: [{ Id: await findCustomer(db, { mobile, pan, email }) }] };
        throw e;
      });
    customerId = r.recordset[0]?.Id || null;
  }
  if (customerId && customerId !== co.CustomerId) {
    await db.request().input("id", sql.Int, co.Id).input("c", sql.Int, customerId)
      .query("UPDATE dbo.CrmCoApplicant SET CustomerId = @c WHERE Id = @id");
  }
  return customerId;
}

/** Links every co-applicant of an application / booking that has no customer yet. */
async function linkCoApplicantsOf(db, { applicationId = null, bookingId = null }, actorUserId = null) {
  const has = (await db.request().query("SELECT COL_LENGTH('dbo.CrmCoApplicant', 'CustomerId') AS c")).recordset[0].c != null;
  if (!has) return 0;
  const rows = (await db.request().input("a", sql.Int, applicationId).input("b", sql.Int, bookingId).query(`
    SELECT Id FROM dbo.CrmCoApplicant
    WHERE IsActive = 1 AND CustomerId IS NULL AND ((@a IS NOT NULL AND ApplicationId = @a) OR (@b IS NOT NULL AND BookingId = @b))`)).recordset;
  for (const r of rows) await linkCoApplicantToCustomer(db, r.Id, actorUserId);
  return rows.length;
}

class CoApplicantError extends Error { constructor(m, status = 409) { super(m); this.status = status; } }

/**
 * Before a co-applicant is saved: who is this person in the customer pool —
 * the customer picked from the list (b.CustomerId), else the one matching
 * their mobile / PAN / email — and are they already on this application or
 * booking? The main applicant can't also be a co-applicant, and nobody is
 * added twice. Returns the CustomerId to link (or null for a new person);
 * throws CoApplicantError on a duplicate. `exceptId` = the row being edited.
 */
async function resolveCoApplicantCustomer(db, { applicationId = null, bookingId = null, exceptId = null }, b) {
  let customerId = b.CustomerId != null && b.CustomerId !== "" ? Number(b.CustomerId) : null;
  if (customerId != null) {
    const ok = (await db.request().input("c", sql.Int, customerId).query("SELECT TOP 1 Id FROM dbo.CrmCustomer WHERE Id = @c AND IsActive = 1")).recordset[0];
    if (!ok) throw new CoApplicantError("That customer was not found", 400);
    // The details typed in must not belong to a DIFFERENT customer.
    const other = await findCustomer(db, { mobile: clean(b.Mobile), pan: clean(b.PanNo), email: clean(b.Email) });
    if (other && other !== customerId) {
      const n = (await db.request().input("c", sql.Int, other).query("SELECT CustomerNo, CustomerName FROM dbo.CrmCustomer WHERE Id = @c")).recordset[0];
      throw new CoApplicantError(`That mobile / PAN / email belongs to ${n.CustomerName} (${n.CustomerNo}) — pick them from the list instead`);
    }
  } else {
    customerId = await findCustomer(db, { mobile: clean(b.Mobile), pan: clean(b.PanNo), email: clean(b.Email) });
  }
  if (customerId == null) return null;
  const has = (await db.request().query("SELECT COL_LENGTH('dbo.CrmCoApplicant', 'CustomerId') AS c")).recordset[0].c != null;
  const r = (await db.request().input("a", sql.Int, applicationId).input("b", sql.Int, bookingId).input("c", sql.Int, customerId).input("x", sql.Int, exceptId).query(`
    SELECT
      (SELECT TOP 1 cu.CustomerName FROM dbo.CrmCustomer cu WHERE cu.Id = @c) AS Name,
      CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmApplication a WHERE a.CustomerId = @c AND (a.Id = @a OR a.Id = (SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @b))) THEN 1 ELSE 0 END AS IsMain,
      ${has ? `CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmCoApplicant k WHERE k.IsActive = 1 AND k.CustomerId = @c AND (@x IS NULL OR k.Id <> @x)
                AND ((@a IS NOT NULL AND k.ApplicationId = @a) OR (@b IS NOT NULL AND k.BookingId = @b))) THEN 1 ELSE 0 END` : "0"} AS IsCo`)).recordset[0];
  if (r.IsMain) throw new CoApplicantError(`${r.Name} is the main applicant (Applicant 1) — they can't also be a co-applicant`);
  if (r.IsCo) throw new CoApplicantError(`${r.Name} is already a co-applicant here`);
  return customerId;
}

module.exports = { linkCoApplicantToCustomer, linkCoApplicantsOf, resolveCoApplicantCustomer, CoApplicantError };
