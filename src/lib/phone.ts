// The browser's copy of the phone rule in backend/validation/phone.js (the server has the final
// say; this only lets a form say so before sending). An Indian mobile as 10 digits, or a number
// from outside India with its country code ("+971 50 123 4567" / "00971…").

const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const INTERNATIONAL = /^[1-9]\d{7,14}$/;

export const PHONE_HINT = "a 10-digit Indian mobile, or one with its country code (e.g. +971 50 123 4567)";

/** True when the server will accept this as a phone number (blank counts as fine — required-ness is the form's business). */
export function isValidPhone(value: string | null | undefined): boolean {
  let s = String(value ?? "").trim().replace(/^p:/i, "").replace(/[\s().-]/g, "");
  if (!s) return true;
  let international = false;
  if (s.startsWith("+")) { s = s.slice(1); international = true; }
  else if (s.startsWith("00")) { s = s.slice(2); international = true; }
  if (!/^\d+$/.test(s)) return false;
  if (international) {
    if (!s.startsWith("91")) return INTERNATIONAL.test(s);
    s = s.slice(2);
  } else {
    if (s.length === 11 && s.startsWith("0")) s = s.slice(1);
    if (s.length === 12 && s.startsWith("91")) s = s.slice(2);
  }
  return INDIAN_MOBILE.test(s);
}

/**
 * The number as wa.me and SMS gateways want it: country code + number, digits only.
 * An Indian mobile (stored as 10 digits, sometimes with a leading 0 or 91) gets 91; a number
 * stored with its "+country code" keeps its own.
 */
export function toWhatsAppNumber(mobile: string): string {
  const raw = String(mobile ?? "").trim();
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (raw.startsWith("+")) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits.startsWith("91") ? digits : `91${digits}`;
}
