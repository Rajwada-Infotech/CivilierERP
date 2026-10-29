// Bulk customer import service (CRM → Customers → Import).
//
// Designed for importing customers from diverse external sources (.xlsx, .xls, .csv, tab-delimited, clipboard).
// Provides deep multi-identifier lookup (Mobile, AltMobile, PAN, Aadhaar, Email, CustomerNo, SaLead),
// robust parsing/sanitization, in-file deduplication, cross-customer conflict detection,
// flexible conflict resolution (skip, fill blank details, overwrite/update), and audit logging.

const { sql } = require("../db");
const { getNextDocNumber } = require("./docNumber");
const { normalizePhone } = require("../validation/phone");

const MAX_ROWS = 2500;

/** Importable fields: key → label, and format metadata. */
const FIELDS = [
  { key: "CustomerName", label: "Customer Name", required: true },
  { key: "Mobile", label: "Mobile" },
  { key: "AltMobile", label: "Alternate Mobile" },
  { key: "Email", label: "Email" },
  { key: "PanNo", label: "PAN" },
  { key: "GstNo", label: "GSTIN (registered buyer)" },
  { key: "AadhaarNo", label: "Aadhaar" },
  { key: "DateOfBirth", label: "Date of Birth" },
  { key: "Occupation", label: "Occupation" },
  { key: "AnnualIncome", label: "Annual Income" },
  { key: "PermanentAddress", label: "Permanent Address" },
  { key: "PermanentCity", label: "Permanent City" },
  { key: "PermanentState", label: "Permanent State" },
  { key: "PermanentPincode", label: "Permanent Pincode" },
  { key: "CurrentAddress", label: "Current Address" },
  { key: "CurrentCity", label: "Current City" },
  { key: "CurrentState", label: "Current State" },
  { key: "CurrentPincode", label: "Current Pincode" },
  { key: "InvoiceMode", label: "Invoice Mode" },
  { key: "Notes", label: "Notes" },
  { key: "CustomerNo", label: "Customer No" },
  { key: "CoApplicantName", label: "Co-Applicant Name" },
  { key: "CoApplicantMobile", label: "Co-Applicant Mobile" },
  { key: "CoApplicantPanNo", label: "Co-Applicant PAN" },
  { key: "CoApplicantRelation", label: "Co-Applicant Relation" },
];
const FIELD_KEYS = FIELDS.map((f) => f.key);

// Columns eligible for update / fill-in for an existing customer
const FILLABLE = {
  CustomerName: "CustomerName",
  Mobile: "Mobile",
  AltMobile: "AltMobile",
  Email: "Email",
  PanNo: "PanNo",
  GstNo: "GstNo", gstin: "GstNo", gst: "GstNo", gstno: "GstNo", gstnumber: "GstNo",
  AadhaarNo: "AadhaarNo",
  DateOfBirth: "DateOfBirth",
  Occupation: "Occupation",
  AnnualIncome: "AnnualIncome",
  PermanentAddress: "Address",
  PermanentCity: "City",
  PermanentState: "State",
  PermanentPincode: "Pincode",
  CurrentAddress: "CurrentAddress",
  CurrentCity: "CurrentCity",
  CurrentState: "CurrentState",
  CurrentPincode: "CurrentPincode",
  InvoiceMode: "InvoiceMode",
  Notes: "Notes",
  CoApplicantName: "CoApplicantName",
  CoApplicantMobile: "CoApplicantMobile",
  CoApplicantPanNo: "CoApplicantPanNo",
  CoApplicantRelation: "CoApplicantRelation",
};

// ── Cleaning & Sanitization ──────────────────────────────────────────────────

const str = (v) => (v == null ? "" : String(v)).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

/** "9.83E+09" / "9830012345.0" — handling numbers from Excel exports. */
function expandNumber(s) {
  if (!s) return "";
  let val = String(s).trim();
  // Strip trailing .0 / .00 from floating point exports
  val = val.replace(/^(\d+)\.0+$/, "$1");
  // Expand standard scientific notation if digits are intact (e.g., 9.830012345E+09)
  const sciMatch = val.match(/^(\d+)(?:\.(\d+))?[eE]\+(\d+)$/);
  if (sciMatch) {
    const intPart = sciMatch[1];
    const fracPart = sciMatch[2] || "";
    const exp = parseInt(sciMatch[3], 10);
    const combined = intPart + fracPart;
    // Only when every digit survived (9.830012345E+09). Fewer digits means
    // Excel rounded the number — padding with zeros would save a WRONG
    // number, so it is left as it is and fails the format check.
    if (intPart.length === 1 && combined.length === exp + 1) val = combined;
  }
  return val;
}

// The customer form's phone rule (validation/phone.js): an Indian mobile as 10 digits, a number
// from outside India as "+<country code><number>". A value it can't read is returned as typed,
// so phoneOk() reports it.
function cleanMobile(raw) {
  const s = expandNumber(str(raw));
  if (!s) return "";
  const r = normalizePhone(s);
  return r.error ? s.replace(/[\s\-().]/g, "") : r.value;
}
const phoneOk = (v) => !normalizePhone(v).error;

const cleanDigits = (raw) => expandNumber(str(raw)).replace(/[\s\-]/g, "");
const cleanPan = (raw) => str(raw).replace(/\s/g, "").toUpperCase();
const cleanEmail = (raw) => str(raw).toLowerCase().trim();

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function validDate(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? `${y}-${pad(m)}-${pad(d)}`
    : null;
}

/** Parses dates: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD-Mon-YYYY, or Excel date serial. */
function cleanDate(raw) {
  const s = str(raw);
  if (!s) return { value: "" };
  let m = s.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
  if (m) return { value: validDate(+m[1], +m[2], +m[3]) };
  m = s.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y > 30 ? 1900 : 2000;
    return { value: validDate(y, +m[2], +m[1]) };
  }
  m = s.match(/^(\d{1,2})[\s\-/.]([A-Za-z]{3,9})[\s\-/,.]*(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    let y = +m[3];
    if (y < 100) y += y > 30 ? 1900 : 2000;
    return { value: validDate(y, MONTHS[m[2].toLowerCase()], +m[1]) };
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 1000 && serial < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return { value: validDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) };
    }
  }
  return { value: null };
}

/** Parses amounts: "₹ 12,00,000", "1200000.00", "12 lakh", "1.5 cr". */
function cleanAmount(raw) {
  let s = str(raw).toLowerCase().replace(/₹|rs\.?|inr|\/-/g, "").replace(/,/g, "").trim();
  if (!s) return { value: null };
  let mult = 1;
  if (/(lakh|lac|lakhs|lacs)$/.test(s)) { mult = 100000; s = s.replace(/(lakhs?|lacs?)$/, "").trim(); }
  else if (/(crore|cr|crores)$/.test(s)) { mult = 10000000; s = s.replace(/(crores?|cr)$/, "").trim(); }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? { value: Math.round(n * mult * 100) / 100 } : { value: undefined };
}

function cleanInvoiceMode(raw) {
  const s = str(raw).toLowerCase().replace(/[^a-z]/g, "");
  // Blank = not given: a new customer gets the default (NonInvoice) at
  // insert; an existing customer's mode is never changed by an empty cell.
  if (!s) return { value: "" };
  if (["invoice", "invoiced", "yes", "y", "gst", "withinvoice", "regular"].includes(s)) return { value: "Invoice" };
  if (["noninvoice", "noninvoiced", "no", "n", "withoutinvoice", "none"].includes(s)) return { value: "NonInvoice" };
  return { value: null };
}

/** Cleans and validates one row. Returns { data, errors[], warnings[] }. */
function cleanRow(cells) {
  const c = {};
  for (const k of FIELD_KEYS) c[k] = str(cells?.[k]);
  const errors = [];
  const warnings = [];
  const d = {};

  // Composite Name support (e.g. First Name + Last Name)
  let rawName = c.CustomerName;
  if (!rawName && (cells?.FirstName || cells?.LastName)) {
    rawName = [str(cells.FirstName), str(cells.LastName)].filter(Boolean).join(" ");
  }
  d.CustomerName = rawName;
  if (!d.CustomerName) {
    errors.push("Customer Name is missing");
  } else if (d.CustomerName.length > 200) {
    errors.push("Customer Name exceeds maximum 200 characters");
  }

  if (c.CustomerNo) {
    d.CustomerNo = c.CustomerNo.toUpperCase().trim();
    if (d.CustomerNo.length > 30) errors.push("Customer No exceeds 30 characters");
  } else {
    d.CustomerNo = "";
  }

  // Multi-phone in a single cell handling (e.g., "9830012345 / 9830099999" or "9830012345, 9830099999")
  let rawMob = c.Mobile;
  let rawAlt = c.AltMobile;
  if (rawMob && /[/,&]|(?:\bor\b)/i.test(rawMob)) {
    const parts = rawMob.split(/[/,&]|(?:\bor\b)/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      rawMob = parts[0];
      if (!rawAlt) rawAlt = parts[1];
      warnings.push(`Split multiple phone numbers from single cell: "${parts[0]}" and "${parts[1]}"`);
    }
  }

  d.Mobile = cleanMobile(rawMob);
  if (d.Mobile) {
    if (/e\+/i.test(d.Mobile)) {
      errors.push(`Mobile "${c.Mobile}" was truncated by Excel's scientific notation — format column as Text and re-enter`);
    } else if (!phoneOk(d.Mobile)) {
      errors.push(`Mobile "${c.Mobile}" is not a valid number — a 10-digit Indian mobile, or one with its country code (e.g. +971 50 123 4567)`);
    }
  }

  d.AltMobile = cleanMobile(rawAlt);
  if (d.AltMobile && !phoneOk(d.AltMobile)) {
    errors.push(`Alternate Mobile "${c.AltMobile}" is not a valid number`);
  }
  if (d.AltMobile && d.AltMobile === d.Mobile) {
    warnings.push("Alternate Mobile is identical to Mobile — omitted duplicate");
    d.AltMobile = "";
  }

  d.Email = cleanEmail(c.Email);
  if (d.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.Email)) {
    errors.push(`Email "${c.Email}" is not in valid format`);
  }

  d.PanNo = cleanPan(c.PanNo);
  if (d.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.PanNo)) {
    errors.push(`PAN "${c.PanNo}" is not in standard AAAAA9999A format`);
  }

  d.AadhaarNo = cleanDigits(c.AadhaarNo);
  if (d.AadhaarNo && !/^\d{12}$/.test(d.AadhaarNo)) {
    errors.push(`Aadhaar "${c.AadhaarNo}" must be exactly 12 digits`);
  }

  // Co-Applicant fields
  d.CoApplicantName = c.CoApplicantName || "";
  d.CoApplicantMobile = cleanMobile(c.CoApplicantMobile);
  if (d.CoApplicantMobile && !phoneOk(d.CoApplicantMobile)) {
    errors.push(`Co-Applicant Mobile "${c.CoApplicantMobile}" is not a valid number`);
  }
  {
    const g = require("./gstin").checkGstin(c.GstNo, { pan: d.PanNo });
    if (g.error) errors.push(g.error);
    else d.GstNo = g.value;
  }
  d.CoApplicantPanNo = cleanPan(c.CoApplicantPanNo);
  if (d.CoApplicantPanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.CoApplicantPanNo)) {
    errors.push(`Co-Applicant PAN "${c.CoApplicantPanNo}" is not in standard format`);
  }
  d.CoApplicantRelation = c.CoApplicantRelation || "";

  // Composite Address support
  let permAddr = c.PermanentAddress;
  if (!permAddr && (cells?.AddressLine1 || cells?.AddressLine2)) {
    permAddr = [str(cells.AddressLine1), str(cells.AddressLine2)].filter(Boolean).join(", ");
  }
  d.PermanentAddress = permAddr;

  for (const k of ["PermanentPincode", "CurrentPincode"]) {
    d[k] = cleanDigits(c[k]);
    if (d[k] && !/^\d{6}$/.test(d[k])) {
      errors.push(`${k === "PermanentPincode" ? "Permanent" : "Current"} Pincode "${c[k]}" is not 6 digits`);
    }
  }

  const dob = cleanDate(c.DateOfBirth);
  d.DateOfBirth = dob.value || "";
  if (dob.value === null) {
    errors.push(`Date of Birth "${c.DateOfBirth}" is not a recognizable date (use DD/MM/YYYY)`);
  } else if (d.DateOfBirth && (d.DateOfBirth > new Date().toISOString().slice(0, 10) || d.DateOfBirth < "1900-01-01")) {
    errors.push(`Date of Birth ${d.DateOfBirth} is out of realistic range (1900 to present)`);
  }

  const inc = cleanAmount(c.AnnualIncome);
  d.AnnualIncome = inc.value ?? "";
  if (inc.value === undefined) {
    errors.push(`Annual Income "${c.AnnualIncome}" is not a valid amount`);
  }

  const inv = cleanInvoiceMode(c.InvoiceMode);
  d.InvoiceMode = inv.value || "";
  if (inv.value === null) {
    errors.push(`Invoice Mode "${c.InvoiceMode}" must be "Invoice" or "Non-Invoice"`);
  }

  for (const k of ["Occupation", "PermanentAddress", "PermanentCity", "PermanentState", "CurrentAddress", "CurrentCity", "CurrentState", "Notes"]) {
    d[k] = c[k];
  }

  // Current address: blank means "same as permanent"
  d.IsCurrentSameAsPermanent = !(d.CurrentAddress || d.CurrentCity || d.CurrentState || d.CurrentPincode);

  if (!d.Mobile && !d.PanNo && !d.Email && !d.AadhaarNo && !d.CustomerNo) {
    warnings.push("No mobile, PAN, email, Aadhaar, or Customer No provided — this record cannot be uniquely verified or deduplicated");
  }

  return { data: d, errors, warnings };
}

// ── Deep Lookup & Existing Record Matching ───────────────────────────────────

async function findExisting(pool, rows) {
  const vals = (extractor) => [...new Set(rows.map(extractor).filter(Boolean))];

  const mobiles = vals((r) => r.data.Mobile);
  const altMobiles = vals((r) => r.data.AltMobile);
  const allPhones = [...new Set([...mobiles, ...altMobiles])];

  const pans = vals((r) => r.data.PanNo);
  const emails = vals((r) => r.data.Email);
  const aadhaars = vals((r) => r.data.AadhaarNo);
  const customerNos = vals((r) => r.data.CustomerNo);

  const byMobile = new Map();
  const byAltMobile = new Map();
  const byPan = new Map();
  const byEmail = new Map();
  const byAadhaar = new Map();
  const byCustomerNo = new Map();

  // Load matching customers in parameterized chunks of 500
  const loadChunk = async (list, whereClause, type, onRow) => {
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const req = pool.request();
      chunk.forEach((v, j) => req.input(`p${j}`, type, v));
      const paramList = chunk.map((_, j) => `@p${j}`).join(",");
      const query = `
        SELECT
          Id, CustomerNo, CustomerName, Mobile, AltMobile, Email, PanNo, AadhaarNo,
          Occupation, AnnualIncome, Address, City, State, Pincode,
          CurrentAddress, CurrentCity, CurrentState, CurrentPincode, IsCurrentSameAsPermanent,
          DateOfBirth, InvoiceMode, Notes
        FROM dbo.CrmCustomer
        WHERE IsActive = 1 AND (${whereClause.replace(/:params/g, paramList)})
      `;
      const res = await req.query(query);
      for (const row of res.recordset) {
        onRow(row);
      }
    }
  };

  // 1. Phone match: checks both Mobile and AltMobile on the database side
  if (allPhones.length) {
    await loadChunk(
      allPhones,
      "LTRIM(RTRIM(Mobile)) IN (:params) OR LTRIM(RTRIM(AltMobile)) IN (:params)",
      sql.NVarChar(20),
      (row) => {
        const mob = String(row.Mobile || "").trim();
        const alt = String(row.AltMobile || "").trim();
        if (mob) byMobile.set(mob, row);
        if (alt) byAltMobile.set(alt, row);
      }
    );
  }

  // 2. PAN match
  if (pans.length) {
    await loadChunk(
      pans,
      "UPPER(LTRIM(RTRIM(PanNo))) IN (:params)",
      sql.NVarChar(20),
      (row) => {
        const p = String(row.PanNo || "").trim().toUpperCase();
        if (p) byPan.set(p, row);
      }
    );
  }

  // 3. Email match
  if (emails.length) {
    await loadChunk(
      emails,
      "LOWER(LTRIM(RTRIM(Email))) IN (:params)",
      sql.NVarChar(200),
      (row) => {
        const e = String(row.Email || "").trim().toLowerCase();
        if (e) byEmail.set(e, row);
      }
    );
  }

  // 4. Aadhaar match
  if (aadhaars.length) {
    await loadChunk(
      aadhaars,
      "REPLACE(AadhaarNo, ' ', '') IN (:params)",
      sql.NVarChar(20),
      (row) => {
        const a = String(row.AadhaarNo || "").replace(/\s/g, "");
        if (a) byAadhaar.set(a, row);
      }
    );
  }

  // 5. CustomerNo match (for re-importing/bulk updating)
  if (customerNos.length) {
    await loadChunk(
      customerNos,
      "UPPER(LTRIM(RTRIM(CustomerNo))) IN (:params)",
      sql.NVarChar(30),
      (row) => {
        const cno = String(row.CustomerNo || "").trim().toUpperCase();
        if (cno) byCustomerNo.set(cno, row);
      }
    );
  }

  // 6. SaLead match (Check if customer matches an existing CRM Lead)
  const byLeadPhone = new Map();
  if (allPhones.length) {
    for (let i = 0; i < allPhones.length; i += 500) {
      const chunk = allPhones.slice(i, i + 500);
      const req = pool.request();
      chunk.forEach((v, j) => req.input(`lp${j}`, sql.NVarChar(20), v));
      const paramList = chunk.map((_, j) => `@lp${j}`).join(",");
      const lQuery = `
        SELECT Id, LeadUid, CustomerName, Mobile, Email, Status, Classification
        FROM dbo.SaLead
        WHERE IsActive = 1 AND (LTRIM(RTRIM(Mobile)) IN (${paramList}) OR LTRIM(RTRIM(AltMobile)) IN (${paramList}))
      `;
      try {
        const lRes = await req.query(lQuery);
        for (const l of lRes.recordset) {
          const lMob = String(l.Mobile || "").trim();
          if (lMob && !byLeadPhone.has(lMob)) byLeadPhone.set(lMob, l);
        }
      } catch {
        // SaLead table might be absent or inaccessible; non-fatal
      }
    }
  }

  return { byMobile, byAltMobile, byPan, byEmail, byAadhaar, byCustomerNo, byLeadPhone };
}

/**
 * Analyzes input rows and determines status:
 * "new", "existing", "duplicate" (repeats earlier row in same file), or "error".
 */
async function analyze(pool, inputRows) {
  if (!Array.isArray(inputRows) || !inputRows.length) {
    const e = new Error("The file has no customer rows.");
    e.status = 400;
    throw e;
  }
  if (inputRows.length > MAX_ROWS) {
    const e = new Error(`At most ${MAX_ROWS} customers allowed per import batch — please split the file.`);
    e.status = 400;
    throw e;
  }

  const rows = inputRows.map((r, i) => ({
    rowNo: Number(r?.rowNo) || i + 2,
    ...cleanRow(r?.cells || r),
  }));

  const ex = await findExisting(pool, rows);

  // In-file duplicate tracker
  const seen = {
    CustomerNo: new Map(),
    Mobile: new Map(),
    PanNo: new Map(),
    Email: new Map(),
    AadhaarNo: new Map(),
  };

  const label = {
    CustomerNo: "Customer No",
    Mobile: "Mobile",
    PanNo: "PAN",
    Email: "Email",
    AadhaarNo: "Aadhaar",
  };

  for (const r of rows) {
    if (r.errors.length) {
      r.status = "error";
      continue;
    }

    // Check duplicate within the same import file
    const dupKey = ["CustomerNo", "Mobile", "PanNo", "Email", "AadhaarNo"].find(
      (k) => r.data[k] && seen[k].has(r.data[k])
    );
    if (dupKey) {
      r.status = "duplicate";
      r.duplicateOf = seen[dupKey].get(r.data[dupKey]);
      r.reason = `Repeats same ${label[dupKey]} (${r.data[dupKey]}) as row ${r.duplicateOf}`;
      continue;
    }

    // Register identifiers seen in file
    for (const k of Object.keys(seen)) {
      if (r.data[k]) seen[k].set(r.data[k], r.rowNo);
    }

    // Check match against database
    const hits = [
      ["Customer No", r.data.CustomerNo && ex.byCustomerNo.get(r.data.CustomerNo)],
      ["Mobile", r.data.Mobile && ex.byMobile.get(r.data.Mobile)],
      ["Mobile (matched as Alt)", r.data.Mobile && ex.byAltMobile.get(r.data.Mobile)],
      ["Alt Mobile", r.data.AltMobile && (ex.byMobile.get(r.data.AltMobile) || ex.byAltMobile.get(r.data.AltMobile))],
      ["PAN", r.data.PanNo && ex.byPan.get(r.data.PanNo)],
      ["Email", r.data.Email && ex.byEmail.get(r.data.Email)],
      ["Aadhaar", r.data.AadhaarNo && ex.byAadhaar.get(r.data.AadhaarNo)],
    ].filter(([, c]) => !!c);

    if (hits.length) {
      const ids = [...new Set(hits.map(([, c]) => c.Id))];
      // Conflict: File row matches multiple DIFFERENT customers in the database
      if (ids.length > 1) {
        r.status = "error";
        r.errors.push(
          `Conflict: Details match multiple different customers: ${hits
            .map(([w, c]) => `${w} matches ${c.CustomerNo} (${c.CustomerName})`)
            .join("; ")}`
        );
        continue;
      }

      const matchedCust = hits[0][1];
      r.status = "existing";
      r.match = {
        id: matchedCust.Id,
        customerNo: matchedCust.CustomerNo,
        name: matchedCust.CustomerName,
        by: [...new Set(hits.map(([w]) => w))],
        current: {
          CustomerName: matchedCust.CustomerName,
          Mobile: matchedCust.Mobile,
          AltMobile: matchedCust.AltMobile,
          Email: matchedCust.Email,
          PanNo: matchedCust.PanNo,
          AadhaarNo: matchedCust.AadhaarNo,
          City: matchedCust.City,
        },
      };
      continue;
    }

    // Check Lead match
    if (r.data.Mobile && ex.byLeadPhone.has(r.data.Mobile)) {
      const l = ex.byLeadPhone.get(r.data.Mobile);
      r.leadMatch = {
        id: l.Id,
        leadUid: l.LeadUid,
        status: l.Status,
        classification: l.Classification,
      };
    }

    r.status = "new";
  }

  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    rows,
    summary: {
      total: rows.length,
      new: count("new"),
      existing: count("existing"),
      duplicate: count("duplicate"),
      error: count("error"),
      warnings: rows.filter((r) => r.warnings.length > 0).length,
    },
  };
}

// ── Database Insertion & Updating ────────────────────────────────────────────

/** Creates one new customer record. */
async function insertCrmCustomer(pool, b, actorUserId) {
  const same = b.IsCurrentSameAsPermanent !== false;
  // Always from the CUST series — a Customer No in a file is only used to
  // find an existing customer, never to number a new one.
  const customerNo = await getNextDocNumber(pool, "CUST", "CUST");
  const nz = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : v);

  const r = await pool
    .request()
    .input("no", sql.NVarChar(30), customerNo)
    .input("lid", sql.Int, b.LeadId ? parseInt(b.LeadId, 10) : null)
    .input("name", sql.NVarChar(200), String(b.CustomerName || "").trim() || null)
    .input("mob", sql.NVarChar(20), nz(b.Mobile && String(b.Mobile).trim()))
    .input("altmob", sql.NVarChar(20), nz(b.AltMobile))
    .input("email", sql.NVarChar(200), nz(b.Email && String(b.Email).trim().toLowerCase()))
    .input("pan", sql.NVarChar(20), nz(b.PanNo && String(b.PanNo).trim()))
    .input("aadhaar", sql.NVarChar(20), nz(b.AadhaarNo))
    .input("occ", sql.NVarChar(100), nz(b.Occupation))
    .input("income", sql.Decimal(18, 2), b.AnnualIncome !== "" && b.AnnualIncome != null ? parseFloat(b.AnnualIncome) : null)
    .input("addr", sql.NVarChar(500), nz(b.PermanentAddress && String(b.PermanentAddress).trim()))
    .input("city", sql.NVarChar(100), nz(b.PermanentCity))
    .input("state", sql.NVarChar(100), nz(b.PermanentState))
    .input("pin", sql.NVarChar(10), nz(b.PermanentPincode))
    .input("curaddr", sql.NVarChar(500), same ? nz(b.PermanentAddress && String(b.PermanentAddress).trim()) : nz(b.CurrentAddress && String(b.CurrentAddress).trim()))
    .input("curcity", sql.NVarChar(100), same ? nz(b.PermanentCity) : nz(b.CurrentCity))
    .input("curstate", sql.NVarChar(100), same ? nz(b.PermanentState) : nz(b.CurrentState))
    .input("curpin", sql.NVarChar(10), same ? nz(b.PermanentPincode) : nz(b.CurrentPincode))
    .input("cursame", sql.Bit, same ? 1 : 0)
    .input("dob", sql.Date, nz(b.DateOfBirth))
    .input("invmode", sql.NVarChar(20), b.InvoiceMode === "Invoice" ? "Invoice" : "NonInvoice")
    .input("notes", sql.NVarChar(sql.MAX), nz(b.Notes))
    .input("coName", sql.NVarChar(200), nz(b.CoApplicantName))
    .input("coMob", sql.NVarChar(20), nz(b.CoApplicantMobile))
    .input("coPan", sql.NVarChar(20), nz(b.CoApplicantPanNo))
    .input("coRel", sql.NVarChar(50), nz(b.CoApplicantRelation))
    .input("gst", sql.NVarChar(15), nz(b.GstNo))
    .input("cb", sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmCustomer
        (CustomerNo, LeadId, CustomerName, Mobile, AltMobile, Email, PanNo, AadhaarNo, Occupation, AnnualIncome,
         Address, City, State, Pincode,
         CurrentAddress, CurrentCity, CurrentState, CurrentPincode, IsCurrentSameAsPermanent,
         DateOfBirth, InvoiceMode, Notes,
         CoApplicantName, CoApplicantMobile, CoApplicantPanNo, CoApplicantRelation, GstNo,
         CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@no, @lid, @name, @mob, @altmob, @email, @pan, @aadhaar, @occ, @income,
              @addr, @city, @state, @pin,
              @curaddr, @curcity, @curstate, @curpin, @cursame,
              @dob, @invmode, @notes,
              @coName, @coMob, @coPan, @coRel, @gst,
              @cb, SYSDATETIME())
    `);
  return { id: r.recordset[0].Id, customerNo };
}

/** Fills only the blank / unpopulated fields on an existing customer. */
async function fillBlanks(pool, customerId, d, actorUserId) {
  const cur = (
    await pool
      .request()
      .input("id", sql.Int, customerId)
      .query(`SELECT ${Object.values(FILLABLE).join(", ")}, IsCurrentSameAsPermanent FROM dbo.CrmCustomer WHERE Id = @id`)
  ).recordset[0];
  if (!cur) return [];

  const sets = [];
  const filled = [];
  const req = pool.request().input("id", sql.Int, customerId);
  const sameAsPermanent = d.IsCurrentSameAsPermanent !== false;

  for (const [field, col] of Object.entries(FILLABLE)) {
    if (field === "CustomerName" || field === "CustomerNo") continue; // Keep canonical identity name
    // No current address in the file: the customer's own is left alone.
    if (sameAsPermanent && field.startsWith("Current")) continue;
    const v = d[field];
    if (v === "" || v == null) continue;
    if (cur[col] !== null && cur[col] !== undefined && String(cur[col]).trim() !== "") continue;

    const type = col === "DateOfBirth" ? sql.Date : col === "AnnualIncome" ? sql.Decimal(18, 2) : sql.NVarChar(500);
    req.input(`v_${col}`, type, col === "AnnualIncome" ? Number(v) : v);
    sets.push(`${col} = @v_${col}`);
    filled.push(FIELDS.find((f) => f.key === field)?.label || field);
  }


  if (!sets.length) return [];

  if (actorUserId) {
    req.input("ub", sql.Int, actorUserId);
    sets.push("UpdatedBy = @ub", "UpdatedAt = SYSDATETIME()");
  }

  await req.query(`UPDATE dbo.CrmCustomer SET ${sets.join(", ")} WHERE Id = @id`);
  return filled;
}

/** Updates existing customer record with all non-empty mapped values from file. */
// Never overwritten for a customer who has an application: their agreements
// and documents carry these, and Invoice Mode decides how live bookings are
// invoiced. Those go through the customer's own edit.
const IDENTITY = new Set(["CustomerName", "Mobile", "PanNo", "AadhaarNo", "Email", "InvoiceMode"]);
async function updateCustomer(pool, customerId, d, actorUserId) {
  const sets = [];
  const updated = [];
  const hasApplication = (await pool.request().input("cid", sql.Int, customerId)
    .query("SELECT TOP 1 1 AS x FROM dbo.CrmApplication WHERE CustomerId = @cid AND IsActive = 1")).recordset.length > 0;
  const req = pool.request().input("id", sql.Int, customerId);
  const sameAsPermanent = d.IsCurrentSameAsPermanent !== false;

  for (const [field, col] of Object.entries(FILLABLE)) {
    if (field === "CustomerNo") continue; // CustomerNo is immutable
    if (hasApplication && IDENTITY.has(field)) continue; // see IDENTITY above
    if (field === "Notes") continue; // appended below, never replaced
    if (sameAsPermanent && field.startsWith("Current")) continue; // no current address given — left alone
    const v = d[field];
    if (v === "" || v == null) continue;

    const type =
      col === "DateOfBirth"
        ? sql.Date
        : col === "AnnualIncome"
        ? sql.Decimal(18, 2)
        : col === "Notes"
        ? sql.NVarChar(sql.MAX)
        : sql.NVarChar(500);

    req.input(`u_${col}`, type, col === "AnnualIncome" ? Number(v) : v);
    sets.push(`${col} = @u_${col}`);
    updated.push(FIELDS.find((f) => f.key === field)?.label || field);
  }

  if (d.Notes) {
    req.input("u_Notes", sql.NVarChar(sql.MAX), d.Notes);
    sets.push("Notes = CASE WHEN ISNULL(Notes, '') = '' THEN @u_Notes ELSE Notes + CHAR(10) + @u_Notes END");
    updated.push("Notes (added)");
  }

  if (!sets.length) return [];
  if (!sameAsPermanent) sets.push("IsCurrentSameAsPermanent = 0"); // a separate current address was given

  if (actorUserId) {
    req.input("ub", sql.Int, actorUserId);
    sets.push("UpdatedBy = @ub", "UpdatedAt = SYSDATETIME()");
  }

  await req.query(`UPDATE dbo.CrmCustomer SET ${sets.join(", ")} WHERE Id = @id`);

  return updated;
}

// ── Batch Application ────────────────────────────────────────────────────────

/**
 * Re-validates and applies the import to the database.
 * Options:
 *   existing: "skip" (default) | "fill" | "update"
 *   fileName: original file name
 *   sourceTag: custom source or campaign note
 *   excludedRowNos: rows unselected by user
 *   actorUserId, actorName: auditing metadata
 */
async function apply(
  pool,
  inputRows,
  { existing = "skip", fileName = "", sourceTag = "", excludedRowNos = [], actorUserId = null, actorName = "" } = {}
) {
  const { rows, summary } = await analyze(pool, inputRows);
  const { ensureCrmCustomerLedgerHead } = require("./crmLedger");

  const excludedSet = new Set(Array.isArray(excludedRowNos) ? excludedRowNos : []);

  const dateStr = new Date().toISOString().slice(0, 10);
  const stampParts = [
    `Bulk Import on ${dateStr}`,
    fileName ? `File: ${String(fileName).slice(0, 80)}` : "",
    sourceTag ? `Source: ${String(sourceTag).slice(0, 80)}` : "",
  ].filter(Boolean);
  const auditStamp = `[${stampParts.join(" | ")}]`;

  const results = [];

  for (const r of rows) {
    const out = { rowNo: r.rowNo, name: r.data.CustomerName };

    // Check if row was excluded by user
    if (excludedSet.has(r.rowNo)) {
      results.push({ ...out, result: "skipped", reason: "Excluded from import by user" });
      continue;
    }

    try {
      if (r.status === "error") {
        Object.assign(out, { result: "failed", reason: r.errors.join("; ") });
      } else if (r.status === "duplicate") {
        Object.assign(out, { result: "skipped", reason: r.reason });
      } else if (r.status === "existing") {
        if (existing === "fill") {
          const filled = await fillBlanks(pool, r.match.id, r.data, actorUserId);
          Object.assign(
            out,
            filled.length
              ? { result: "updated", customerNo: r.match.customerNo, reason: `Filled blank details: ${filled.join(", ")}` }
              : { result: "skipped", customerNo: r.match.customerNo, reason: `Already a customer (${r.match.customerNo}) — no blank fields to fill` }
          );
        } else if (existing === "update") {
          const updated = await updateCustomer(pool, r.match.id, r.data, actorUserId);
          Object.assign(
            out,
            updated.length
              ? { result: "updated", customerNo: r.match.customerNo, reason: `Updated: ${updated.join(", ")}` }
              : { result: "skipped", customerNo: r.match.customerNo, reason: `Already a customer (${r.match.customerNo}) — no new values` }
          );
        } else {
          // Default: skip
          Object.assign(out, {
            result: "skipped",
            customerNo: r.match.customerNo,
            reason: `Already a customer (${r.match.customerNo}, matched by ${r.match.by.join(", ")})`,
          });
        }
      } else {
        // Brand new customer
        const notes = [r.data.Notes, auditStamp].filter(Boolean).join("\n");
        const payload = { ...r.data, Notes: notes };

        // Auto-link converted lead if matched and not already linked
        if (r.leadMatch && r.leadMatch.status === "Converted") {
          const taken = (await pool.request().input("lid", sql.Int, r.leadMatch.id)
            .query("SELECT TOP 1 1 AS x FROM dbo.CrmCustomer WHERE LeadId = @lid AND IsActive = 1")).recordset.length;
          if (!taken) payload.LeadId = r.leadMatch.id;
        }

        const created = await insertCrmCustomer(pool, payload, actorUserId);
        try {
          await ensureCrmCustomerLedgerHead(pool, created.id, actorName || "import");
        } catch {
          // Ledger head will be created automatically upon first transaction posting
        }
        Object.assign(out, { result: "created", customerNo: created.customerNo });
      }
    } catch (e) {
      const isUniqueError = /UNIQUE|duplicate key/i.test(e.message);
      Object.assign(out, {
        result: "failed",
        reason: isUniqueError
          ? "A customer with this mobile or identifier already exists (concurrent insert)"
          : e.message,
      });
    }

    results.push(out);
  }

  const count = (s) => results.filter((x) => x.result === s).length;
  return {
    summary: {
      ...summary,
      created: count("created"),
      updated: count("updated"),
      skipped: count("skipped"),
      failed: count("failed"),
    },
    results,
  };
}

module.exports = {
  FIELDS,
  MAX_ROWS,
  cleanRow,
  analyze,
  apply,
  insertCrmCustomer,
};
