// backend/services/amendmentLog.js
//
// Audit trail for edits made to already-Approved documents. There is no
// propose/approve/reject workflow here (that engine was removed) — editing
// an Approved document just edits it directly, same as any other status.
// This module only records what changed, by whom, and when, into the
// existing dbo.Amendments / dbo.AmendmentLineChanges tables (preserved from
// the old engine on purpose), so each module's Amendment page can show a
// history of post-approval edits.

const { getPool, sql } = require("../db");

// RefDocType key -> which of the three module Amendment pages it shows up
// on, plus a display label used in the amendment list.
const DOC_TYPES = {
  "expense-booking": { module: "finance", label: "Invoice (Expense Booking)" },
  payment: { module: "finance", label: "Payment" },
  "received-payment": { module: "finance", label: "Received Payment" },
  "material-request": { module: "material", label: "Material Request" },
  "purchase-order": { module: "material", label: "Purchase Order" },
  "vehicle-in-out": { module: "material", label: "Vehicle In/Out" },
  grn: { module: "material", label: "GRN" },
  "material-issue": { module: "material", label: "Material Issue" },
  "material-issue-return": { module: "material", label: "Material Issue Return" },
  boq: { module: "engineering", label: "BOQ" },
  "work-order": { module: "engineering", label: "Work Order" },
  "work-done": { module: "engineering", label: "Work Done" },
};

const MODULES = ["finance", "material", "engineering"];

function docTypesForModule(module) {
  return Object.keys(DOC_TYPES).filter((k) => DOC_TYPES[k].module === module);
}

// A few tables use a short Hungarian-style column prefix (NewPayment's "P",
// ReceivedPayment's "RP", ExpenseBooking's "E") that reads as noise in a
// diff — "PPaymentName" means nothing to a user, "Payment Name" does. Most
// other tables (PurchaseOrders, BOQ, WorkOrderHeader, ...) already use plain
// PascalCase columns with no such prefix, so this only strips one when the
// doc type is known to use it.
const FIELD_PREFIXES = {
  payment: "P",
  "received-payment": "RP",
  "expense-booking": "E",
};

// Turns a raw column name into a readable label: strips the doc type's
// Hungarian-style prefix if any, then splits PascalCase/acronym boundaries
// ("BankID" -> "Bank ID", "PurchaseOrderNo" -> "Purchase Order No").
function humanizeFieldName(field, refDocType) {
  let s = field;
  const prefix = FIELD_PREFIXES[refDocType];
  if (prefix && s.startsWith(prefix) && /[A-Z]/.test(s[prefix.length] || "")) {
    s = s.slice(prefix.length);
  }
  s = s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  return s || field;
}

function normalize(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// Meta/bookkeeping columns every table carries that should never show up as
// a "change" in the amendment trail — they record when/who touched the row
// last, not what actually changed about its content.
const IGNORED_FIELDS = new Set([
  "UpdatedAt",
  "UpdatedBy",
  "CreatedAt",
  "CreatedBy",
]);

// Fetches a full row snapshot for diffing. `table`/`pkCol` are always
// hardcoded call-site constants (never user input), so plain interpolation
// matches this codebase's existing convention for per-module table names.
async function snapshotRow(pool, table, pkCol, id) {
  const result = await pool
    .request()
    .input("Id", sql.Int, id)
    .query(`SELECT * FROM ${table} WHERE ${pkCol} = @Id;`);
  return result.recordset[0] || null;
}

// Diffs `before`/`after` snapshots (plain objects with the same keys) and,
// if anything actually changed, writes one Amendments header row plus one
// AmendmentLineChanges row per changed field. No-op if nothing changed.
//
// fieldLabels is an optional { fieldName: "Display Label" } map for nicer
// column names in the UI; unmapped fields fall back to an auto-humanized
// version of the raw column name (see humanizeFieldName).
async function recordAmendment({
  refDocType,
  refDocId,
  refDocNo,
  projectName,
  companyName,
  changedBy,
  before,
  after,
  fieldLabels = {},
}) {
  if (!DOC_TYPES[refDocType]) {
    throw new Error(`Unknown amendment doc type: ${refDocType}`);
  }

  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const oldVal = normalize(before?.[key]);
    const newVal = normalize(after?.[key]);
    if (oldVal !== newVal) {
      changes.push({
        field: key,
        label: fieldLabels[key] || humanizeFieldName(key, refDocType),
        oldValue: oldVal,
        newValue: newVal,
      });
    }
  }

  if (changes.length === 0) return null;

  const pool = getPool();

  const headerResult = await pool
    .request()
    .input("RefDocType", sql.NVarChar(100), refDocType)
    .input("RefDocId", sql.Int, refDocId)
    .input("RefDocNo", sql.NVarChar(100), refDocNo ?? null)
    .input("ProjectName", sql.NVarChar(255), projectName ?? null)
    .input("CompanyName", sql.NVarChar(255), companyName ?? null)
    .input(
      "Description",
      sql.NVarChar(sql.MAX),
      `${changes.length} field${changes.length === 1 ? "" : "s"} changed after approval`,
    )
    .input("CreatedBy", sql.NVarChar(100), changedBy ?? null)
    .query(`
      INSERT INTO dbo.Amendments
        (RefDocType, RefDocId, RefDocNo, ProjectName, CompanyName, Description,
         AmendmentDate, Status, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES
        (@RefDocType, @RefDocId, @RefDocNo, @ProjectName, @CompanyName, @Description,
         CAST(SYSDATETIME() AS DATE), 'Applied', @CreatedBy, SYSDATETIME());
    `);

  const amendmentId = headerResult.recordset[0].Id;

  await pool
    .request()
    .input("Id", sql.Int, amendmentId)
    .query(`
      UPDATE dbo.Amendments
      SET AmendmentNo = CONCAT('AMD-', FORMAT(GETDATE(), 'yyyyMMdd'), '-', Id)
      WHERE Id = @Id;
    `);

  for (const change of changes) {
    await pool
      .request()
      .input("AmendmentId", sql.Int, amendmentId)
      .input("FieldName", sql.NVarChar(200), change.field)
      .input("FieldLabel", sql.NVarChar(200), change.label)
      .input("OldValue", sql.NVarChar(sql.MAX), change.oldValue)
      .input("NewValue", sql.NVarChar(sql.MAX), change.newValue)
      .input("ChangedBy", sql.NVarChar(200), changedBy ?? null)
      .query(`
        INSERT INTO dbo.AmendmentLineChanges
          (AmendmentId, FieldName, FieldLabel, OldValue, NewValue, ChangedBy, ChangedAt)
        VALUES
          (@AmendmentId, @FieldName, @FieldLabel, @OldValue, @NewValue, @ChangedBy, SYSDATETIME());
      `);
  }

  return amendmentId;
}

async function listAmendments(module) {
  if (!MODULES.includes(module)) {
    throw new Error(`Unknown amendment module: ${module}`);
  }
  const types = docTypesForModule(module);
  const pool = getPool();
  const request = pool.request();
  const placeholders = types.map((t, i) => {
    request.input(`t${i}`, sql.NVarChar(100), t);
    return `@t${i}`;
  });
  const result = await request.query(`
    SELECT Id, AmendmentNo, RefDocType, RefDocId, RefDocNo, ProjectName, CompanyName,
           Description, AmendmentDate, CreatedBy, CreatedAt
    FROM dbo.Amendments
    WHERE IsDeleted = 0 AND RefDocType IN (${placeholders.join(",")})
    ORDER BY CreatedAt DESC;
  `);
  return result.recordset.map((row) => ({
    ...row,
    RefDocLabel: DOC_TYPES[row.RefDocType]?.label || row.RefDocType,
  }));
}

async function getAmendmentDetail(id) {
  const pool = getPool();
  const headerResult = await pool
    .request()
    .input("Id", sql.Int, id)
    .query(`SELECT * FROM dbo.Amendments WHERE Id = @Id AND IsDeleted = 0;`);
  const header = headerResult.recordset[0];
  if (!header) return null;

  const linesResult = await pool
    .request()
    .input("AmendmentId", sql.Int, id)
    .query(`
      SELECT Id, FieldName, FieldLabel, OldValue, NewValue, ChangedBy, ChangedAt
      FROM dbo.AmendmentLineChanges
      WHERE AmendmentId = @AmendmentId
      ORDER BY Id ASC;
    `);

  return {
    ...header,
    RefDocLabel: DOC_TYPES[header.RefDocType]?.label || header.RefDocType,
    changes: linesResult.recordset,
  };
}

module.exports = {
  DOC_TYPES,
  MODULES,
  snapshotRow,
  recordAmendment,
  listAmendments,
  getAmendmentDetail,
};
