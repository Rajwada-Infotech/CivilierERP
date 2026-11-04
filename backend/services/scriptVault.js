"use strict";

/**
 * The Script Console's vault (see routes/scriptConsole.js). A 256-bit random key opens it.
 *
 *   key        32 random bytes, shown to the super admin once, as 13 groups of 4 base32 characters.
 *              The server keeps only salt + SHA-256(salt || key) to check it - never the key.
 *   session    entering the right key opens the vault for ONE sign-in (bound to that login's token) until it has
 *              been idle for IDLE_MS. The session holds the AES key in memory only; a restart locks everything.
 *   encryption saved scripts, run history and output are AES-256-GCM encrypted with a key derived (HKDF-SHA256) from
 *              the vault key, so a copy of the database alone reads nothing.
 *   attempts   MAX_FAILS wrong keys in WINDOW_MS lock the user out for LOCK_MS.
 */

const crypto = require("crypto");

const IDLE_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

// ── The key ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Crockford base32 (no I, L, O, U): easy to read out and type, 52 characters for 256 bits.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function toBase32(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random 256-bit key. */
const generateKey = () => crypto.randomBytes(32);

/** "ABCD-EFGH-..." : the form a person writes down and types back. */
const formatKey = (buf) => toBase32(buf).match(/.{1,4}/g).join("-");

/** What a person typed back -> the 32 key bytes, or null when it is not a well-formed key. */
function parseKey(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== 52) return null;
  const buf = fromBase32(clean);
  return buf && buf.length >= 32 ? buf.subarray(0, 32) : null;
}

// ── Checking the key (only a salted hash is stored) ────────────────────────────────────────────────────────────────
const hashKey = (salt, keyBuf) => crypto.createHash("sha256").update(salt).update(keyBuf).digest();

function newVerifier(keyBuf) {
  const salt = crypto.randomBytes(16);
  return { salt, hash: hashKey(salt, keyBuf) };
}

function verifyKey(keyBuf, row) {
  if (!keyBuf || !row) return false;
  const expected = Buffer.from(row.KeyHash);
  const actual = hashKey(Buffer.from(row.Salt), keyBuf);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ── Encryption at rest ─────────────────────────────────────────────────────────────────────────────────────────────
const deriveEncKey = (keyBuf) => Buffer.from(crypto.hkdfSync("sha256", keyBuf, Buffer.alloc(0), "civilier/script-console/aes-256-gcm", 32));

/** "v1:" + base64(iv | tag | ciphertext). Null stays null. */
function encrypt(encKey, plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

/** The text, or null when it was not written with this key (a wrong key never yields garbage). */
function decrypt(encKey, blob) {
  if (blob === null || blob === undefined) return null;
  try {
    if (!String(blob).startsWith("v1:")) return null;
    const raw = Buffer.from(String(blob).slice(3), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Sessions: one per sign-in, in memory only ──────────────────────────────────────────────────────────────────────
const sessions = new Map(); // sha256(token) -> { userId, encKey, until }
const tokenId = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");

function sweep(now = Date.now()) {
  for (const [id, s] of sessions) if (s.until <= now) sessions.delete(id);
}

function openSession(token, userId, keyBuf, now = Date.now()) {
  sweep(now);
  sessions.set(tokenId(token), { userId, encKey: deriveEncKey(keyBuf), until: now + IDLE_MS });
}

/** The open session for this sign-in (and its idle clock restarted), or null when the vault is locked. */
function getSession(token, userId, now = Date.now()) {
  const s = sessions.get(tokenId(token));
  if (!s || s.userId !== userId || s.until <= now) {
    sessions.delete(tokenId(token));
    return null;
  }
  s.until = now + IDLE_MS;
  return s;
}

/** Same as getSession but without restarting the idle clock (for status polling). */
function peekSession(token, userId, now = Date.now()) {
  const s = sessions.get(tokenId(token));
  return s && s.userId === userId && s.until > now ? s : null;
}

const closeSession = (token) => void sessions.delete(tokenId(token));
const closeAllSessions = () => sessions.clear();
const replaceEncKeyInSessions = (userId, token, keyBuf) => {
  const s = sessions.get(tokenId(token));
  if (s && s.userId === userId) s.encKey = deriveEncKey(keyBuf);
};

// ── Wrong-key lockout ──────────────────────────────────────────────────────────────────────────────────────────────
const attempts = new Map(); // userId -> { fails: number[], lockedUntil }

/** Milliseconds this user is still locked out for (0 = may try). */
function lockedFor(userId, now = Date.now()) {
  const a = attempts.get(userId);
  return a && a.lockedUntil > now ? a.lockedUntil - now : 0;
}

function recordFailure(userId, now = Date.now()) {
  const a = attempts.get(userId) ?? { fails: [], lockedUntil: 0 };
  a.fails = a.fails.filter((t) => now - t < WINDOW_MS);
  a.fails.push(now);
  if (a.fails.length >= MAX_FAILS) {
    a.lockedUntil = now + LOCK_MS;
    a.fails = [];
  }
  attempts.set(userId, a);
  return { remaining: Math.max(0, MAX_FAILS - a.fails.length), lockedUntil: a.lockedUntil };
}

const clearFailures = (userId) => void attempts.delete(userId);
const resetAttempts = () => attempts.clear();

module.exports = {
  IDLE_MS, MAX_FAILS, LOCK_MS,
  generateKey, formatKey, parseKey,
  newVerifier, verifyKey,
  deriveEncKey, encrypt, decrypt,
  openSession, getSession, peekSession, closeSession, closeAllSessions, replaceEncKeyInSessions,
  lockedFor, recordFailure, clearFailures, resetAttempts,
};
