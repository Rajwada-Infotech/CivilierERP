const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function blankToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeMobile(value, fieldName = "Mobile") {
  const raw = blankToNull(value);
  if (!raw) return { value: null };

  let digits = raw.replace(/[\s().-]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);

  if (!/^\d+$/.test(digits)) {
    return { error: `${fieldName} must contain only digits, spaces, +, -, or brackets` };
  }

  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);

  if (!/^[6-9]\d{9}$/.test(digits)) {
    return { error: `${fieldName} must be a valid 10-digit Indian mobile number` };
  }

  return { value: digits };
}

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
