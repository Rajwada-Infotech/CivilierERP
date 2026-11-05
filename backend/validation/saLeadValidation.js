const { normalizePhone } = require("./phone");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function blankToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

// Indian mobiles as 10 digits; numbers from outside India with their country code — see validation/phone.js.
const normalizeMobile = (value, fieldName = "Mobile") => normalizePhone(value, fieldName);

function normalizeEmail(value) {
  const raw = blankToNull(value);
  if (!raw) return { value: null };
  const email = raw.toLowerCase();
  if (email.length > 200 || !EMAIL_RE.test(email)) {
    return { error: "Email must be a valid email address" };
  }
  return { value: email };
}

function normalizeSaLeadContactFields(input = {}) {
  const errors = [];
  const mobile = normalizeMobile(input.Mobile);
  const altMobile = normalizeMobile(input.AltMobile, "AltMobile");
  const email = normalizeEmail(input.Email);

  if (mobile.error) errors.push(mobile.error);
  if (altMobile.error) errors.push(altMobile.error);
  if (email.error) errors.push(email.error);

  return {
    value: {
      ...input,
      CustomerName: blankToNull(input.CustomerName),
      Mobile: mobile.value,
      AltMobile: altMobile.value,
      Email: email.value,
    },
    errors,
  };
}

module.exports = {
  normalizeMobile,
  normalizeEmail,
  normalizeSaLeadContactFields,
};
