// Verifies an uploaded file's actual bytes match its declared MIME type.
//
// Audit context (CivilierERP CRM Deep QA Audit, Finding #7 / XCT-005): every
// multer fileFilter across the CRM module (bookings, agreements, sales deed,
// registry, mutation, the customer portal) only ever checks `file.mimetype`
// — a header the CLIENT sets on the multipart request. A renamed executable
// uploaded with Content-Type: application/pdf sails straight through. This
// closes that gap for the fixed, small set of types this codebase actually
// accepts, without adding a dependency (the `file-type` package is ESM-only
// in current major versions, awkward to pull into this CommonJS codebase for
// what a handful of magic-byte checks covers just as well).
//
// Deliberately narrow: only checks the byte signature for the specific
// mimetypes this app's upload endpoints allow. A type with no signature
// entry here (e.g. text/plain, which has no reliable magic bytes) is passed
// through unchecked — this is a targeted hardening for the types that DO
// have a verifiable signature, not a general-purpose file-type sniffer.

function matchesSignature(buffer, mimetype) {
  if (!buffer || buffer.length < 4) return false;
  const b = buffer;

  switch (mimetype) {
    case "application/pdf":
      // "%PDF-"
      return b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-";

    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

    case "image/png":
      return b.length >= 8 &&
        b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
        b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;

    case "image/webp":
      // "RIFF"....{"WEBP"} — bytes 0-3 RIFF, 8-11 WEBP
      return b.length >= 12 &&
        b.toString("latin1", 0, 4) === "RIFF" &&
        b.toString("latin1", 8, 12) === "WEBP";

    // Legacy OLE2 compound-file container — .doc AND old-format .xls both
    // use this same signature; can't distinguish them from bytes alone, so
    // any caller allowing either type accepts this signature for both.
    case "application/msword":
    case "application/vnd.ms-excel":
      return b.length >= 8 &&
        b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
        b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1;

    // Modern Office formats are ZIP containers (OOXML) — same outer
    // signature for .docx/.xlsx/.pptx; the inner content-type XML is what
    // actually distinguishes them, which is more than a byte-signature
    // check needs to prove here (we're ruling out "this isn't a ZIP at
    // all", e.g. an executable renamed with an Office mimetype).
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);

    default:
      // No signature on file for this type (e.g. text/plain) — nothing to
      // check against, so don't block it.
      return true;
  }
}

// Multer's fileFilter runs before the buffer is fully available (memory
// storage hasn't read the stream yet in some multer versions/paths), so
// this is meant to be called AFTER upload — inside the route handler, once
// `req.file.buffer` (or `req.files[i].buffer`) exists. Returns null if the
// file is fine, or an error message string if it should be rejected.
function verifyFileMatchesDeclaredType(file) {
  if (!file?.buffer || !file?.mimetype) return null;
  if (!matchesSignature(file.buffer, file.mimetype)) {
    return `The uploaded file's content doesn't match its declared type (${file.mimetype}) — it may be corrupted or mislabeled. Please re-upload the original file.`;
  }
  return null;
}

module.exports = { verifyFileMatchesDeclaredType, matchesSignature };
