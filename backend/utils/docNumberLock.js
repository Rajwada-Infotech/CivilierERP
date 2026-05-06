/**
 * backend/utils/docNumberLock.js
 *
 * Shared helper: generate + race-safely lock the next sequential document
 * number for any module that uses TypeOfDoc + DocNumberSequence.
 *
 * Usage:
 *   const { lockNextDocNumber, backPatchRecordId } = require("../utils/docNumberLock");
 *
 *   // In your POST handler — pass pool (NOT a transaction):
 *   const finalDocNo = await lockNextDocNumber(pool, sql, {
 *     docTypeId : parseInt(DocTypeId, 10),
 *     finYear   : "2024-25",          // optional
 *     tableName : "WorkOrderHeader",  // used to look up committed numbers
 *     docNoColumn: "DocumentNumber",  // column name in tableName (default: "DocNo")
 *     issuedBy  : req.user?.email,
 *   });
 *
 *   // After main INSERT, stamp the new record id back:
 *   await backPatchRecordId(pool, sql, finalDocNo, "WorkOrderHeader", newId);
 */

/**
 * Generate and lock the next doc number.
 * Returns the locked string, e.g. "CI/WO/000042/2025-2026"
 * Throws on failure so the caller can return 500.
 *
 * Checks BOTH DocNumberSequence (reserved/locked numbers) AND the actual
 * target table (committed numbers) so the counter is always accurate
 * even if older rows were inserted before the sequence table existed.
 *
 * IMPORTANT: pass `pool` not a transaction — sequence locking must be
 * committed independently to prevent duplicate-number races.
 */
async function lockNextDocNumber(
  pool,
  sql,
  { docTypeId, finYear, tableName, docNoColumn, issuedBy },
) {
  // 1. Fetch doc-type config from TypeOfDoc
  const typeResult = await pool
    .request()
    .input("TypeOfDocId", sql.Int, docTypeId).query(`
      SELECT Prefix, FullPrefix, StartingDocNo
      FROM   dbo.TypeOfDoc
      WHERE  TypeOfDocId = @TypeOfDocId AND IsActive = 1
    `);

  const typeRow = typeResult.recordset[0];
  if (!typeRow)
    throw new Error("Selected document type not found or inactive.");

  const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
  const startFrom = typeRow.StartingDocNo ?? 1;

  // Strip trailing digits so "CI/WO/000500" → "CI/WO/"
  const prefix = rawPrefix.replace(/\d+$/, "");
  const fy = (finYear || "").toString().trim();

  // Column in the target table that holds the doc number string
  const col = docNoColumn || "DocNo";

  // 2. Find current max sequence from BOTH sources
  const getGlobalMax = async () => {
    const dnsResult = await pool
      .request()
      .input("TypeOfDocId", sql.Int, docTypeId)
      .input("Prefix", sql.NVarChar(100), prefix + "%").query(`
        SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
        FROM   dbo.DocNumberSequence
        WHERE  TypeOfDocId = @TypeOfDocId
          AND  DocNo LIKE @Prefix
      `);

    // Also check the committed rows in the actual target table
    const committedResult = await pool
      .request()
      .input("DocTypeId2", sql.Int, docTypeId)
      .input("Prefix2", sql.NVarChar(100), prefix + "%").query(`
        SELECT MAX(TRY_CAST(SUBSTRING(${col}, LEN(@Prefix2) + 1, 6) AS INT)) AS MaxSeq
        FROM   dbo.${tableName}
        WHERE  DocTypeId = @DocTypeId2
          AND  ${col} LIKE @Prefix2
      `);

    const fromDNS = dnsResult.recordset[0]?.MaxSeq ?? 0;
    const fromCommitted = committedResult.recordset[0]?.MaxSeq ?? 0;
    return Math.max(fromDNS, fromCommitted);
  };

  const maxSeq = await getGlobalMax();
  const nextSeq = Math.max(maxSeq + 1, startFrom);
  const padded = String(nextSeq).padStart(6, "0");

  // Final format:  PREFIX/000042/2024-25  or  PREFIX/000042
  let finalDocNo = fy ? `${prefix}${padded}/${fy}` : `${prefix}${padded}`;

  // 3. Lock it — INSERT into sequence table first so no duplicate can slip through
  const tryInsert = async (docNo) => {
    await pool
      .request()
      .input("TypeOfDocId", sql.Int, docTypeId)
      .input("DocNo", sql.NVarChar(100), docNo)
      .input("TableName", sql.NVarChar(100), tableName)
      .input("IssuedBy", sql.NVarChar(200), issuedBy || null).query(`
        INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
        VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
      `);
  };

  try {
    await tryInsert(finalDocNo);
  } catch (_seqErr) {
    // Unique-constraint collision: another request grabbed this exact number.
    // Re-read the global max and bump by 1 more.
    const retryMax = await getGlobalMax();
    const retrySeq = Math.max(retryMax + 1, nextSeq + 1);
    const retryBase = `${prefix}${String(retrySeq).padStart(6, "0")}`;
    finalDocNo = fy ? `${retryBase}/${fy}` : retryBase;
    await tryInsert(finalDocNo);
  }

  return finalDocNo;
}

/**
 * After the main INSERT, stamp the new RecordId back into DocNumberSequence.
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
}

module.exports = { lockNextDocNumber, backPatchRecordId };
