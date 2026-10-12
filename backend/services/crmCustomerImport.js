// Bulk customer import (CRM → Customers → Import).
//
// The browser reads the file (.xlsx / .csv, any source) and maps its columns
// to the fields below; the rows come here as plain strings. Everything that
// decides what is saved happens on the server, and `apply` never trusts a
// preview — it re-checks every row:
//   1. clean   — mobile (+91 / 0 prefix, spaces, Excel's 9.83E+09), PAN,
//                Aadhaar, email, pincode, dates, amounts ("₹ 12,00,000")
//   2. check   — the same rules as the customer form (name required; 10-digit
//                mobile; PAN AAAAA9999A; 12-digit Aadhaar; 6-digit pincode; email)
//   3. match   — an existing customer by mobile, then PAN, then email, then
//                Aadhaar (the identifiers a person is known by), and repeats
//                inside the file itself
// A new person is created exactly like a hand-keyed customer (insertCrmCustomer,
// shared with POST /api/crm/customers: CustomerNo, ledger head). An existing one
// is skipped, or — when asked — only their BLANK details are filled in; a value
// already on file is never overwritten.
const { sql } = require("../db");
const { getNextDocNumber } = require("./docNumber");

const MAX_ROWS = 2000;

/** Importable fields: key → label, and what it must look like. */
const FIELDS = [
  { key: "CustomerName", label: "Customer Name", required: true },
  { key: "Mobile", label: "Mobile" },
  { key: "AltMobile", label: "Alternate Mobile" },
  { key: "Email", label: "Email" },
  { key: "PanNo", label: "PAN" },
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
];
const FIELD_KEYS = FIELDS.map((f) => f.key);

// Columns filled in for an existing customer when "fill blanks" is chosen
// (form field → CrmCustomer column).
const FILLABLE = {
  AltMobile: "AltMobile", Email: "Email", PanNo: "PanNo", AadhaarNo: "AadhaarNo", DateOfBirth: "DateOfBirth",
  Occupation: "Occupation", AnnualIncome: "AnnualIncome", PermanentAddress: "Address", PermanentCity: "City",
  PermanentState: "State", PermanentPincode: "Pincode", CurrentAddress: "CurrentAddress", CurrentCity: "CurrentCity",
  CurrentState: "CurrentState", CurrentPincode: "CurrentPincode",
};

// ── cleaning ─────────────────────────────────────────────────────────────────
const str = (v) => (v == null ? "" : String(v)).replace(/ /g, " ").replace(/\s+/g, " ").trim();

/** "9.83E+09" / "9830012345.0" — how Excel shows a long number typed as one. */
// Scientific notation is left as it is (so it fails the format check): Excel
// has already rounded the digits away and guessing them would save a wrong number.
function expandNumber(s) {
  return s.replace(/^(\d+)\.0+$/, "$1");
}

function cleanMobile(raw) {
  let s = expandNumber(str(raw));
  if (!s) return "";
  s = s.replace(/[\s\-().]/g, "");
  if (s.startsWith("+91")) s = s.slice(3);
  else if (s.startsWith("0091")) s = s.slice(4);
  else if (/^91\d{10}$/.test(s)) s = s.slice(2);
  else if (/^0\d{10}$/.test(s)) s = s.slice(1);
  return s;
}
const cleanDigits = (raw) => expandNumber(str(raw)).replace(/[\s\-]/g, "");
const cleanPan = (raw) => str(raw).replace(/\s/g, "").toUpperCase();
const cleanEmail = (raw) => str(raw).toLowerCase();

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
/** YYYY-MM-DD, DD/MM/YYYY (also - .), DD-Mon-YYYY, or an Excel date serial. Indian order (day first). */
function cleanDate(raw) {
  const s = str(raw);
  if (!s) return { value: "" };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { value: validDate(+m[1], +m[2], +m[3]) };
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; return { value: validDate(y, +m[2], +m[1]) }; }
  m = s.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,9})[\s\-/,]*(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase().slice(0, 3)]) return { value: validDate(+m[3], MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]) };
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 1000 && serial < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return { value: validDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) };
    }
  }
  return { value: null };
}
/** "₹ 12,00,000", "1200000.00", "12 lakh" → 1200000. */
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
  if (!s) return { value: "NonInvoice" };
  if (["invoice", "invoiced", "yes", "y", "gst", "withinvoice"].includes(s)) return { value: "Invoice" };
  if (["noninvoice", "noninvoiced", "no", "n", "withoutinvoice", "none"].includes(s)) return { value: "NonInvoice" };
  return { value: null };
}

/** Cleans + checks one row. Returns { data, errors[], warnings[] }. */
function cleanRow(cells) {
  const c = {};
  for (const k of FIELD_KEYS) c[k] = str(cells?.[k]);
  const errors = [];
  const warnings = [];
  const d = {};
  d.CustomerName = c.CustomerName;
  if (!d.CustomerName) errors.push("Customer Name is missing");
  else if (d.CustomerName.length > 200) errors.push("Customer Name is longer than 200 characters");

  d.Mobile = cleanMobile(c.Mobile);
  if (d.Mobile && !/^\d{10}$/.test(d.Mobile)) {
    errors.push(/e\+/i.test(d.Mobile)
      ? `Mobile "${c.Mobile}" was shortened by Excel — format the column as Text and type the number again`
      : `Mobile "${c.Mobile}" is not a 10-digit number`);
  }
  d.AltMobile = cleanMobile(c.AltMobile);
  if (d.AltMobile && !/^\d{10}$/.test(d.AltMobile)) errors.push(`Alternate Mobile "${c.AltMobile}" is not a 10-digit number`);
  if (d.AltMobile && d.AltMobile === d.Mobile) { warnings.push("Alternate Mobile is the same as Mobile — left out"); d.AltMobile = ""; }

  d.Email = cleanEmail(c.Email);
  if (d.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.Email)) errors.push(`Email "${c.Email}" is not valid`);
  d.PanNo = cleanPan(c.PanNo);
  if (d.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.PanNo)) errors.push(`PAN "${c.PanNo}" is not in the AAAAA9999A format`);
  d.AadhaarNo = cleanDigits(c.AadhaarNo);
  if (d.AadhaarNo && !/^\d{12}$/.test(d.AadhaarNo)) errors.push(`Aadhaar "${c.AadhaarNo}" is not 12 digits`);
  for (const k of ["PermanentPincode", "CurrentPincode"]) {
    d[k] = cleanDigits(c[k]);
    if (d[k] && !/^\d{6}$/.test(d[k])) errors.push(`${k === "PermanentPincode" ? "Permanent" : "Current"} Pincode "${c[k]}" is not 6 digits`);
  }
  const dob = cleanDate(c.DateOfBirth);
  d.DateOfBirth = dob.value || "";
  if (dob.value === null) errors.push(`Date of Birth "${c.DateOfBirth}" isn't a date (use DD/MM/YYYY)`);
  else if (d.DateOfBirth && (d.DateOfBirth > new Date().toISOString().slice(0, 10) || d.DateOfBirth < "1900-01-01")) {
    errors.push(`Date of Birth ${d.DateOfBirth} is not a possible birth date`);
  }
  const inc = cleanAmount(c.AnnualIncome);
  d.AnnualIncome = inc.value ?? "";
  if (inc.value === undefined) errors.push(`Annual Income "${c.AnnualIncome}" isn't an amount`);
  const inv = cleanInvoiceMode(c.InvoiceMode);
  d.InvoiceMode = inv.value || "NonInvoice";
  if (inv.value === null) errors.push(`Invoice Mode "${c.InvoiceMode}" must be Invoice or Non-Invoice`);
  for (const k of ["Occupation", "PermanentAddress", "PermanentCity", "PermanentState", "CurrentAddress", "CurrentCity", "CurrentState", "Notes"]) d[k] = c[k];
  // Current address: blank means "same as permanent", as on the form.
  d.IsCurrentSameAsPermanent = !(d.CurrentAddress || d.CurrentCity || d.CurrentState || d.CurrentPincode);
  if (!d.Mobile && !d.PanNo && !d.Email && !d.AadhaarNo) {
    warnings.push("No mobile, PAN, email or Aadhaar — this person can't be matched later, so check they aren't already a customer");
  }
  return { data: d, errors, warnings };
}

// ── matching ─────────────────────────────────────────────────────────────────
async function findExisting(pool, rows) {
  const vals = (k) => [...new Set(rows.map((r) => r.data[k]).filter(Boolean))];
  const byMobile = new Map(), byPan = new Map(), byEmail = new Map(), byAadhaar = new Map();
  const load = async (list, where, type, map, key) => {
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const req = pool.request();
      chunk.forEach((v, j) => req.input(`p${j}`, type, v));
      const r = await req.query(`SELECT Id, CustomerNo, CustomerName, Mobile, Email, PanNo, AadhaarNo FROM dbo.CrmCustomer
        WHERE IsActive = 1 AND ${where} IN (${chunk.map((_, j) => `@p${j}`).join(",")})`);
      for (const row of r.recordset) map.set(String(key(row)), row);
    }
  };
  await load(vals("Mobile"), "LTRIM(RTRIM(Mobile))", sql.NVarChar(20), byMobile, (r) => String(r.Mobile || "").trim());
  await load(vals("PanNo"), "UPPER(LTRIM(RTRIM(PanNo)))", sql.NVarChar(20), byPan, (r) => String(r.PanNo || "").trim().toUpperCase());
  await load(vals("Email"), "LOWER(LTRIM(RTRIM(Email)))", sql.NVarChar(200), byEmail, (r) => String(r.Email || "").trim().toLowerCase());
  await load(vals("AadhaarNo"), "REPLACE(AadhaarNo, ' ', '')", sql.NVarChar(20), byAadhaar, (r) => String(r.AadhaarNo || "").replace(/\s/g, ""));
  return { byMobile, byPan, byEmail, byAadhaar };
}

/**
 * Checks every row. Status per row: "new", "existing" (+ match), "duplicate"
 * (repeats an earlier row of the file), or "error".
 */
async function analyze(pool, inputRows) {
  if (!Array.isArray(inputRows) || !inputRows.length) { const e = new Error("The file has no customer rows"); e.status = 400; throw e; }
  if (inputRows.length > MAX_ROWS) { const e = new Error(`At most ${MAX_ROWS} customers per import — split the file`); e.status = 400; throw e; }
  const rows = inputRows.map((r, i) => ({ rowNo: Number(r?.rowNo) || i + 2, ...cleanRow(r?.cells || r) }));
  const ex = await findExisting(pool, rows);
  const seen = { Mobile: new Map(), PanNo: new Map(), Email: new Map(), AadhaarNo: new Map() };
  const label = { Mobile: "mobile", PanNo: "PAN", Email: "email", AadhaarNo: "Aadhaar" };
  for (const r of rows) {
    if (r.errors.length) { r.status = "error"; continue; }
    // Same person as an earlier row of this file?
    const dupKey = ["Mobile", "PanNo", "Email", "AadhaarNo"].find((k) => r.data[k] && seen[k].has(r.data[k]));
    if (dupKey) { r.status = "duplicate"; r.duplicateOf = seen[dupKey].get(r.data[dupKey]); r.reason = `Same ${label[dupKey]} as row ${r.duplicateOf}`; continue; }
    for (const k of Object.keys(seen)) if (r.data[k]) seen[k].set(r.data[k], r.rowNo);
    // Already a customer?
    const hits = [
      ["mobile", r.data.Mobile && ex.byMobile.get(r.data.Mobile)],
      ["PAN", r.data.PanNo && ex.byPan.get(r.data.PanNo)],
      ["email", r.data.Email && ex.byEmail.get(r.data.Email)],
      ["Aadhaar", r.data.AadhaarNo && ex.byAadhaar.get(r.data.AadhaarNo)],
    ].filter(([, c]) => c);
    if (hits.length) {
      const ids = [...new Set(hits.map(([, c]) => c.Id))];
      if (ids.length > 1) {
        r.status = "error";
        r.errors.push(`Details belong to different customers: ${hits.map(([w, c]) => `${w} → ${c.CustomerNo} ${c.CustomerName}`).join("; ")}`);
        continue;
      }
      const c = hits[0][1];
      r.status = "existing";
      r.match = { id: c.Id, customerNo: c.CustomerNo, name: c.CustomerName, by: hits.map(([w]) => w) };
      continue;
    }
    r.status = "new";
  }
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { rows, summary: { total: rows.length, new: count("new"), existing: count("existing"), duplicate: count("duplicate"), error: count("error") } };
}

// ── saving ───────────────────────────────────────────────────────────────────
/** Creates one customer exactly as the customer form does. Shared with POST /api/crm/customers. */
async function insertCrmCustomer(pool, b, actorUserId) {
  const same = b.IsCurrentSameAsPermanent !== false;
  const customerNo = await getNextDocNumber(pool, "CUST", "CUST");
  const nz = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : v);
  const r = await pool.request()
    .input("no", sql.NVarChar(30), customerNo)
    .input("lid", sql.Int, b.LeadId !== undefined && b.LeadId !== null && b.LeadId !== "" ? parseInt(b.LeadId, 10) : null)
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
    .input("cb", sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmCustomer
        (CustomerNo, LeadId, CustomerName, Mobile, AltMobile, Email, PanNo, AadhaarNo, Occupation, AnnualIncome,
         Address, City, State, Pincode,
         CurrentAddress, CurrentCity, CurrentState, CurrentPincode, IsCurrentSameAsPermanent,
         DateOfBirth, InvoiceMode, Notes,
         CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@no, @lid, @name, @mob, @altmob, @email, @pan, @aadhaar, @occ, @income,
              @addr, @city, @state, @pin,
              @curaddr, @curcity, @curstate, @curpin, @cursame,
              @dob, @invmode, @notes, @cb, SYSDATETIME())`);
  return { id: r.recordset[0].Id, customerNo };
}

/** Fills only the blank details of an existing customer. Returns the field labels filled. */
async function fillBlanks(pool, customerId, d) {
  const cur = (await pool.request().input("id", sql.Int, customerId).query(
    `SELECT ${Object.values(FILLABLE).join(", ")} FROM dbo.CrmCustomer WHERE Id = @id`)).recordset[0];
  if (!cur) return [];
  const sets = [];
  const filled = [];
  const req = pool.request().input("id", sql.Int, customerId);
  for (const [field, col] of Object.entries(FILLABLE)) {
    const v = d[field];
    if (v === "" || v == null) continue;
    if (cur[col] !== null && cur[col] !== undefined && String(cur[col]).trim() !== "") continue;
    if (!d.IsCurrentSameAsPermanent || !field.startsWith("Current")) {
      const type = col === "DateOfBirth" ? sql.Date : col === "AnnualIncome" ? sql.Decimal(18, 2) : sql.NVarChar(500);
      req.input(`v_${col}`, type, col === "AnnualIncome" ? Number(v) : v);
      sets.push(`${col} = @v_${col}`);
      filled.push(FIELDS.find((f) => f.key === field)?.label || field);
    }
  }
  if (!sets.length) return [];
  await req.query(`UPDATE dbo.CrmCustomer SET ${sets.join(", ")} WHERE Id = @id`);
  return filled;
}

/**
 * Re-checks and saves. options.existing: "skip" (default) | "fill".
 * Each row stands alone — one bad row never stops the rest.
 */
async function apply(pool, inputRows, { existing = "skip", fileName = "", actorUserId = null, actorName = "" } = {}) {
  const { rows, summary } = await analyze(pool, inputRows);
  const { ensureCrmCustomerLedgerHead } = require("./crmLedger");
  const stamp = `Imported${fileName ? ` from ${String(fileName).slice(0, 80)}` : ""} on ${new Date().toISOString().slice(0, 10)}`;
  const results = [];
  for (const r of rows) {
    const out = { rowNo: r.rowNo, name: r.data.CustomerName };
    try {
      if (r.status === "error") { Object.assign(out, { result: "failed", reason: r.errors.join("; ") }); }
      else if (r.status === "duplicate") { Object.assign(out, { result: "skipped", reason: r.reason }); }
      else if (r.status === "existing") {
        if (existing === "fill") {
          const filled = await fillBlanks(pool, r.match.id, r.data);
          Object.assign(out, filled.length
            ? { result: "updated", customerNo: r.match.customerNo, reason: `Filled in: ${filled.join(", ")}` }
            : { result: "skipped", customerNo: r.match.customerNo, reason: "Already a customer — nothing blank to fill" });
        } else {
          Object.assign(out, { result: "skipped", customerNo: r.match.customerNo, reason: `Already a customer (${r.match.customerNo}, matched by ${r.match.by.join(", ")})` });
        }
      } else {
        const notes = [r.data.Notes, stamp].filter(Boolean).join("\n");
        const created = await insertCrmCustomer(pool, { ...r.data, Notes: notes }, actorUserId);
        try { await ensureCrmCustomerLedgerHead(pool, created.id, actorName || "import"); } catch { /* ledger head is created again at first posting */ }
        Object.assign(out, { result: "created", customerNo: created.customerNo });
      }
    } catch (e) {
      // e.g. someone created the same mobile a moment ago (unique index)
      Object.assign(out, { result: "failed", reason: /UNIQUE|duplicate key/i.test(e.message) ? "Already a customer (added while importing)" : e.message });
    }
    results.push(out);
  }
  const count = (s) => results.filter((x) => x.result === s).length;
  return { summary: { ...summary, created: count("created"), updated: count("updated"), skipped: count("skipped"), failed: count("failed") }, results };
}

module.exports = { FIELDS, MAX_ROWS, cleanRow, analyze, apply, insertCrmCustomer };
