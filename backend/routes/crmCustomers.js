const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { ensureCrmCustomerLedgerHead, syncCrmCustomerLedgerHead } = require("../services/crmLedger");

router.use(authMiddleware);
router.use(apiRateLimit);

// Fields the Application page ("select company/project, auto-fetch
// everything from the customer") reads directly — PAN/Aadhaar/Address that
// live here instead of being typed fresh on every application. Co-Applicant
// is NOT among these: it's captured on the Application's own "Co-Applicant"
// tab instead (see crmCoApplicant.js, keyed by ApplicationId directly into
// dbo.CrmCoApplicant) and was never a CrmCustomer field.
//
// Address is split two ways:
//   - PermanentAddress/City/State/Pincode  → dbo.CrmCustomer's original
//     Address/City/State/Pincode columns (kept as-is, no rename)
//   - CurrentAddress/City/State/Pincode    → new columns; when
//     IsCurrentSameAsPermanent = 1 these are kept in lockstep with the
//     permanent fields on every write (see POST/PUT below), so any
//     consumer reading Current* directly always gets a real value instead
//     of having to fall back to Permanent* itself.
const CUSTOMER_SELECT = `
  SELECT
    c.Id, c.CustomerNo, c.LeadId, c.CustomerName, c.Mobile, c.AltMobile, c.Email,
    c.PanNo, c.AadhaarNo, c.Occupation, c.AnnualIncome,
    c.Address AS PermanentAddress, c.City AS PermanentCity, c.State AS PermanentState, c.Pincode AS PermanentPincode,
    c.CurrentAddress, c.CurrentCity, c.CurrentState, c.CurrentPincode, c.IsCurrentSameAsPermanent,
    c.DateOfBirth,
    c.Notes, c.IsActive, c.CreatedAt, c.UpdatedAt,
    cu.name AS CreatedByName,
    l.LeadUid, l.Classification AS LeadClassification,
    (SELECT COUNT(*) FROM dbo.CrmApplication a WHERE a.CustomerId = c.Id) AS ApplicationCount
  FROM dbo.CrmCustomer c
  LEFT JOIN dbo.Users cu ON cu.id = c.CreatedBy
  LEFT JOIN dbo.SaLead l ON l.Id = c.LeadId
`;

function normalizeEmail(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  return trimmed || null;
}

async function assertUniqueCustomerEmail(pool, email, excludeId = null) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const req = pool.request().input("email", sql.NVarChar(200), normalized);
  const exclude = excludeId ? "AND Id <> @id" : "";
  if (excludeId) req.input("id", sql.Int, excludeId);

  const existing = await req.query(`
    SELECT TOP 1 Id, CustomerNo, CustomerName
    FROM dbo.CrmCustomer
    WHERE IsActive = 1
      AND LOWER(LTRIM(RTRIM(Email))) = @email
      ${exclude}
  `);
  if (!existing.recordset.length) return;

  const row = existing.recordset[0];
  const err = new Error(`A customer with this email already exists - ${row.CustomerNo} (${row.CustomerName})`);
  err.status = 409;
  throw err;
}

// GET / — all customers
router.get("/", requirePageRight("crm-customers", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { search } = req.query;
    const req0 = pool.request();
    const conds = ["c.IsActive = 1"];
    if (search) {
      req0.input("srch", sql.NVarChar(200), `%${search}%`);
      conds.push("(c.CustomerName LIKE @srch OR c.Mobile LIKE @srch OR c.CustomerNo LIKE @srch OR c.PanNo LIKE @srch)");
    }
    const result = await req0.query(`${CUSTOMER_SELECT} WHERE ${conds.join(" AND ")} ORDER BY c.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-customers] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /suggest — lightweight duplicate-detection endpoint called by the New
// Customer form in real time (on Mobile/PAN/Name blur) and on explicit
// submit, so staff see potential duplicates BEFORE they create a new record.
// Returns up to 5 candidates ranked by match strength:
//   1. Exact mobile match  (highest confidence — almost certainly the same person)
//   2. Exact PAN match     (legally unique per person — definitely the same person)
//   3. Exact email match   (high confidence)
//   4. Name LIKE % match   (lower confidence — catches "Rahul Sharma" vs "Rahul K Sharma")
// Route placed BEFORE /:id so Express doesn't mistake "suggest" for a numeric ID.
router.get("/suggest", requirePageRight("crm-customers", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { mobile, pan, email, name, excludeId } = req.query;
    const excl = excludeId ? "AND c.Id <> @excl" : "";
    const req0 = pool.request();
    if (excludeId) req0.input("excl", sql.Int, parseInt(excludeId));

    const conds = ["c.IsActive = 1", excl];
    const orClauses = [];

    if (mobile?.toString().trim()) {
      req0.input("mob", sql.NVarChar(20), mobile.toString().trim());
      orClauses.push("c.Mobile = @mob");
    }
    if (pan?.toString().trim()) {
      req0.input("pan", sql.NVarChar(20), pan.toString().trim().toUpperCase());
      orClauses.push("UPPER(c.PanNo) = @pan");
    }
    if (email?.toString().trim()) {
      req0.input("email", sql.NVarChar(200), email.toString().trim().toLowerCase());
      orClauses.push("LOWER(c.Email) = @email");
    }
    if (name?.toString().trim()) {
      req0.input("name", sql.NVarChar(200), `%${name.toString().trim()}%`);
      orClauses.push("c.CustomerName LIKE @name");
    }

    if (!orClauses.length) return res.json([]);

    conds.push(`(${orClauses.join(" OR ")})`);

    // Score each candidate so exact-mobile and exact-PAN matches float to the
    // top of the list — those are near-certainties, name matches are hints.
    const scoreExpr = [
      mobile?.toString().trim() ? "CASE WHEN c.Mobile = @mob THEN 40 ELSE 0 END" : "0",
      pan?.toString().trim()    ? "CASE WHEN UPPER(c.PanNo) = @pan THEN 40 ELSE 0 END" : "0",
      email?.toString().trim()  ? "CASE WHEN LOWER(c.Email) = @email THEN 20 ELSE 0 END" : "0",
      name?.toString().trim()   ? "CASE WHEN c.CustomerName LIKE @name THEN 10 ELSE 0 END" : "0",
    ].join(" + ");

    const result = await req0.query(`
      SELECT TOP 5
        c.Id, c.CustomerNo, c.CustomerName, c.Mobile, c.AltMobile, c.Email, c.PanNo,
        c.Address AS PermanentAddress, c.City AS PermanentCity,
        (SELECT COUNT(*) FROM dbo.CrmApplication a WHERE a.CustomerId = c.Id) AS ApplicationCount,
        (${scoreExpr}) AS MatchScore
      FROM dbo.CrmCustomer c
      WHERE ${conds.join(" AND ")}
      ORDER BY (${scoreExpr}) DESC, c.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-customers] GET /suggest error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — single customer plus every application filed under them, so
// staff can see their full history in one place (not just the latest one).
// Also aggregates outstanding payment across EVERY booking this customer
// has — not just one booking at a time like Customer 360's per-row figures
// — since a customer with two units should see one true total, not have to
// add up two separate numbers themselves.
router.get("/:id", requirePageRight("crm-customers", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [custRes, appsRes, outstandingRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${CUSTOMER_SELECT} WHERE c.Id = @id`),
      pool.request().input("id", sql.Int, id).query(`
        SELECT a.Id, a.ApplicationNo, a.Status, a.InterestedProject, a.CreatedAt,
               b.Id AS BookingId, b.BookingNo, b.Status AS BookingStatus
        FROM dbo.CrmApplication a
        OUTER APPLY (SELECT TOP 1 Id, BookingNo, Status FROM dbo.CrmBooking WHERE ApplicationId = a.Id ORDER BY CreatedAt DESC) b
        WHERE a.CustomerId = @id
        ORDER BY a.CreatedAt DESC
      `),
      pool.request().input("id", sql.Int, id).query(`
        SELECT
          ISNULL(SUM(CASE WHEN m.Status NOT IN ('Paid', 'Waived') THEN m.AmountDue - ISNULL(m.AmountPaid, 0) ELSE 0 END), 0) AS TotalOutstanding,
          ISNULL(SUM(ISNULL(m.AmountPaid, 0)), 0) AS TotalPaid,
          ISNULL(SUM(m.AmountDue), 0) AS TotalDue
        FROM dbo.CrmPaymentMilestone m
        JOIN dbo.CrmBooking b ON b.Id = m.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE a.CustomerId = @id AND b.Status NOT IN ('Cancelled', 'Rejected')
      `),
    ]);
    if (!custRes.recordset.length) return res.status(404).json({ error: "Customer not found" });
    res.json({
      ...custRes.recordset[0],
      applications: appsRes.recordset,
      outstanding: outstandingRes.recordset[0],
    });
  } catch (e) {
    console.error("[crm-customers] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Resolves the Current-address fields to write, given the incoming payload.
// When IsCurrentSameAsPermanent is truthy (including "unset", which
// defaults to true — same-as-permanent is the common case), Current* is
// copied from Permanent* on every write rather than left blank, so any
// consumer reading CurrentAddress directly (without knowing about the
// flag) always sees a real value.
function resolveCurrentAddress(b) {
  const sameAsPermanent = b.IsCurrentSameAsPermanent !== false;
  if (sameAsPermanent) {
    return {
      sameAsPermanent: true,
      currentAddress: b.PermanentAddress?.trim() || null,
      currentCity: b.PermanentCity || null,
      currentState: b.PermanentState || null,
      currentPincode: b.PermanentPincode || null,
    };
  }
  return {
    sameAsPermanent: false,
    currentAddress: b.CurrentAddress?.trim() || null,
    currentCity: b.CurrentCity || null,
    currentState: b.CurrentState || null,
    currentPincode: b.CurrentPincode || null,
  };
}

// POST / — register a new customer. Name/Mobile/PAN/Permanent Address are
// the must-needed fields kept mandatory; everything else (Aadhaar,
// Occupation, Annual Income, DOB, current address,
// city/state/pincode) is optional detail filled in as it becomes
// available. Deduped by Mobile — reusing an existing customer instead of
// silently creating a second identity for the same phone number,
// mirroring the SaLead dedup pattern already used elsewhere in the CRM.
router.post("/", requirePageRight("crm-customers", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const missing = [];
    if (!b.CustomerName?.trim()) missing.push("Customer Name");
    if (!b.Mobile?.trim()) missing.push("Mobile");
    if (!b.PanNo?.trim()) missing.push("PAN Number");
    if (!b.PermanentAddress?.trim()) missing.push("Permanent Address");
    if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });

    const existing = await pool.request().input("mob", sql.NVarChar(20), b.Mobile.trim())
      .query("SELECT Id, CustomerNo, CustomerName FROM dbo.CrmCustomer WHERE Mobile = @mob AND IsActive = 1");
    if (existing.recordset.length) {
      return res.status(409).json({
        error: `A customer with this mobile number already exists — ${existing.recordset[0].CustomerNo} (${existing.recordset[0].CustomerName})`,
        existingCustomerId: existing.recordset[0].Id,
      });
    }

    // This is the actual "only a converted lead may enter the CRM module"
    // gate — Leads -> Customer is now the real entry point (Applications
    // only ever pick an existing Customer, see CrmApplication.tsx), so the
    // check belongs here, not on Application creation. Blocks a lead that
    // hasn't been converted yet, and blocks reusing a lead that's already
    // linked to another live customer (mirrors the LeadId gate
    // createCrmApplicationRecord used to enforce directly).
    if (b.LeadId) {
      const lr = await pool.request().input("lid", sql.Int, parseInt(b.LeadId))
        .query("SELECT Status FROM dbo.SaLead WHERE Id = @lid");
      if (!lr.recordset.length) return res.status(400).json({ error: "Selected lead does not exist" });
      if (lr.recordset[0].Status !== "Converted") {
        return res.status(400).json({ error: `This lead isn't converted yet (status: ${lr.recordset[0].Status}) — only converted leads can be linked to a customer` });
      }
      const already = await pool.request().input("lid", sql.Int, parseInt(b.LeadId))
        .query("SELECT Id, CustomerNo, CustomerName FROM dbo.CrmCustomer WHERE LeadId = @lid AND IsActive = 1");
      if (already.recordset.length) {
        return res.status(409).json({ error: `This lead is already linked to another customer — ${already.recordset[0].CustomerNo} (${already.recordset[0].CustomerName})` });
      }
    }

    const email = normalizeEmail(b.Email);
    await assertUniqueCustomerEmail(pool, email);

    const cur = resolveCurrentAddress(b);
    const customerNo = await getNextDocNumber(pool, "CUST", "CUST");
    const result = await pool.request()
      .input("no",       sql.NVarChar(30),  customerNo)
      .input("lid",       sql.Int,           b.LeadId ? parseInt(b.LeadId) : null)
      .input("name",      sql.NVarChar(200), b.CustomerName.trim())
      .input("mob",       sql.NVarChar(20),  b.Mobile.trim())
      .input("altmob",    sql.NVarChar(20),  b.AltMobile || null)
      .input("email",     sql.NVarChar(200), email)
      .input("pan",       sql.NVarChar(20),  b.PanNo.trim())
      .input("aadhaar",   sql.NVarChar(20),  b.AadhaarNo || null)
      .input("occ",       sql.NVarChar(100), b.Occupation || null)
      .input("income",    sql.Decimal(18, 2), b.AnnualIncome !== "" && b.AnnualIncome != null ? parseFloat(b.AnnualIncome) : null)
      .input("addr",      sql.NVarChar(500), b.PermanentAddress.trim())
      .input("city",      sql.NVarChar(100), b.PermanentCity || null)
      .input("state",     sql.NVarChar(100), b.PermanentState || null)
      .input("pin",       sql.NVarChar(10),  b.PermanentPincode || null)
      .input("curaddr",   sql.NVarChar(500), cur.currentAddress)
      .input("curcity",   sql.NVarChar(100), cur.currentCity)
      .input("curstate",  sql.NVarChar(100), cur.currentState)
      .input("curpin",    sql.NVarChar(10),  cur.currentPincode)
      .input("cursame",   sql.Bit,           cur.sameAsPermanent ? 1 : 0)
      .input("dob",       sql.Date,          b.DateOfBirth || null)
      .input("notes",     sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",        sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmCustomer
          (CustomerNo, LeadId, CustomerName, Mobile, AltMobile, Email, PanNo, AadhaarNo, Occupation, AnnualIncome,
           Address, City, State, Pincode,
           CurrentAddress, CurrentCity, CurrentState, CurrentPincode, IsCurrentSameAsPermanent,
           DateOfBirth, Notes,
           CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @lid, @name, @mob, @altmob, @email, @pan, @aadhaar, @occ, @income,
                @addr, @city, @state, @pin,
                @curaddr, @curcity, @curstate, @curpin, @cursame,
                @dob, @notes, @cb, SYSDATETIME())
      `);
    const newId = result.recordset[0].Id;

    // Eagerly create the "Customer Master" ledger head (dbo.AccountHeadMaster,
    // LHeadType='C') instead of waiting for the first GL-posting event —
    // otherwise a customer with an application/booking but no payment yet
    // is invisible to the Sales module's Customer Sale Order picker and
    // Finance's customer lists until money actually moves. Never blocks
    // customer creation if this fails.
    try {
      await ensureCrmCustomerLedgerHead(pool, newId, req.user?.name || req.user?.email || "system");
    } catch (ledgerErr) {
      console.error("[crm-customers] ledger head creation failed:", ledgerErr.message);
    }

    res.status(201).json({ success: true, id: newId, CustomerNo: customerNo });
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: e.message });
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "A customer with this mobile number or email already exists" });
    }
    console.error("[crm-customers] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — edit. Mobile is intentionally left editable here (typos
// happen) but stays subject to the same unique-while-active index.
router.put("/:id", requirePageRight("crm-customers", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    const email = normalizeEmail(b.Email);
    await assertUniqueCustomerEmail(pool, email, id);

    const cur = resolveCurrentAddress(b);
    await pool.request()
      .input("id",       sql.Int,           id)
      .input("name",      sql.NVarChar(200), b.CustomerName || null)
      .input("mob",       sql.NVarChar(20),  b.Mobile || null)
      .input("altmob",    sql.NVarChar(20),  b.AltMobile ?? null)
      .input("email",     sql.NVarChar(200), email)
      .input("pan",       sql.NVarChar(20),  b.PanNo || null)
      .input("aadhaar",   sql.NVarChar(20),  b.AadhaarNo ?? null)
      .input("occ",       sql.NVarChar(100), b.Occupation ?? null)
      .input("income",    sql.Decimal(18, 2), b.AnnualIncome !== "" && b.AnnualIncome != null ? parseFloat(b.AnnualIncome) : null)
      .input("addr",      sql.NVarChar(500), b.PermanentAddress || null)
      .input("city",      sql.NVarChar(100), b.PermanentCity ?? null)
      .input("state",     sql.NVarChar(100), b.PermanentState ?? null)
      .input("pin",       sql.NVarChar(10),  b.PermanentPincode ?? null)
      .input("curaddr",   sql.NVarChar(500), cur.currentAddress)
      .input("curcity",   sql.NVarChar(100), cur.currentCity)
      .input("curstate",  sql.NVarChar(100), cur.currentState)
      .input("curpin",    sql.NVarChar(10),  cur.currentPincode)
      .input("cursame",   sql.Bit,           cur.sameAsPermanent ? 1 : 0)
      .input("dob",       sql.Date,          b.DateOfBirth || null)
      .input("notes",     sql.NVarChar(sql.MAX), b.Notes ?? null)
      .input("ub",        sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmCustomer SET
          CustomerName = ISNULL(@name, CustomerName), Mobile = ISNULL(@mob, Mobile),
          AltMobile = @altmob, Email = @email,
          PanNo = ISNULL(@pan, PanNo), AadhaarNo = @aadhaar, Occupation = @occ, AnnualIncome = @income,
          Address = ISNULL(@addr, Address), City = @city, State = @state, Pincode = @pin,
          CurrentAddress = @curaddr, CurrentCity = @curcity, CurrentState = @curstate, CurrentPincode = @curpin,
          IsCurrentSameAsPermanent = @cursame,
          DateOfBirth = ISNULL(@dob, DateOfBirth),
          Notes = @notes, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // CrmApplication.Email/Mobile/AltMobile were originally seeded FROM the
    // customer at application-creation time but are separate copies — left
    // unsynced, an edit here (e.g. correcting a typo) would silently leave
    // every linked application, and therefore that application's already-
    // provisioned portal login lookup, pointing at the stale value. Keep
    // them in lockstep since CrmCustomer is the canonical identity record.
    await pool.request()
      .input("id",     sql.Int,          id)
      .input("name",   sql.NVarChar(200), b.CustomerName || null)
      .input("mob",    sql.NVarChar(20), b.Mobile || null)
      .input("altmob", sql.NVarChar(20), b.AltMobile ?? null)
      .input("email",  sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.CrmApplication SET
          ApplicantName = ISNULL(@name, ApplicantName),
          Mobile = ISNULL(@mob, Mobile),
          AltMobile = @altmob,
          Email = @email
        WHERE CustomerId = @id
      `);

    await pool.request()
      .input("id", sql.Int, id)
      .input("email", sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.CrmCustomerPortalUser
        SET Email = @email
        WHERE CustomerId = @id
      `);

    // Same lockstep guarantee, extended to the "Customer Master" ledger head
    // (dbo.AccountHeadMaster, LHeadType='C') that the Sales module's Customer
    // Sale Orders and Finance's ledger/Trial Balance reports actually read —
    // ensureCrmCustomerLedgerHead only ever wrote this once, at first
    // payment, so an edit here previously left that master record stale
    // forever. No-op if the customer has no ledger head yet.
    try {
      await syncCrmCustomerLedgerHead(pool, id, {
        CustomerName: b.CustomerName, Mobile: b.Mobile, Email: email, Address: b.PermanentAddress, PanNo: b.PanNo,
      });
    } catch (ledgerErr) {
      console.error("[crm-customers] ledger head sync failed:", ledgerErr.message);
    }

    res.json({ success: true });
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: e.message });
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "A customer with this mobile number or email already exists" });
    }
    console.error("[crm-customers] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;