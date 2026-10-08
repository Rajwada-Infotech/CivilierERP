"use strict";

/**
 * cleanNames(fields) — tidies the name-like fields of a create / update request before the route sees them:
 * spaces at either end are removed, runs of spaces (and tabs, line breaks and non-breaking spaces) become one
 * space. "R..G OFFICE " and "Gloria  Godown" were saved as typed and later could not be matched by imports and
 * lookups that compare names; names derived from them (a project's godown and ledgers) inherited the stray space.
 *
 * Only the listed top-level string fields of a JSON body on POST / PUT / PATCH are touched. Everything else
 * (other fields, nested objects, file uploads, GET requests) passes through exactly as it was.
 */

const cleanName = (value) =>
  typeof value === "string" ? value.replace(/[ \t\r\n]/g, " ").replace(/ {2,}/g, " ").trim() : value;

function cleanNames(fields) {
  return function cleanNamesMiddleware(req, _res, next) {
    if ((req.method === "POST" || req.method === "PUT" || req.method === "PATCH") && req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      for (const field of fields) {
        if (typeof req.body[field] === "string") req.body[field] = cleanName(req.body[field]);
      }
    }
    next();
  };
}

module.exports = { cleanNames, cleanName };
