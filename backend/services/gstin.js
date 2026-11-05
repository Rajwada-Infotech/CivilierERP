// GSTIN — a GST registration number, 15 characters:
//   2  state code (01-38, 97 other territory, 99 centre jurisdiction)
//   10 the holder's PAN
//   1  entity number for that PAN in the state (1-9, A-Z)
//   1  'Z' by default
//   1  check character (base-36, weights 1/2 alternating, as the GST network computes it)
// Used wherever a buyer's GSTIN is entered (customer form, bulk import).

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z][0-9A-Z]$/;

const normalize = (v) => String(v ?? "").replace(/\s+/g, "").toUpperCase();

function checkChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = CHARS.indexOf(first14[i]);
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/**
 * Checks a GSTIN. Returns { value } (normalized, or null when blank) or
 * { error } in plain words. `pan`, when known, must be the one inside it.
 */
function checkGstin(raw, { pan = null } = {}) {
  const v = normalize(raw);
  if (!v) return { value: null };
  if (v.length !== 15) return { error: `GSTIN "${v}" must be 15 characters (it has ${v.length})` };
  if (!SHAPE.test(v)) return { error: `GSTIN "${v}" isn't in the GSTIN format (state code, PAN, entity, Z, check character)` };
  const state = Number(v.slice(0, 2));
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return { error: `GSTIN "${v}" starts with ${v.slice(0, 2)}, which isn't a state code` };
  if (checkChar(v.slice(0, 14)) !== v[14]) return { error: `GSTIN "${v}" fails its check character — a character is mistyped` };
  const p = normalize(pan);
  if (p && v.slice(2, 12) !== p) return { error: `GSTIN "${v}" is for PAN ${v.slice(2, 12)}, but the customer's PAN is ${p}` };
  return { value: v, stateCode: v.slice(0, 2) };
}

module.exports = { checkGstin, normalizeGstin: normalize, gstinCheckChar: checkChar };

// GST state codes (the first two digits of a GSTIN), as the GST network lists them.
const STATE_CODES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};
const codeOf = (gstin) => { const v = normalize(gstin); return /^[0-9]{2}/.test(v) ? v.slice(0, 2) : null; };

/**
 * Place of supply for a property sale (IGST Act s.12(3): where the property
 * is) and whether it is inside the supplier's state (CGST+SGST) or not (IGST).
 * Projects carry no GSTIN of their own (routes/projectMaster.js: GST lives
 * on the parent company, which registers in the state it sells property in),
 * so in practice this is the company's GSTIN state. A project GSTIN or typed
 * states, if ever present, are compared first.
 */
function placeOfSupply({ projectGst, companyGst, projectState, companyState }) {
  const p = codeOf(projectGst), c = codeOf(companyGst);
  const norm = (x) => String(x || "").trim().toLowerCase();
  if (p && c) return { name: STATE_CODES[p] || p, code: p, intraState: p === c, basis: "gstin" };
  if (projectState && companyState) return { name: projectState, code: null, intraState: norm(projectState) === norm(companyState), basis: "state" };
  const name = (p && STATE_CODES[p]) || projectState || (c && STATE_CODES[c]) || companyState || null;
  return { name, code: p || c || null, intraState: true, basis: name ? "partial" : "assumed" };
}

module.exports.placeOfSupply = placeOfSupply;
module.exports.STATE_CODES = STATE_CODES;
