/**
 * backend/utils/docNumberLock.js
 *
 * Shared helper: generate + race-safely lock the next sequential document
 * number for any module that uses TypeOfDoc + DocNumberSequence.
 *
 * Usage:
 *   const { lockNextDocNumber, backPatchRecordId } = require("../utils/docNumberLock");
 *
 *   // In your POST handler:
 *   const finalDocNo = await lockNextDocNumber(pool, sql, {
 *     docTypeId : parseInt(DocTypeId, 10),
 *     finYear   : "2024-25",          // optional
 *     tableName : "GoodsReceiptNotes",
 *     issuedBy  : req.user?.email,
 *   });
 *
 *   // After main INSERT, stamp the new record id back:
 *   await backPatchRecordId(pool, sql, finalDocNo, "GoodsReceiptNotes", newId);
 */

/**
 * Generate and lock the next doc number.
 * Returns the locked string, e.g. "GRN/000042/2024-25"
 * Throws on failure so the caller can return 500.
 */
async function lockNextDocNumber(pool, sql, { docTypeId, finYear, tableName, issuedBy }) {
  // 1. Fetch doc-type config from TypeOfDoc
  const typeResult = await pool
    .request()
    .input("TypeOfDocId", sql.Int, docTypeId)
    .query(`
      SELECT Prefix, FullPrefix, StartingDocNo
      FROM   dbo.TypeOfDoc
      WHERE  TypeOfDocId = @TypeOfDocId AND IsActive = 1
    `);

  const typeRow = typeResult.recordset[0];
  if (!typeRow) throw new Error("Selected document type not found or inactive.");

  const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
  const startFrom = typeRow.StartingDocNo ?? 1;

  // Strip trailing digits so "GRN/000500" → "GRN/"
  const prefix = rawPrefix.replace(/\d+$/, "");
  const fy     = (finYear || "").toString().trim();

  // 2. Find current max sequence already locked for this prefix
  const maxResult = await pool
    .request()
    .input("TypeOfDocId", sql.Int, docTypeId)
    .input("Prefix", sql.NVarChar(100), prefix + "%")
    .input("FinYearPattern", sql.NVarChar(130), fy ? `%/${fy}` : null)
    .query(`
      SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
      FROM   dbo.DocNumberSequence
      WHERE  TypeOfDocId = @TypeOfDocId
        AND  DocNo LIKE @Prefix
        AND  (@FinYearPattern IS NULL OR DocNo LIKE @FinYearPattern)
    `);

  const maxSeq  = maxResult.recordset[0]?.MaxSeq ?? startFrom - 1;
  const nextSeq = Math.max(maxSeq + 1, startFrom);
  const padded  = String(nextSeq).padStart(6, "0");

  // Final format:  PREFIX/000042/2024-25  or  PREFIX/000042
  let finalDocNo = fy ? `${prefix}${padded}/${fy}` : `${prefix}${padded}`;

  // 3. Lock it — INSERT first so no duplicate can slip through
  const tryInsert = async (docNo) => {
    await pool
      .request()
      .input("TypeOfDocId", sql.Int,          docTypeId)
      .input("DocNo",       sql.NVarChar(100), docNo)
      .input("TableName",   sql.NVarChar(100), tableName)
      .input("IssuedBy",    sql.NVarChar(200), issuedBy || null)
      .query(`
        INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
        VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
      `);
  };

  try {
    await tryInsert(finalDocNo);
  } catch (_seqErr) {
    // Unique-constraint collision: another request grabbed this exact number.
    // Re-read the max and bump by 1 more.
    const retryMax = await pool
      .request()
      .input("TypeOfDocId", sql.Int, docTypeId)
      .input("Prefix", sql.NVarChar(100), prefix + "%")
      .input("FinYearPattern", sql.NVarChar(130), fy ? `%/${fy}` : null)
      .query(`
        SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
        FROM   dbo.DocNumberSequence
        WHERE  TypeOfDocId = @TypeOfDocId
          AND  DocNo LIKE @Prefix
          AND  (@FinYearPattern IS NULL OR DocNo LIKE @FinYearPattern)
      `);
    const retrySeq  = (retryMax.recordset[0]?.MaxSeq ?? nextSeq) + 1;
    const retryBase = `${prefix}${String(retrySeq).padStart(6, "0")}`;
    finalDocNo      = fy ? `${retryBase}/${fy}` : retryBase;
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
    .input("DocNo",     sql.NVarChar(100), docNo)
    .input("TableName", sql.NVarChar(100), tableName)
    .input("RecordId",  sql.Int,           parseInt(recordId, 10))
    .query(`
      UPDATE dbo.DocNumberSequence
      SET    RecordId = @RecordId
      WHERE  DocNo = @DocNo AND TableName = @TableName
    `);
}

module.exports = { lockNextDocNumber, backPatchRecordId };

