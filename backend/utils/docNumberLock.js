/**
 * backend/utils/docNumberLock.js
 *
 * Generates and race-safely locks the next sequential document number for any
 * module that uses TypeOfDoc + DocNumberSequence.
 *
 * ── Number format ────────────────────────────────────────────────────────────
 *
 *   [DocNoPrefix]-[YEAR]-[SERIAL]
 *
 *   Examples:
 *     PO-2026-00045        ExB-2026-00007
 *     ISS-2026-00012       ExB-PO-2026-00012
 *     PAY-2026-00097       ExB-PO-GRN-2026-00008
 *
 *   - DocNoPrefix  from TypeOfDoc.DocNoPrefix  (e.g. "ExB-PO-GRN")
 *   - YEAR         4-digit calendar year of document creation
 *   - SERIAL       zero-padded to TypeOfDoc.DocNoPadding digits (default 5)
 *   - Each (DocNoPrefix, YEAR) pair has its own independent counter
 *   - Counter resets to 1 (or StartingDocNo) each new calendar year
 *
 * ── Backward compatibility ───────────────────────────────────────────────────
 *
 *   If TypeOfDoc.DocNoPrefix IS NULL (legacy row from before migration 035),
 *   the old slash-based format is used:  PREFIX/NNNNNN/FINYEAR
 *   This keeps all pre-existing configured doc types working unchanged.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId, resolveGRNPrefix }
 *     = require('../utils/docNumberLock');
 *
 *   // Resolve TypeOfDocId from canonical prefix string:
 *   const docTypeId = await resolveDocTypeId(pool, sql, 'ExB-PO-GRN');
 *
 *   // Lock next number:
 *   const finalDocNo = await lockNextDocNumber(pool, sql, {
 *     docTypeId,
 *     tableName   : 'GoodsReceiptNotes',
 *     docNoColumn : 'DocNo',
 *     issuedBy    : req.user?.email,
 *     parentDocNo : 'ExB-PO-2026-00012',
 *     rootExBDocNo: 'ExB-2026-00007',
 *   });
 *
 *   // Stamp record id back after INSERT:
 *   await backPatchRecordId(pool, sql, finalDocNo, 'GoodsReceiptNotes', newId);
 */

"use strict";

// ── Internal helpers ──────────────────────────────────────────────────────────

function currentYear() {
  return new Date().getFullYear();
}

/**
 * Build the final DocNo string.
 * New  format : "ExB-PO-GRN-2026-00008"
 * Legacy format: "CI/WO/000042/2024-25"
 */
function buildDocNo({ docNoPrefix, truePrefix, serial, padding, finYear }) {
  const padded = String(serial).padStart(padding || 5, "0");
  if (docNoPrefix) {
    const year = String(currentYear());
    return `${docNoPrefix}-${year}-${padded}`;
  }
  const fy = (finYear || "").toString().trim();
  return fy ? `${truePrefix}${padded}/${fy}` : `${truePrefix}${padded}`;
}

/**
 * Find the current max serial for a (prefix, year) scope across both
 * DocNumberSequence (locked) and the actual target table (committed).
 */
async function getMaxSerial({
  pool,
  sql,
  docNoPrefix,
  truePrefix,
  year,
  tableName,
  col,
}) {
  let dnsMax = 0;
  let tableMax = 0;

  if (docNoPrefix) {
    // New-format: "ExB-PO-GRN-2026-00008"  →  LIKE "ExB-PO-GRN-2026-%"
    const like = `${docNoPrefix}-${year}-%`;

    const dnsRes = await pool
      .request()
      .input("Like1", sql.NVarChar(120), like)
      .input("Prefix", sql.NVarChar(30), docNoPrefix)
      .input("Year", sql.SmallInt, year).query(`
        SELECT MAX(ISNULL(DocSerial, 0)) AS MaxSeq
        FROM   dbo.DocNumberSequence
        WHERE  DocNo LIKE @Like1
          AND  (DocNoPrefix = @Prefix OR DocNoPrefix IS NULL)
          AND  (DocYear = @Year OR DocYear IS NULL)
      `);
    dnsMax = dnsRes.recordset[0]?.MaxSeq ?? 0;

    // Extract serial from last hyphen-segment in target table
    const tblRes = await pool.request().input("Like2", sql.NVarChar(120), like)
      .query(`
        SELECT MAX(
          TRY_CAST(
            REVERSE(SUBSTRING(REVERSE(${col}), 1, CHARINDEX('-', REVERSE(${col})) - 1))
          AS INT)
        ) AS MaxSeq
        FROM dbo.${tableName}
        WHERE ${col} LIKE @Like2
      `);
    tableMax = tblRes.recordset[0]?.MaxSeq ?? 0;
  } else {
    // Legacy slash-based format
    const dnsRes = await pool
      .request()
      .input("Prefix", sql.NVarChar(100), truePrefix)
      .input("PrefixLike", sql.NVarChar(100), truePrefix + "%").query(`
        SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
        FROM   dbo.DocNumberSequence
        WHERE  DocNo LIKE @PrefixLike
      `);
    dnsMax = dnsRes.recordset[0]?.MaxSeq ?? 0;

    const tblRes = await pool
      .request()
      .input("Prefix2", sql.NVarChar(100), truePrefix)
      .input("PrefixLike2", sql.NVarChar(100), truePrefix + "%").query(`
        SELECT MAX(TRY_CAST(SUBSTRING(${col}, LEN(@Prefix2) + 1, 6) AS INT)) AS MaxSeq
        FROM   dbo.${tableName}
        WHERE  ${col} LIKE @PrefixLike2
      `);
    tableMax = tblRes.recordset[0]?.MaxSeq ?? 0;
  }

  return Math.max(dnsMax ?? 0, tableMax ?? 0);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve TypeOfDocId from a canonical DocNoPrefix string.
 * @param {Pool}   pool
 * @param {object} sql
 * @param {string} prefix  e.g. "ExB-PO-GRN", "ISS", "PAY"
 * @returns {Promise<number>}
 */
async function resolveDocTypeId(pool, sql, prefix) {
  const result = await pool
    .request()
    .input("DocNoPrefix", sql.NVarChar(30), prefix).query(`
      SELECT TOP 1 TypeOfDocId
      FROM   dbo.TypeOfDoc
      WHERE  DocNoPrefix = @DocNoPrefix AND IsActive = 1
      ORDER  BY TypeOfDocId ASC
    `);
  const row = result.recordset[0];
  if (!row) throw new Error(`No active TypeOfDoc found for prefix "${prefix}"`);
  return row.TypeOfDocId;
}

/**
 * Determine the correct GRN DocNoPrefix based on parent document context.
 *
 *   ExB-PO-YYYY-NNNNN  → "ExB-PO-GRN"
 *   ExB-WO-YYYY-NNNNN  → "ExB-WO-GRN"
 *   ExB-YYYY-NNNNN     → "ExB-GRN"   (direct under ExB, no intermediate PO/WO)
 *   anything else       → "GRN"
 *
 * @param {string|null} parentDocNo  DocNo of the parent document (PO or WO)
 * @returns {string}
 */
function resolveGRNPrefix(parentDocNo) {
  if (!parentDocNo) return "GRN";
  const p = String(parentDocNo).toUpperCase();
  if (p.startsWith("EXB-PO-")) return "ExB-PO-GRN";
  if (p.startsWith("EXB-WO-")) return "ExB-WO-GRN";
  if (p.startsWith("EXB-")) return "ExB-GRN";
  return "GRN";
}

/**
 * Generate and atomically lock the next document number.
 *
 * IMPORTANT: pass pool (NOT a transaction) — sequence locking uses its own
 * connection so it commits independently and prevents duplicate-number races.
 *
 * @param {Pool}   pool
 * @param {object} sql
 * @param {object} opts
 *   @param {number}  opts.docTypeId
 *   @param {string}  [opts.finYear]       legacy finYear suffix
 *   @param {string}  opts.tableName
 *   @param {string}  [opts.docNoColumn]   defaults to "DocNo"
 *   @param {string}  [opts.issuedBy]
 *   @param {string}  [opts.parentDocNo]   human-readable parent ref (stored in DNS)
 *   @param {string}  [opts.rootExBDocNo]  root ExB number (stored in DNS)
 * @returns {Promise<string>}
 */
async function lockNextDocNumber(
  pool,
  sql,
  {
    docTypeId,
    finYear,
    tableName,
    docNoColumn,
    issuedBy,
    parentDocNo,
    rootExBDocNo,
  },
) {
  // 1. Fetch doc type config
  const typeResult = await pool
    .request()
    .input("TypeOfDocId", sql.Int, docTypeId).query(`
      SELECT Prefix, FullPrefix, StartingDocNo, DocNoPrefix,
             ISNULL(DocNoPadding, 5) AS DocNoPadding
      FROM   dbo.TypeOfDoc
      WHERE  TypeOfDocId = @TypeOfDocId AND IsActive = 1
    `);

  const typeRow = typeResult.recordset[0];
  if (!typeRow)
    throw new Error("Selected document type not found or inactive.");

  const docNoPrefix = typeRow.DocNoPrefix ?? null;
  const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
  const truePrefix = rawPrefix.replace(/\d+$/, "");
  const startFrom = typeRow.StartingDocNo ?? 1;
  const padding = typeRow.DocNoPadding ?? 5;
  const col = docNoColumn || "DocNo";
  const year = currentYear();

  // 2. Find current max serial
  const maxSerial = await getMaxSerial({
    pool,
    sql,
    docNoPrefix,
    truePrefix,
    year,
    tableName,
    col,
  });
  let nextSeq = Math.max(maxSerial + 1, startFrom);

  // 3. Build candidate DocNo
  let finalDocNo = buildDocNo({
    docNoPrefix,
    truePrefix,
    serial: nextSeq,
    padding,
    finYear,
  });

  // 4. INSERT into DocNumberSequence to lock (unique constraint prevents dups)
  const tryInsert = async (docNo, seq) => {
    await pool
      .request()
      .input("TypeOfDocId", sql.Int, docTypeId)
      .input("DocNo", sql.NVarChar(100), docNo)
      .input("DocNoPrefix", sql.NVarChar(30), docNoPrefix || null)
      .input("DocYear", sql.SmallInt, docNoPrefix ? year : null)
      .input("DocSerial", sql.Int, seq)
      .input("TableName", sql.NVarChar(100), tableName)
      .input("IssuedBy", sql.NVarChar(200), issuedBy || null).query(`
        INSERT INTO dbo.DocNumberSequence
          (TypeOfDocId, DocNo, DocNoPrefix, DocYear, DocSerial, TableName, IssuedBy)
        VALUES
          (@TypeOfDocId, @DocNo, @DocNoPrefix, @DocYear, @DocSerial, @TableName, @IssuedBy)
      `);
  };

  try {
    await tryInsert(finalDocNo, nextSeq);
  } catch (_collision) {
    // Concurrent request grabbed this number — bump and retry up to 5 times
    let attempts = 0;
    while (attempts < 5) {
      attempts++;
      const retryMax = await getMaxSerial({
        pool,
        sql,
        docNoPrefix,
        truePrefix,
        year,
        tableName,
        col,
      });
      const retrySeq = Math.max(retryMax + 1, nextSeq + 1);
      finalDocNo = buildDocNo({
        docNoPrefix,
        truePrefix,
        serial: retrySeq,
        padding,
        finYear,
      });
      try {
        await tryInsert(finalDocNo, retrySeq);
        return finalDocNo;
      } catch {
        // keep looping
      }
    }
    throw _collision;
  }

  return finalDocNo;
}

/**
 * After the main INSERT, stamp the new RecordId back into DocNumberSequence.
 * Also syncs ExpenseBooking.RootExBDocNo when the table is ExpenseBooking.
 *
 * @param {Pool}   pool
 * @param {object} sql
 * @param {string} docNo
 * @param {string} tableName
 * @param {number} recordId
 */
async function backPatchRecordId(pool, sql, docNo, tableName, recordId) {
  if (!docNo || !recordId) return;

  await pool
    .request()
    .input("DocNo", sql.NVarChar(100), docNo)
    .input("TableName", sql.NVarChar(100), tableName)
    .input("RecordId", sql.Int, parseInt(recordId, 10)).query(`
      UPDATE dbo.DocNumberSequence
      SET    RecordId = @RecordId
      WHERE  DocNo = @DocNo AND TableName = @TableName
    `);

  // For ExpenseBooking: keep RootExBDocNo in sync with EDocNo
  if (tableName === "ExpenseBooking") {
    await pool
      .request()
      .input("Eid", sql.Int, parseInt(recordId, 10))
      .input("RootExBDocNo", sql.NVarChar(100), docNo).query(`
        UPDATE dbo.ExpenseBooking
        SET    RootExBDocNo = @RootExBDocNo
        WHERE  Eid = @Eid
          AND  (RootExBDocNo IS NULL OR RootExBDocNo <> @RootExBDocNo)
      `);
  }
}

/**
 * Preview the next DocNo without locking it (read-only, for UI display).
 * Checks DocNumberSequence only (no target-table scan needed for preview).
 *
 * @param {Pool}   pool
 * @param {object} sql
 * @param {number} docTypeId
 * @param {string} [finYear]
 * @returns {Promise<{nextDocNo, prefix, nextSeq, year}>}
 */
async function previewNextDocNumber(pool, sql, docTypeId, finYear) {
  const typeResult = await pool
    .request()
    .input("TypeOfDocId", sql.Int, docTypeId).query(`
      SELECT Prefix, FullPrefix, StartingDocNo, DocNoPrefix,
             ISNULL(DocNoPadding, 5) AS DocNoPadding
      FROM   dbo.TypeOfDoc
      WHERE  TypeOfDocId = @TypeOfDocId AND IsActive = 1
    `);

  const typeRow = typeResult.recordset[0];
  if (!typeRow) throw new Error("Document type not found");

  const docNoPrefix = typeRow.DocNoPrefix ?? null;
  const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
  const truePrefix = rawPrefix.replace(/\d+$/, "");
  const startFrom = typeRow.StartingDocNo ?? 1;
  const padding = typeRow.DocNoPadding ?? 5;
  const year = currentYear();

  let dnsMax = 0;
  if (docNoPrefix) {
    const like = `${docNoPrefix}-${year}-%`;
    const r = await pool
      .request()
      .input("Like1", sql.NVarChar(120), like)
      .input("Prefix", sql.NVarChar(30), docNoPrefix)
      .input("Year", sql.SmallInt, year).query(`
        SELECT MAX(ISNULL(DocSerial, 0)) AS MaxSeq
        FROM   dbo.DocNumberSequence
        WHERE  DocNo LIKE @Like1
          AND  (DocNoPrefix = @Prefix OR DocNoPrefix IS NULL)
          AND  (DocYear = @Year OR DocYear IS NULL)
      `);
    dnsMax = r.recordset[0]?.MaxSeq ?? 0;
  } else {
    const r = await pool
      .request()
      .input("Prefix", sql.NVarChar(100), truePrefix)
      .input("PrefixLike", sql.NVarChar(100), truePrefix + "%").query(`
        SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
        FROM   dbo.DocNumberSequence
        WHERE  DocNo LIKE @PrefixLike
      `);
    dnsMax = r.recordset[0]?.MaxSeq ?? 0;
  }

  const nextSeq = Math.max((dnsMax ?? 0) + 1, startFrom);
  const nextDocNo = buildDocNo({
    docNoPrefix,
    truePrefix,
    serial: nextSeq,
    padding,
    finYear,
  });

  return {
    nextDocNo,
    prefix: docNoPrefix || truePrefix,
    nextSeq,
    year: docNoPrefix ? year : null,
  };
}

module.exports = {
  lockNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
  resolveGRNPrefix,
  previewNextDocNumber,
};
