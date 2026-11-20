"use strict";
/**
 * Face template encryption: AES-256-GCM (authenticated). The key is NEVER stored in SQL Server.
 * Today the key comes from the environment (FACE_TEMPLATE_KEY = 32 bytes, base64; FACE_TEMPLATE_KEY_ID names it).
 * To move to AWS KMS, replace getKey() with a KMS data-key decrypt — callers and the stored format stay the same.
 * Stored format: [12-byte IV][16-byte auth tag][ciphertext]. The employee id is bound as AAD, so a template copied to
 * another employee's row fails to decrypt.
 */
const crypto = require("crypto");

class FaceKeyError extends Error {}

function getKey() {
  const raw = process.env.FACE_TEMPLATE_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new FaceKeyError("Face verification is not configured on the server (FACE_TEMPLATE_KEY missing).");
  return { key, keyId: process.env.FACE_TEMPLATE_KEY_ID || "env-1" };
}
const aad = (employeeId) => Buffer.from(`civilier-face:${employeeId}`);

function encryptTemplate(employeeId, vector) {
  const { key, keyId } = getKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aad(employeeId));
  const plain = Buffer.from(new Float32Array(vector).buffer);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  plain.fill(0);
  return { cipher: Buffer.concat([iv, c.getAuthTag(), ct]), keyId };
}

function decryptTemplate(employeeId, blob) {
  const { key } = getKey();
  const buf = Buffer.from(blob);
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAAD(aad(employeeId));
  d.setAuthTag(buf.subarray(12, 28));
  const plain = Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  const v = new Float32Array(plain.buffer, plain.byteOffset, plain.byteLength / 4);
  return Float32Array.from(v);
}

/** Any bytes (e.g. the one review photo of a self-registration), bound to a label + employee. */
function encryptBytes(label, employeeId, bytes) {
  const { key } = getKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`civilier-${label}:${employeeId}`));
  const ct = Buffer.concat([c.update(bytes), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function decryptBytes(label, employeeId, blob) {
  const { key } = getKey();
  const buf = Buffer.from(blob);
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAAD(Buffer.from(`civilier-${label}:${employeeId}`));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

const isConfigured = () => { try { getKey(); return true; } catch { return false; } };

module.exports = { encryptTemplate, decryptTemplate, encryptBytes, decryptBytes, isConfigured, FaceKeyError };
