/**
 * Cryptographically secure UUID v4 generator.
 *
 * Prefers the native crypto.randomUUID() when available (HTTPS / secure contexts).
 * Falls back to crypto.getRandomValues() for HTTP / non-secure contexts.
 *
 * Never uses Math.random() — safe for security-sensitive values such as
 * session IDs, CSRF tokens, and record keys.
 *
 * Resolves CodeQL js/insecure-randomness on all call sites.
 */
export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // RFC 4122 §4.4 — version 4, variant 10xx
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}