const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { ensureCrmCustomerLedgerHead, syncCrmCustomerLedgerHead } = require("../services/crmLedger");
const { syncCoApplicantFromCustomerEdit } = require("../services/crmEntityCreation");

router.use(authMiddleware);
router.use(apiRateLimit);

// Fields the Application page ("select company/project, auto-fetch
// everything from the customer") reads directly, plus the co-applicant set
// and PAN/Aadhaar/Address that now live here instead of being typed fresh
// on every application.
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
    c.CoApplicantName, c.CoApplicantMobile, c.CoApplicantPanNo, c.CoApplicantRelation,
    c.Notes, c.IsActive, c.CreatedAt, c.UpdatedAt,
    cu.name AS CreatedByName,
    l.LeadUid, l.Classification AS LeadClassification,
    (SELECT COUNT(*) FROM dbo.CrmApplication a WHERE a.CustomerId = c.Id) AS ApplicationCount
  FROM dbo.CrmCustomer c
  LEFT JOIN dbo.Users cu ON cu.id = c.CreatedBy
  LEFT JOIN dbo.SaLead l ON l.Id = c.LeadId
`;

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
// Occupation, Annual Income, co-applicant, DOB, current address,
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

    const cur = resolveCurrentAddress(b);
    const customerNo = await getNextDocNumber(pool, "CUST", "CUST");
    const result = await pool.request()
      .input("no",       sql.NVarChar(30),  customerNo)
      .input("lid",       sql.Int,           b.LeadId ? parseInt(b.LeadId) : null)
      .input("name",      sql.NVarChar(200), b.CustomerName.trim())
      .input("mob",       sql.NVarChar(20),  b.Mobile.trim())
      .input("altmob",    sql.NVarChar(20),  b.AltMobile || null)
      .input("email",     sql.NVarChar(200), b.Email || null)
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
      .input("coname",    sql.NVarChar(200), b.CoApplicantName || null)
      .input("comob",     sql.NVarChar(20),  b.CoApplicantMobile || null)
      .input("copan",     sql.NVarChar(20),  b.CoApplicantPanNo || null)
      .input("corel",     sql.NVarChar(50),  b.CoApplicantRelation || null)
      .input("notes",     sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",        sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmCustomer
          (CustomerNo, LeadId, CustomerName, Mobile, AltMobile, Email, PanNo, AadhaarNo, Occupation, AnnualIncome,
           Address, City, State, Pincode,
           CurrentAddress, CurrentCity, CurrentState, CurrentPincode, IsCurrentSameAsPermanent,
           DateOfBirth, CoApplicantName, CoApplicantMobile, CoApplicantPanNo, CoApplicantRelation, Notes,
           CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @lid, @name, @mob, @altmob, @email, @pan, @aadhaar, @occ, @income,
                @addr, @city, @state, @pin,
                @curaddr, @curcity, @curstate, @curpin, @cursame,
                @dob, @coname, @comob, @copan, @corel, @notes, @cb, SYSDATETIME())
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
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "A customer with this mobile number already exists" });
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
    const cur = resolveCurrentAddress(b);
    await pool.request()
      .input("id",       sql.Int,           id)
      .input("name",      sql.NVarChar(200), b.CustomerName || null)
      .input("mob",       sql.NVarChar(20),  b.Mobile || null)
      .input("altmob",    sql.NVarChar(20),  b.AltMobile ?? null)
      .input("email",     sql.NVarChar(200), b.Email ?? null)
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
      .input("coname",    sql.NVarChar(200), b.CoApplicantName ?? null)
      .input("comob",     sql.NVarChar(20),  b.CoApplicantMobile ?? null)
      .input("copan",     sql.NVarChar(20),  b.CoApplicantPanNo ?? null)
      .input("corel",     sql.NVarChar(50),  b.CoApplicantRelation ?? null)
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
          CoApplicantName = @coname, CoApplicantMobile = @comob, CoApplicantPanNo = @copan, CoApplicantRelation = @corel,
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
      .input("email",  sql.NVarChar(200), b.Email ?? null)
      .query(`
        UPDATE dbo.CrmApplication SET
          ApplicantName = ISNULL(@name, ApplicantName),
          Mobile = ISNULL(@mob, Mobile),
          AltMobile = @altmob,
          Email = @email
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
        CustomerName: b.CustomerName, Mobile: b.Mobile, Email: b.Email, Address: b.PermanentAddress, PanNo: b.PanNo,
      });
    } catch (ledgerErr) {
      console.error("[crm-customers] ledger head sync failed:", ledgerErr.message);
    }

    // Same lockstep guarantee, extended to any already-created CrmCoApplicant
    // row that was auto-seeded from this customer's intake-time co-applicant
    // fields (see seedPrimaryCoApplicantFromCustomer) — that seed only fires
    // once, at booking creation, so without this an edit here would silently
    // never reach the row Welcome Call/Booking Details actually display.
    // No-op if no booking/co-applicant exists yet, or the edit didn't touch
    // any CoApplicant* field.
    try {
      await syncCoApplicantFromCustomerEdit(pool, id, {
        CoApplicantName: b.CoApplicantName, CoApplicantRelation: b.CoApplicantRelation,
        CoApplicantMobile: b.CoApplicantMobile, CoApplicantPanNo: b.CoApplicantPanNo,
      });
    } catch (coAppErr) {
      console.error("[crm-customers] co-applicant sync failed:", coAppErr.message);
    }

    res.json({ success: true });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "A customer with this mobile number already exists" });
    }
    console.error("[crm-customers] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;