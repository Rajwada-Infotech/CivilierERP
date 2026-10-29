/**
 * The one rule for a phone number, for every place that takes one (SA leads, CRM customers).
 *
 *  - An Indian mobile is kept as its 10 digits, exactly as before ("98765 43210",
 *    "+91 98765 43210", "09876543210", "919876543210" → "9876543210").
 *  - A number from outside India must carry its country code ("+971 50 123 4567" or
 *    "00971 50 123 4567") and is kept as "+" and 8–15 digits (E.164) → "+971501234567",
 *    so the same number written two ways is still one number.
 *  - Without a country code, anything but an Indian mobile is refused rather than guessed.
 *  - Meta's exports write numbers as "p:+91…" — the "p:" is dropped.
 *
 * normalizePhone(value, label) → { value } (null when blank) or { error }.
 */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const INTERNATIONAL = /^[1-9]\d{7,14}$/; // E.164: country code + number, 8–15 digits, no leading 0

function normalizePhone(value, label = "Mobile") {
  const raw = value === undefined || value === null ? "" : String(value).trim();
  if (!raw) return { value: null };

  let s = raw.replace(/^p:/i, "").replace(/[\s().-]/g, "");
  let international = false;
  if (s.startsWith("+")) { s = s.slice(1); international = true; }
  else if (s.startsWith("00")) { s = s.slice(2); international = true; }

  if (!/^\d+$/.test(s)) return { error: `${label} must contain only digits, spaces, +, -, or brackets` };

  if (international) {
    if (s.startsWith("91")) s = s.slice(2); // +91 → an Indian mobile, checked below
    else if (INTERNATIONAL.test(s)) return { value: `+${s}` };
    else return { error: `${label} with a country code must have 8 to 15 digits` };
  } else {
    if (s.length === 11 && s.startsWith("0")) s = s.slice(1);
    if (s.length === 12 && s.startsWith("91")) s = s.slice(2);
  }

  if (!INDIAN_MOBILE.test(s)) {
    return { error: `${label} must be a 10-digit Indian mobile, or start with the country code (e.g. +971 50 123 4567)` };
  }
  return { value: s };
}

/**
 * Cleans the named phone fields of a request body in place (only those sent).
 * Returns the first error, or null. Labels: { Mobile: "Mobile", AltMobile: "Alternate mobile" }.
 */
function cleanPhoneFields(body, labels) {
  for (const [key, label] of Object.entries(labels)) {
    if (body[key] === undefined) continue;
    const r = normalizePhone(body[key], label);
    if (r.error) return r.error;
    body[key] = r.value;
  }
  return null;
}

module.exports = { normalizePhone, cleanPhoneFields };
