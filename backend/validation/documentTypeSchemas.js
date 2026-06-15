const { z } = require("zod");
const { optStr, optInt, reqStr } = require("./helpers");

// ── documentType ──────────────────────────────────────────────────────────────
// Verified against document-type.js:
//   POST/PUT: Prefix, Description, CompanyId, ProjectId, EntryTypeId,
//             StartingDocNo, links_to, ModuleCode, DocNoPrefix, FinYearReset
//   PUT additionally: IsActive

const documentTypeBodySchema = z.object({
  Prefix:        reqStr(20, "Prefix is required"),
  Description:   optStr(4000),
  CompanyId:     optInt,
  ProjectId:     optInt,
  EntryTypeId:   optInt,
  StartingDocNo: optInt,
  links_to:      optStr(255),
  ModuleCode:    optStr(100),
  DocNoPrefix:   optStr(20),
  FinYearReset:  z.coerce.boolean().optional(),
}).passthrough();

const documentTypeUpdateSchema = documentTypeBodySchema
  .extend({
    Prefix:   optStr(20),
    IsActive: z.coerce.boolean().optional(),
  })
  .passthrough();

// ── typeOfDoc ─────────────────────────────────────────────────────────────────
// Verified against typeofdoc.js:
//   POST: Prefix, Description, CompanyId, ProjectId, EntryTypeId
//   PUT:  same + IsActive

const typeofdocBodySchema = z.object({
  Prefix:      reqStr(20, "Prefix is required"),
  Description: optStr(4000),
  CompanyId:   optInt,
  ProjectId:   optInt,
  EntryTypeId: optInt,
}).passthrough();

const typeofdocUpdateSchema = typeofdocBodySchema
  .extend({
    Prefix:   optStr(20),
    IsActive: z.coerce.boolean().optional(),
  })
  .passthrough();

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // documentType
  documentTypeBodySchema,
  documentTypeUpdateSchema,

  // typeOfDoc
  typeofdocBodySchema,
  typeofdocUpdateSchema,
};